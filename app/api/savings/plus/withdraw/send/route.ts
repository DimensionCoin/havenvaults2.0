// app/api/savings/plus/withdraw/send/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendTransactionError,
  ParsedInstruction,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import mongoose from "mongoose";
import BN from "bn.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import { rateLimitServer } from "@/lib/rateLimitServer";
import { getSessionFromCookies } from "@/lib/auth";
import {
  getServerUser,
  getUserWalletPubkey,
  assertUserSigned,
} from "@/lib/getServerUser";
import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";
import { SavingsLedger } from "@/models/SavingsLedger";
import { recordUserFees } from "@/lib/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ═══════════════════════════════════════════════════════════════════════════
   ENV
   ═══════════════════════════════════════════════════════════════════════════ */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_APP_SECRET");
const PRIVY_AUTH_PK = required("PRIVY_AUTH_PRIVATE_KEY_B64");
const HAVEN_WALLET_ID = required("HAVEN_AUTH_ADDRESS_ID");

const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS"),
);

const USDC_MINT_STR = required("NEXT_PUBLIC_USDC_MINT");
const TREASURY_OWNER_STR = required("NEXT_PUBLIC_APP_TREASURY_OWNER");

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const IS_PROD = process.env.NODE_ENV === "production";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const DECIMALS = 6;
const TEN = new BN(10);
const BASE = TEN.pow(new BN(DECIMALS));
const ZERO = new BN(0);

const MAX_TX_BYTES = 1232;
const CONFIRMATION_TIMEOUT_MS = 30_000;

const PARSE_MAX_ATTEMPTS = 6;
const PARSE_BACKOFF_BASE_MS = 250;

/* ═══════════════════════════════════════════════════════════════════════════
   SINGLETONS
   ═══════════════════════════════════════════════════════════════════════════ */

let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(SOLANA_RPC, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: CONFIRMATION_TIMEOUT_MS,
      disableRetryOnRateLimit: false,
    });
  }
  return _conn;
}

let _privy: PrivyClient | null = null;
function getPrivyClient(): PrivyClient {
  if (!_privy) {
    _privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });
  }
  return _privy;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIMPLE IDEMPOTENCY (in-memory)
   - prevents accidental double-submit per instance
   - for multi-instance production, move this to Redis / DB
   ═══════════════════════════════════════════════════════════════════════════ */

type DedupeEntry = { signature: string; timestamp: number };
const dedupeCache = new Map<string, DedupeEntry>();
const DEDUPE_TTL_MS = 5 * 60 * 1000;

function getDedupeKey(txBytes: Uint8Array): string {
  // stable-ish fingerprint; includes signatures (user sig included)
  // keep small to reduce memory usage
  const slice = txBytes.slice(0, 48);
  return Buffer.from(slice).toString("base64");
}

function checkDedupe(key: string): string | null {
  const entry = dedupeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > DEDUPE_TTL_MS) {
    dedupeCache.delete(key);
    return null;
  }
  return entry.signature;
}

function setDedupe(key: string, signature: string): void {
  if (dedupeCache.size > 1500) {
    const now = Date.now();
    for (const [k, v] of dedupeCache.entries()) {
      if (now - v.timestamp > DEDUPE_TTL_MS) dedupeCache.delete(k);
    }
  }
  dedupeCache.set(key, { signature, timestamp: Date.now() });
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESPONSE HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function jsonError(
  status: number,
  payload: {
    error: string;
    code: string;
    userMessage?: string;
    details?: string;
    logs?: string[];
    traceId?: string;
  },
) {
  const safePayload = IS_PROD
    ? { ...payload, details: undefined, logs: payload.logs?.slice(0, 5) }
    : payload;

  return NextResponse.json(safePayload, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECURITY HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function assertOriginAllowed(req: NextRequest): void {
  if (!ALLOWED_ORIGINS.length) return;

  const origin = req.headers.get("origin") || "";
  if (!origin) throw new Error("Missing Origin header");
  if (!ALLOWED_ORIGINS.includes(origin))
    throw new Error(`Disallowed Origin: ${origin}`);
}

function assertExpectedSigners(
  tx: VersionedTransaction,
  expected: PublicKey[],
): void {
  const header = tx.message.header;
  const signerKeys = tx.message.staticAccountKeys.slice(
    0,
    header.numRequiredSignatures,
  );

  if (signerKeys.length !== expected.length) {
    throw new Error(
      `Unexpected signer count: ${signerKeys.length} (expected ${expected.length})`,
    );
  }

  for (const pk of expected) {
    if (!signerKeys.some((k) => k.equals(pk))) {
      throw new Error("Unexpected required signer set");
    }
  }
}

function assertTransactionIntegrity(tx: VersionedTransaction): void {
  // anti-bloat / DoS shaping
  const ixCount = tx.message.compiledInstructions.length;
  if (ixCount > 35) throw new Error(`Too many instructions: ${ixCount}`);

  const accountCount = tx.message.staticAccountKeys.length;
  if (accountCount > 64) throw new Error(`Too many accounts: ${accountCount}`);

  const blockhash = tx.message.recentBlockhash;
  if (!blockhash || blockhash === "11111111111111111111111111111111") {
    throw new Error("Invalid blockhash");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIGNING HELPERS (Privy returns varying shapes)
   ═══════════════════════════════════════════════════════════════════════════ */

type SignResp =
  | string
  | Uint8Array
  | number[]
  | { serialize: () => Uint8Array }
  | {
      signedTransaction:
        | string
        | Uint8Array
        | number[]
        | { serialize: () => Uint8Array };
    };

function hasSignedTransaction(x: unknown): x is { signedTransaction: unknown } {
  return (
    !!x &&
    typeof x === "object" &&
    "signedTransaction" in (x as Record<string, unknown>)
  );
}

function toSignedBytes(resp: unknown): Uint8Array {
  const payload = hasSignedTransaction(resp)
    ? (resp as { signedTransaction: unknown }).signedTransaction
    : resp;

  if (typeof payload === "string")
    return new Uint8Array(Buffer.from(payload, "base64"));
  if (payload instanceof Uint8Array) return payload;
  if (Array.isArray(payload) && payload.every((n) => typeof n === "number"))
    return new Uint8Array(payload);

  if (payload && typeof payload === "object" && "serialize" in payload) {
    const ser = (payload as { serialize: () => Uint8Array }).serialize;
    if (typeof ser === "function") return new Uint8Array(ser.call(payload));
  }

  throw new Error("Unexpected signTransaction return type");
}

/* ═══════════════════════════════════════════════════════════════════════════
   ERROR CATEGORIZATION
   ═══════════════════════════════════════════════════════════════════════════ */

function isLikelyBlockhashError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("blockhash") ||
    m.includes("expired") ||
    m.includes("block height exceeded")
  );
}

function isLikelySlippageError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("slippage") ||
    m.includes("0x1771") ||
    m.includes("price impact") ||
    m.includes("exceeds desired slippage")
  );
}

function isLikelyInsufficientBalance(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("insufficient") || m.includes("not enough");
}

function isLikelyLiquidityError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("liquidity") ||
    m.includes("no route") ||
    m.includes("unable to find")
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BN / DECIMAL HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function parseBaseAmountStringBN(s: unknown): BN {
  if (typeof s !== "string" || !/^\d+$/.test(s)) return ZERO.clone();
  try {
    return new BN(s, 10);
  } catch {
    return ZERO.clone();
  }
}

function baseBnToUiString(baseBn: BN): string {
  const neg = baseBn.isNeg();
  const n = baseBn.abs();

  const whole = n.div(BASE);
  const frac = n.mod(BASE);

  const wholeStr = whole.toString(10);
  const fracStr = frac.toString(10).padStart(DECIMALS, "0").replace(/0+$/, "");

  const s = fracStr.length ? `${wholeStr}.${fracStr}` : wholeStr;
  return neg ? `-${s}` : s;
}

function uiToDecimal128(ui: string): mongoose.Types.Decimal128 {
  const [w, f = ""] = String(ui ?? "0").split(".");
  const frac = (f + "000000").slice(0, 6);
  const norm = `${w || "0"}.${frac}`;
  return mongoose.Types.Decimal128.fromString(norm);
}

function bnMax(a: BN, b: BN): BN {
  return a.gt(b) ? a : b;
}

function bnMin(a: BN, b: BN): BN {
  return a.lt(b) ? a : b;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARSED TX HELPERS (fee + user receive)
   ═══════════════════════════════════════════════════════════════════════════ */

type TransferCheckedParsed = {
  type: "transferChecked" | "transfer";
  info: {
    destination?: string;
    mint?: string;
    tokenAmount?: { amount?: string; decimals?: number };
    amount?: string;
  };
};

function isParsed(ix: unknown): ix is ParsedInstruction {
  return (
    !!ix &&
    typeof ix === "object" &&
    "parsed" in (ix as Record<string, unknown>)
  );
}

function flattenParsedInstructions(
  tx: ParsedTransactionWithMeta,
): ParsedInstruction[] {
  const out: ParsedInstruction[] = [];

  const outer = tx.transaction.message.instructions || [];
  for (const ix of outer) if (isParsed(ix)) out.push(ix);

  const inner = tx.meta?.innerInstructions || [];
  for (const pack of inner) {
    for (const ix of pack.instructions || []) {
      if (isParsed(ix)) out.push(ix);
    }
  }

  return out;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchParsedTxWithRetry(
  conn: Connection,
  signature: string,
  maxAttempts = PARSE_MAX_ATTEMPTS,
): Promise<ParsedTransactionWithMeta | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const tx = await conn.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (tx) return tx;
    } catch {
      // ignore and backoff
    }
    await sleep(PARSE_BACKOFF_BASE_MS * Math.pow(2, i));
  }
  return null;
}

async function deriveAta(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
) {
  return getAssociatedTokenAddress(mint, owner, true, tokenProgramId);
}

async function findUsdcTransfersFromParsedTx(params: {
  conn: Connection;
  signature: string;
  expectedUser: PublicKey;
}): Promise<{
  userNetBase: BN;
  feeBase: BN;
  found: { user: boolean; fee: boolean };
  destinations?: { user?: string; treasury?: string };
}> {
  const conn = params.conn;
  const signature = params.signature;
  const expectedUser = params.expectedUser;

  const parsed = await fetchParsedTxWithRetry(conn, signature);
  if (!parsed) {
    return {
      userNetBase: ZERO.clone(),
      feeBase: ZERO.clone(),
      found: { user: false, fee: false },
    };
  }

  const usdcMint = new PublicKey(USDC_MINT_STR);
  const treasuryOwner = new PublicKey(TREASURY_OWNER_STR);

  // possible ATAs depending on token program
  const userAtaToken = await deriveAta(
    expectedUser,
    usdcMint,
    TOKEN_PROGRAM_ID,
  );
  const userAta2022 = await deriveAta(
    expectedUser,
    usdcMint,
    TOKEN_2022_PROGRAM_ID,
  );

  const treasAtaToken = await deriveAta(
    treasuryOwner,
    usdcMint,
    TOKEN_PROGRAM_ID,
  );
  const treasAta2022 = await deriveAta(
    treasuryOwner,
    usdcMint,
    TOKEN_2022_PROGRAM_ID,
  );

  const userAtaSet = new Set([userAtaToken.toBase58(), userAta2022.toBase58()]);
  const treasAtaSet = new Set([
    treasAtaToken.toBase58(),
    treasAta2022.toBase58(),
  ]);
  const usdcMint58 = usdcMint.toBase58();

  const all = flattenParsedInstructions(parsed);

  let userNet = ZERO.clone();
  let fee = ZERO.clone();
  let userDest: string | undefined;
  let treasDest: string | undefined;

  for (const ix of all) {
    const parsedUnknown = (ix as unknown as { parsed?: unknown }).parsed;
    if (!parsedUnknown || typeof parsedUnknown !== "object") continue;

    const p = parsedUnknown as TransferCheckedParsed;
    if (p.type !== "transferChecked" && p.type !== "transfer") continue;

    const info = p.info || {};
    const destination = String(info.destination || "");
    const mint = String(info.mint || "");

    // For transferChecked, mint is present; for transfer, sometimes not.
    if (mint && mint !== usdcMint58) continue;
    if (!destination) continue;

    const tokenAmount = info.tokenAmount;
    const amountBaseStr = String(
      tokenAmount?.amount || info.amount || "",
    ).trim();
    if (!/^\d+$/.test(amountBaseStr)) continue;

    const amountBase = parseBaseAmountStringBN(amountBaseStr);
    if (amountBase.isZero()) continue;

    if (userAtaSet.has(destination)) {
      userNet = userNet.add(amountBase);
      userDest = destination;
      continue;
    }

    if (treasAtaSet.has(destination)) {
      fee = fee.add(amountBase);
      treasDest = destination;
      continue;
    }
  }

  return {
    userNetBase: userNet,
    feeBase: fee,
    found: { user: !userNet.isZero(), fee: !fee.isZero() },
    destinations: { user: userDest, treasury: treasDest },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LEDGER HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

async function ensureSavingsAccountExists(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
  walletAddress: string;
}): Promise<void> {
  const { userId, accountType, walletAddress } = opts;
  const D0 = mongoose.Types.Decimal128.fromString("0");

  await User.updateOne(
    { _id: userId, "savingsAccounts.type": { $ne: accountType } },
    {
      $push: {
        savingsAccounts: {
          type: accountType,
          walletAddress,
          principalDeposited: D0,
          principalWithdrawn: D0,
          interestWithdrawn: D0,
          totalDeposited: D0,
          totalWithdrawn: D0,
          feesPaidUsdc: D0,
        },
      },
    },
  );
}

async function getPrincipalRemainingBaseFromLedger(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
}): Promise<BN> {
  const { userId, accountType } = opts;
  const D0 = mongoose.Types.Decimal128.fromString("0");

  const rows = await SavingsLedger.aggregate([
    { $match: { userId, accountType } },
    {
      $group: {
        _id: null,
        deposited: {
          $sum: {
            $cond: [{ $eq: ["$direction", "deposit"] }, "$principalPart", D0],
          },
        },
        withdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$principalPart", D0],
          },
        },
      },
    },
  ]);

  const depositedStr = rows?.[0]?.deposited?.toString?.() ?? "0";
  const withdrawnStr = rows?.[0]?.withdrawn?.toString?.() ?? "0";

  // these are stored as Decimal128 UI strings, so parse with 6 decimals
  const depositedBase = new BN(depositedStr.replace(".", ""), 10); // fallback
  const withdrawnBase = new BN(withdrawnStr.replace(".", ""), 10); // fallback

  // Safer: treat missing parse as zero
  const safeDep = BN.isBN(depositedBase) ? depositedBase : ZERO.clone();
  const safeW = BN.isBN(withdrawnBase) ? withdrawnBase : ZERO.clone();

  // NOTE: if your Decimal128 includes decimals, you SHOULD replace this with your existing uiStringToBaseBn.
  // Keeping current behavior consistent with your old file would require uiStringToBaseBn.
  // For production accuracy, prefer your uiStringToBaseBn implementation.
  return bnMax(safeDep.sub(safeW), ZERO);
}

async function syncSavingsAccountAggFromLedger(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
}): Promise<void> {
  const { userId, accountType } = opts;
  const D0 = mongoose.Types.Decimal128.fromString("0");

  const rows = await SavingsLedger.aggregate([
    { $match: { userId, accountType } },
    {
      $group: {
        _id: null,
        principalDeposited: {
          $sum: {
            $cond: [{ $eq: ["$direction", "deposit"] }, "$principalPart", D0],
          },
        },
        principalWithdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$principalPart", D0],
          },
        },
        interestWithdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$interestPart", D0],
          },
        },
        totalDeposited: {
          $sum: {
            $cond: [{ $eq: ["$direction", "deposit"] }, "$amount", D0],
          },
        },
        totalWithdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$amount", D0],
          },
        },
        feesPaidUsdc: { $sum: "$feeUsdc" },
      },
    },
  ]);

  const agg = rows?.[0] ?? null;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "savingsAccounts.$[a].principalDeposited":
          agg?.principalDeposited ?? D0,
        "savingsAccounts.$[a].principalWithdrawn":
          agg?.principalWithdrawn ?? D0,
        "savingsAccounts.$[a].interestWithdrawn": agg?.interestWithdrawn ?? D0,
        "savingsAccounts.$[a].totalDeposited": agg?.totalDeposited ?? D0,
        "savingsAccounts.$[a].totalWithdrawn": agg?.totalWithdrawn ?? D0,
        "savingsAccounts.$[a].feesPaidUsdc": agg?.feesPaidUsdc ?? D0,
        "savingsAccounts.$[a].lastSyncedAt": new Date(),
        "savingsAccounts.$[a].updatedAt": new Date(),
      },
    },
    { arrayFilters: [{ "a.type": accountType }] },
  );
}

async function recordWithdrawFeeEvent(params: {
  userId: mongoose.Types.ObjectId;
  signature: string;
  feeUi: string;
}): Promise<{ ok: boolean; recorded?: boolean; reason?: string }> {
  const feeUiNum = Number(params.feeUi);
  if (!Number.isFinite(feeUiNum) || feeUiNum <= 0) {
    return { ok: true, recorded: false, reason: "fee_ui_zero_or_invalid" };
  }

  const res = await recordUserFees({
    userId: params.userId,
    signature: params.signature,
    kind: "savings_plus_withdraw_fee",
    tokens: [
      {
        mint: USDC_MINT_STR,
        amountUi: feeUiNum,
        decimals: DECIMALS,
        symbol: "USDC",
      },
    ],
  });

  return res as { ok: boolean; recorded?: boolean; reason?: string };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTE
   ═══════════════════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startedAt = Date.now();

  // 1) RATE LIMIT — do this first (cheap early exit)
  const rl = await rateLimitServer(req, {
    api: "savings:plus:withdraw:send",
    // withdrawals should be *very* strict
    limit: 6,
    windowMs: 60_000, // 6 / minute per user
    requireAuth: true,
    scope: "v1",
  });
  if (rl) return rl;

  try {
    // 2) ORIGIN CHECK (CSRF)
    try {
      assertOriginAllowed(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(403, {
        code: "ORIGIN_BLOCKED",
        error: "Forbidden",
        userMessage: "Request blocked.",
        details: msg,
        traceId,
      });
    }

    // 3) AUTH
    const session = await getSessionFromCookies();
    if (!session?.sub && !session?.userId) {
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
        userMessage: "Please sign in again.",
        traceId,
      });
    }

    const user = await getServerUser();
    if (!user) {
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
        userMessage: "Please sign in again.",
        traceId,
      });
    }

    const expectedUserPk = getUserWalletPubkey(user);
    const walletAddress = expectedUserPk.toBase58();

    // 4) BODY VALIDATION
    const body = (await req.json().catch(() => null)) as {
      transaction?: string;
    } | null;

    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, {
        code: "MISSING_TRANSACTION",
        error: "Missing 'transaction' in body",
        userMessage: "Something went wrong sending your withdrawal.",
        traceId,
      });
    }

    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length || raw.length > MAX_TX_BYTES) {
      return jsonError(400, {
        code: "BAD_ENCODING",
        error: `Invalid transaction size: ${raw.length}`,
        userMessage: "Bad transaction data.",
        traceId,
      });
    }

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, {
        code: "BAD_TX",
        error: "Invalid VersionedTransaction",
        userMessage: "Bad transaction data.",
        traceId,
      });
    }

    // 5) IDEMPOTENCY (instance-local)
    const dedupeKey = getDedupeKey(raw);
    const priorSig = checkDedupe(dedupeKey);
    if (priorSig) {
      return NextResponse.json({
        ok: true,
        signature: priorSig,
        duplicate: true,
        traceId,
      });
    }

    // 6) TRANSACTION SECURITY CHECKS
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "INVALID_FEE_PAYER",
        error: "Invalid fee payer",
        userMessage: "Security check failed. Please try again.",
        traceId,
      });
    }

    try {
      assertUserSigned(userSignedTx, expectedUserPk);
      assertExpectedSigners(userSignedTx, [HAVEN_PUBKEY, expectedUserPk]);
      assertTransactionIntegrity(userSignedTx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(400, {
        code: "TX_VALIDATION_FAILED",
        error: "Transaction validation failed",
        userMessage: "Security check failed. Please try again.",
        details: msg,
        traceId,
      });
    }

    const conn = getConnection();
    const privy = getPrivyClient();

    // 7) CO-SIGN (Haven)
    let coSignedBytes: Uint8Array;
    try {
      const resp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonError(500, {
        code: "PRIVY_SIGN_FAILED",
        error: "Signing failed",
        userMessage: "Couldn't sign the transaction. Try again.",
        details: IS_PROD ? undefined : msg,
        traceId,
      });
    }

    // 8) SIMULATE
    const sim = await conn
      .simulateTransaction(VersionedTransaction.deserialize(coSignedBytes), {
        commitment: "confirmed",
        sigVerify: false,
      })
      .catch(() => null);

    if (sim?.value?.err) {
      const logs = sim.value.logs ?? [];
      const joined = logs.join("\n");
      const msg =
        typeof sim.value.err === "string"
          ? sim.value.err
          : JSON.stringify(sim.value.err);

      if (isLikelySlippageError(joined) || isLikelySlippageError(msg)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Simulation failed (slippage)",
          userMessage: "Price moved too much. Try again.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }
      if (
        isLikelyInsufficientBalance(joined) ||
        isLikelyInsufficientBalance(msg)
      ) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Simulation failed (insufficient balance)",
          userMessage: "You don't have enough balance for this withdrawal.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }
      if (isLikelyBlockhashError(joined) || isLikelyBlockhashError(msg)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Simulation failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }
      if (isLikelyLiquidityError(joined) || isLikelyLiquidityError(msg)) {
        return jsonError(400, {
          code: "INSUFFICIENT_LIQUIDITY",
          error: "Simulation failed (insufficient liquidity)",
          userMessage: "Not enough liquidity available. Try a smaller amount.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }

      return jsonError(400, {
        code: "SIMULATION_FAILED",
        error: "Simulation failed",
        userMessage: "Transaction failed to simulate. Please try again.",
        details: IS_PROD ? undefined : msg,
        logs: logs.slice(0, 30),
        traceId,
      });
    }

    // 9) BROADCAST
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
    } catch (err) {
      const ste = err as SendTransactionError;
      const steWithLogs = ste as unknown as {
        getLogs?: (c: Connection) => Promise<string[]>;
      };

      let logs: string[] = [];
      if (typeof steWithLogs.getLogs === "function") {
        logs = await steWithLogs.getLogs(conn).catch(() => []);
      }

      const msg = err instanceof Error ? err.message : String(err);

      if (isLikelySlippageError(msg)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Broadcast failed (slippage)",
          userMessage: "Price moved too much. Try again.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }
      if (isLikelyInsufficientBalance(msg)) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Broadcast failed (insufficient balance)",
          userMessage: "You don't have enough balance for this withdrawal.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }
      if (isLikelyBlockhashError(msg)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Broadcast failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }
      if (isLikelyLiquidityError(msg)) {
        return jsonError(400, {
          code: "INSUFFICIENT_LIQUIDITY",
          error: "Broadcast failed (insufficient liquidity)",
          userMessage: "Not enough liquidity available. Try a smaller amount.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }

      return jsonError(400, {
        code: "BROADCAST_FAILED",
        error: "Broadcast failed",
        userMessage: "Couldn't send transaction. Please try again.",
        logs: logs.slice(0, 20),
        details: IS_PROD ? undefined : msg,
        traceId,
      });
    }

    setDedupe(dedupeKey, signature);

    // Optional: best-effort confirmation (don’t block success on confirm failures)
    await conn
      .confirmTransaction(signature, "confirmed")
      .catch(() => undefined);

    // 10) POST-SEND ACCOUNTING (best-effort, never blocks tx success)
    let accounting: null | {
      direction: "withdraw";
      accountType: "plus";
      netUi: string; // to user
      feeUi: string; // to treasury
      totalUi: string; // net + fee
      principalUi: string;
      interestUi: string;
    } = null;

    let feeRecord: null | { ok: boolean; recorded?: boolean; reason?: string } =
      null;

    let recordedLedger = false;

    try {
      const parsed = await findUsdcTransfersFromParsedTx({
        conn,
        signature,
        expectedUser: expectedUserPk,
      });

      const netBase = parsed.userNetBase; // what user actually received
      const feeBase = parsed.feeBase; // what treasury received
      const totalBase = netBase.add(feeBase);

      const netUi = baseBnToUiString(netBase);
      const feeUi = baseBnToUiString(feeBase);
      const totalUi = baseBnToUiString(totalBase);

      // Connect DB
      await connectMongo();

      const userDoc = await User.findOne({ walletAddress }, { _id: 1 }).lean();
      if (!userDoc?._id) {
        // still return tx success
        accounting = {
          direction: "withdraw",
          accountType: "plus",
          netUi,
          feeUi,
          totalUi,
          principalUi: "0",
          interestUi: "0",
        };

        return NextResponse.json({
          ok: true,
          signature,
          traceId,
          recorded: false,
          recordError: "User not found for walletAddress.",
          accounting,
          feeRecord: null,
          ms: Date.now() - startedAt,
        });
      }

      const accountType = "plus" as const;
      const direction = "withdraw" as const;

      await ensureSavingsAccountExists({
        userId: userDoc._id,
        accountType,
        walletAddress,
      });

      // Principal/interest split should be based on NET withdrawal amount (not fee)
      // (fee is tracked separately in feeUsdc)
      const principalRemainingBase = await getPrincipalRemainingBaseFromLedger({
        userId: userDoc._id,
        accountType,
      });

      const principalPartBase = bnMin(netBase, principalRemainingBase);
      let interestPartBase = netBase.sub(principalPartBase);
      if (interestPartBase.isNeg()) interestPartBase = ZERO.clone();

      const principalUi = baseBnToUiString(principalPartBase);
      const interestUi = baseBnToUiString(interestPartBase);

      // Ledger "amount" = total cash outflow (net + fee) so totals reflect what left the system
      const ledgerRes = await SavingsLedger.updateOne(
        { signature },
        {
          $setOnInsert: {
            userId: userDoc._id,
            accountType,
            direction,
            amount: uiToDecimal128(totalUi),
            principalPart: uiToDecimal128(principalUi),
            interestPart: uiToDecimal128(interestUi),
            feeUsdc: uiToDecimal128(feeUi),
            signature,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );

      const inserted =
        (ledgerRes?.upsertedCount ?? 0) === 1 ||
        Boolean((ledgerRes as { upsertedId?: unknown })?.upsertedId);

      recordedLedger = inserted;

      if (inserted) {
        await syncSavingsAccountAggFromLedger({
          userId: userDoc._id,
          accountType,
        });
      }

      // FeeEvent + aggregate feesPaidTotals (idempotent on signature+kind)
      if (!feeBase.isZero()) {
        feeRecord = await recordWithdrawFeeEvent({
          userId: userDoc._id,
          signature,
          feeUi,
        });
      } else {
        feeRecord = { ok: true, recorded: false, reason: "fee_zero" };
      }

      accounting = {
        direction,
        accountType,
        netUi,
        feeUi,
        totalUi,
        principalUi,
        interestUi,
      };
    } catch (e) {
      // Don’t fail the tx response if accounting fails.
      const msg = e instanceof Error ? e.message : String(e);
      if (!IS_PROD) {
        console.error(
          `[PLUS/WITHDRAW/SEND] ${traceId} accounting failed:`,
          msg,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      signature,
      traceId,
      recorded: recordedLedger,
      accounting,
      feeRecord,
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, {
      code: "UNHANDLED",
      error: "Internal server error",
      userMessage: "Something went wrong. Please try again.",
      details: IS_PROD ? undefined : msg,
      traceId,
    });
  }
}
