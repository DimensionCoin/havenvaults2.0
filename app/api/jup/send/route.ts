// app/api/jup/send/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendTransactionError,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  SystemProgram,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import mongoose from "mongoose";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import { connect } from "@/lib/db";
import User from "@/models/User";
import { FeeEvent } from "@/models/FeeEvent";
import { TOKENS, getCluster, getMintFor } from "@/lib/tokenConfig";
import {
  requireServerUser,
  getUserWalletPubkey,
  assertUserSigned,
} from "@/lib/getServerUser";
import { rateLimitServer } from "@/lib/rateLimitServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── ENV ───────── */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SOLANA_RPC = required("SOLANA_RPC");
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_APP_SECRET");
const PRIVY_AUTH_PK = required("PRIVY_AUTH_PRIVATE_KEY_B64");
const HAVEN_WALLET_ID = required("HAVEN_AUTH_ADDRESS_ID");

const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS"),
);

// ✅ Only treasury OWNER is stored in env
const TREASURY_OWNER = new PublicKey(
  required("NEXT_PUBLIC_APP_TREASURY_OWNER"),
);

/**
 * Hard cap on how many lamports Haven is allowed to fund in *a single tx*
 * via SystemProgram createAccount/createAccountWithSeed.
 * - ATA creation rent is tiny (~0.002 SOL).
 * - This blocks draining attacks where a user asks Haven to fund a large createAccount.
 */
const HAVEN_MAX_LAMPORTS_FUND_PER_TX = Number(
  process.env.HAVEN_MAX_LAMPORTS_FUND_PER_TX ?? "20000000", // 0.02 SOL default
);

/* ───────── Broadcast/Confirm Tuning ───────── */

const SEND_CONFIG = {
  SKIP_PREFLIGHT: false,
  MAX_RETRIES: 2,
  CONFIRM_COMMITMENT: "confirmed" as const,
  CONFIRM_TIMEOUT_MS: 6_500,
  RETURN_SIG_ON_TIMEOUT: true,
};

/* ───────── Token Lookup ───────── */

const CLUSTER = getCluster();

function getSymbolForMint(mint: string): string | undefined {
  if (!mint) return undefined;
  for (const token of TOKENS) {
    const tokenMint = getMintFor(token, CLUSTER);
    if (tokenMint === mint) return token.symbol;
  }
  return undefined;
}

/* ───────── Singletons ───────── */

let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(SOLANA_RPC, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 20_000,
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

/* ───────── Types ───────── */

interface SendRequestBody {
  transaction?: string; // base64 VersionedTransaction, already signed by user
  feeMint?: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
}

type JsonErrorExtra = Record<string, unknown> | undefined;

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

function hasSignedTransaction(x: unknown): x is {
  signedTransaction:
    | string
    | Uint8Array
    | number[]
    | { serialize: () => Uint8Array };
} {
  return (
    !!x &&
    typeof x === "object" &&
    "signedTransaction" in (x as Record<string, unknown>)
  );
}

type UserWithWalletLike = {
  walletAddress?: string | null;
  depositWallet?: string | { address?: string | null } | null;
  embeddedWallet?: string | { address?: string | null } | null;
};

type TransferCheckedParsed = {
  type: "transferChecked";
  info: {
    destination?: string;
    mint?: string;
    tokenAmount?: { amount?: string; decimals?: number };
  };
};

type ParsedIxWithProgramId = ParsedInstruction & { programId?: string };
type MongoDuplicateKeyError = { code?: number };

/* ───────── Basic Helpers ───────── */

function jsonError(status: number, error: string, extra?: JsonErrorExtra) {
  return NextResponse.json({ error, ...(extra || {}) }, { status });
}

function toSignedBytes(resp: unknown): Uint8Array {
  const payload: SignResp = hasSignedTransaction(resp)
    ? resp.signedTransaction
    : (resp as SignResp);

  if (typeof payload === "string") {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  if (payload instanceof Uint8Array) return payload;
  if (Array.isArray(payload) && payload.every((n) => typeof n === "number")) {
    return new Uint8Array(payload);
  }
  if (
    payload &&
    typeof payload === "object" &&
    "serialize" in payload &&
    typeof (payload as { serialize: unknown }).serialize === "function"
  ) {
    return new Uint8Array(
      (payload as { serialize: () => Uint8Array }).serialize(),
    );
  }
  throw new Error("Unexpected signTransaction return type");
}

function isBlockhashError(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("blockhash") || m.includes("expired");
}

function isBlockhashNotFoundError(msg: string) {
  return msg.toLowerCase().includes("blockhash not found");
}

function isSlippageError(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("slippage") || msg.includes("0x1771");
}

function isInsufficientError(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("insufficient") || /\b0x1\b/.test(msg);
}

function isAlreadyProcessedError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("already processed") ||
    m.includes("alreadyconfirmed") ||
    m.includes("already confirmed") ||
    m.includes("duplicate")
  );
}

/* ───────── SystemProgram guard (prevents draining Haven SOL) ─────────
   We only allow Haven to pay *small* system lamports for safe account creation (e.g. ATA rent).
   We reject:
   - any SystemProgram.transfer from HAVEN_PUBKEY
   - any createAccount/createAccountWithSeed where lamports is too large
   We also require every instruction's programIdIndex to point to a STATIC key, so we can validate safely.
*/

function readU32LE(buf: Uint8Array, offset: number): number {
  const b = Buffer.from(buf);
  return b.readUInt32LE(offset);
}

function readU64LEBigint(buf: Uint8Array, offset: number): bigint {
  const b = Buffer.from(buf);
  const lo = BigInt(b.readUInt32LE(offset));
  const hi = BigInt(b.readUInt32LE(offset + 4));
  return (hi << BigInt(32)) + lo;
}

/**
 * Returns total lamports Haven funds via SystemProgram create* in this tx.
 * Throws on disallowed patterns.
 */
function validateHavenSpendGuards(tx: VersionedTransaction): {
  fundedLamports: number;
} {
  const msg = tx.message;

  const staticKeys = msg.staticAccountKeys;
  const staticLen = staticKeys.length;

  // Ensure we can resolve every programId deterministically (no program IDs in lookups).
  // This is a strong safety invariant for sponsored txs.
  const compiled = (msg as unknown as { compiledInstructions?: unknown })
    .compiledInstructions as
    | Array<{
        programIdIndex: number;
        accountKeyIndexes: number[];
        data: Uint8Array;
      }>
    | undefined;

  if (!compiled || !Array.isArray(compiled)) {
    throw new Error("Unsupported transaction message format");
  }

  let fundedLamports = 0;

  for (const ix of compiled) {
    const pidIndex = ix.programIdIndex;

    if (!Number.isFinite(pidIndex) || pidIndex < 0) {
      throw new Error("Invalid instruction program id index");
    }

    // Must be static so we can validate it.
    if (pidIndex >= staticLen) {
      throw new Error("Unsafe transaction (program id in lookup table)");
    }

    const programId = staticKeys[pidIndex];

    // Only guard SystemProgram. (Token drains would require authority signers; Haven signer is the payer.)
    if (!programId.equals(SystemProgram.programId)) continue;

    const data = ix.data;
    if (!(data instanceof Uint8Array) || data.length < 4) {
      throw new Error("Invalid SystemProgram instruction data");
    }

    const ixType = readU32LE(data, 0);

    // SystemProgram instruction layouts:
    // 0 = CreateAccount { lamports: u64, space: u64, programId: Pubkey }
    // 2 = Transfer { lamports: u64 }
    // 3 = CreateAccountWithSeed { base: Pubkey, seed: string, lamports: u64, space: u64, programId: Pubkey }
    //
    // We care about lamports + who is "from".
    //
    // Account index conventions (for Transfer/CreateAccount):
    // - accounts[0] is "from"/payer
    // - accounts[1] is "to"/new account
    const acctIdxs = Array.isArray(ix.accountKeyIndexes)
      ? ix.accountKeyIndexes
      : [];

    const fromIndex = acctIdxs[0];
    if (typeof fromIndex !== "number" || fromIndex < 0) {
      throw new Error("Invalid SystemProgram accounts");
    }

    const fromKey = fromIndex < staticLen ? staticKeys[fromIndex] : undefined;

    // If we can't resolve fromKey, treat as unsafe.
    if (!fromKey) {
      throw new Error("Unsafe transaction (system fromKey unresolved)");
    }

    // ---- Transfer: hard block if from=Haven ----
    if (ixType === 2) {
      // transfer lamports is at offset 4
      if (data.length < 12) throw new Error("Invalid transfer data");
      const lamports = readU64LEBigint(data, 4);

      if (fromKey.equals(HAVEN_PUBKEY)) {
        throw new Error(
          `Unsafe transaction (SystemProgram.transfer from fee payer: ${lamports.toString()} lamports)`,
        );
      }

      continue;
    }

    // ---- CreateAccount: cap lamports if from=Haven ----
    if (ixType === 0) {
      if (data.length < 12) throw new Error("Invalid createAccount data");
      const lamports = readU64LEBigint(data, 4);

      if (fromKey.equals(HAVEN_PUBKEY)) {
        const n = Number(lamports);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("Invalid createAccount lamports");
        }
        fundedLamports += n;

        if (n > HAVEN_MAX_LAMPORTS_FUND_PER_TX) {
          throw new Error(
            `Unsafe transaction (createAccount funds too much: ${n} lamports)`,
          );
        }
      }

      continue;
    }

    // ---- CreateAccountWithSeed: cap lamports if from=Haven ----
    if (ixType === 3) {
      // The lamports offset depends on seed length; decode minimally:
      // data = u32 ixType + basePubkey(32) + seedLen(u32) + seedBytes + lamports(u64) + space(u64) + programId(32)
      if (data.length < 4 + 32 + 4 + 8) {
        throw new Error("Invalid createAccountWithSeed data");
      }

      const seedLen = readU32LE(data, 4 + 32);
      const lamportsOffset = 4 + 32 + 4 + seedLen;

      if (data.length < lamportsOffset + 8) {
        throw new Error("Invalid createAccountWithSeed lamports");
      }

      const lamports = readU64LEBigint(data, lamportsOffset);

      if (fromKey.equals(HAVEN_PUBKEY)) {
        const n = Number(lamports);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("Invalid createAccountWithSeed lamports");
        }
        fundedLamports += n;

        if (n > HAVEN_MAX_LAMPORTS_FUND_PER_TX) {
          throw new Error(
            `Unsafe transaction (createAccountWithSeed funds too much: ${n} lamports)`,
          );
        }
      }

      continue;
    }

    // Other SystemProgram instructions: allow by default,
    // BUT if you ever see abuse here, flip this to a strict allowlist.
  }

  // Cap total funded lamports across multiple create instructions too.
  if (fundedLamports > HAVEN_MAX_LAMPORTS_FUND_PER_TX) {
    throw new Error(
      `Unsafe transaction (total funded lamports too much: ${fundedLamports})`,
    );
  }

  return { fundedLamports };
}

/* ───────── fees helpers (INLINED, no BigInt literals) ───────── */

const D128 = mongoose.Types.Decimal128;

function clampDecimals(decimals: number) {
  const d = Number.isFinite(decimals) ? Math.floor(decimals) : 0;
  return Math.max(0, Math.min(18, d));
}

function normalizeMint(mint: string): string {
  return String(mint || "").trim();
}

function normalizeSymbol(symbol?: string | null): string | undefined {
  const s = typeof symbol === "string" ? symbol.trim() : "";
  return s ? s : undefined;
}

function baseUnitsToUiString(baseUnits: string, decimals: number): string {
  const d = clampDecimals(decimals);

  let x: bigint;
  try {
    x = BigInt(String(baseUnits || "0"));
  } catch {
    x = BigInt("0");
  }

  if (x <= BigInt("0")) return "0";
  if (d === 0) return x.toString();

  const denom = BigInt("10") ** BigInt(String(d));
  const whole = x / denom;
  const frac = x % denom;

  const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

function toD128FromUiString(amountUiStr: string): mongoose.Types.Decimal128 {
  const s = String(amountUiStr || "0").trim();
  return D128.fromString(s === "" ? "0" : s);
}

function addBase(a: string, b: string): string {
  const x = BigInt(a || "0");
  const y = BigInt(b || "0");
  return (x + y).toString();
}

type FeeToken = {
  mint: string;
  amountBase: string;
  decimals: number;
  symbol?: string;
};

type RecordResult =
  | { ok: true; recorded: true }
  | { ok: true; recorded: false; reason: "duplicate" | "zero" };

async function recordUserFeesExact(params: {
  userId: mongoose.Types.ObjectId;
  signature: string;
  kind: string;
  tokens: FeeToken[];
}): Promise<RecordResult> {
  const userId = params.userId;
  const signature = String(params.signature || "").trim();
  const kind = String(params.kind || "").trim();

  if (!signature) throw new Error("recordUserFeesExact: signature required");
  if (!userId) throw new Error("recordUserFeesExact: userId required");
  if (!kind) throw new Error("recordUserFeesExact: kind required");

  const tokensRaw = Array.isArray(params.tokens) ? params.tokens : [];

  const merged = new Map<
    string,
    { mint: string; decimals: number; symbol?: string; amountBase: string }
  >();

  for (const t of tokensRaw) {
    const mint = normalizeMint(t?.mint);
    if (!mint) continue;

    const decimals = clampDecimals(Number(t?.decimals));
    const symbol = normalizeSymbol(t?.symbol);

    let base = "0";
    try {
      const bi = BigInt(String(t?.amountBase || "0"));
      if (bi <= BigInt("0")) continue;
      base = bi.toString();
    } catch {
      continue;
    }

    const prev = merged.get(mint);
    if (!prev) {
      merged.set(mint, { mint, decimals, symbol, amountBase: base });
    } else {
      merged.set(mint, {
        mint,
        decimals: prev.decimals || decimals,
        symbol: prev.symbol ?? symbol,
        amountBase: addBase(prev.amountBase, base),
      });
    }
  }

  const tokens = Array.from(merged.values());
  if (tokens.length === 0) return { ok: true, recorded: false, reason: "zero" };

  try {
    await FeeEvent.create({
      userId,
      signature,
      kind,
      tokens: tokens.map((t) => {
        const uiStr = baseUnitsToUiString(t.amountBase, t.decimals);
        return {
          mint: t.mint,
          symbol: t.symbol,
          decimals: t.decimals,
          amountUi: toD128FromUiString(uiStr),
        };
      }),
    });
  } catch (e) {
    const err = e as MongoDuplicateKeyError;
    if (err?.code === 11000) {
      return { ok: true, recorded: false, reason: "duplicate" };
    }
    throw e;
  }

  const user = await User.findById(userId).select({ feesPaidTotals: 1 }).lean();
  if (!user) return { ok: true, recorded: true };

  const u = user as unknown as { feesPaidTotals?: Record<string, unknown> };
  const existing =
    u.feesPaidTotals && typeof u.feesPaidTotals === "object"
      ? (u.feesPaidTotals as Record<string, unknown>)
      : {};

  const $set: Record<string, unknown> = {};

  for (const t of tokens) {
    const curRaw = existing[t.mint];
    const cur =
      curRaw && typeof curRaw === "object"
        ? (curRaw as Record<string, unknown>)
        : {};

    const curBase =
      typeof (cur as { amountBase?: unknown }).amountBase === "string"
        ? ((cur as { amountBase?: string }).amountBase as string)
        : "0";

    const nextBase = addBase(curBase, t.amountBase);

    $set[`feesPaidTotals.${t.mint}.amountBase`] = nextBase;

    $set[`feesPaidTotals.${t.mint}.decimals`] =
      typeof (cur as { decimals?: unknown }).decimals === "number" &&
      Number.isFinite((cur as { decimals?: number }).decimals) &&
      (cur as { decimals?: number }).decimals! > 0
        ? (cur as { decimals?: number }).decimals
        : t.decimals;

    if (t.symbol && !(cur as { symbol?: unknown }).symbol) {
      $set[`feesPaidTotals.${t.mint}.symbol`] = t.symbol;
    }
  }

  if (Object.keys($set).length) {
    await User.updateOne({ _id: userId }, { $set });
  }

  return { ok: true, recorded: true };
}

/* ───────── Parse fee transfer from confirmed tx ───────── */

function isParsed(ix: unknown): ix is ParsedInstruction {
  return (
    !!ix &&
    typeof ix === "object" &&
    "parsed" in (ix as Record<string, unknown>)
  );
}

function flattenParsedInstructions(tx: ParsedTransactionWithMeta) {
  const out: ParsedInstruction[] = [];

  const outer = tx.transaction.message.instructions || [];
  for (const ix of outer) {
    if (isParsed(ix)) out.push(ix);
  }

  const inner = tx.meta?.innerInstructions || [];
  for (const pack of inner) {
    for (const ix of pack.instructions || []) {
      if (isParsed(ix)) out.push(ix);
    }
  }

  return out;
}

async function fetchParsedTxWithRetry(
  conn: Connection,
  signature: string,
  attempts = 5,
): Promise<ParsedTransactionWithMeta | null> {
  for (let i = 0; i < attempts; i++) {
    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 150 * (i + 1)));
  }
  return null;
}

async function deriveTreasuryAtaForMint(params: {
  mint: PublicKey;
  tokenProgramId: PublicKey;
}): Promise<PublicKey> {
  return getAssociatedTokenAddress(
    params.mint,
    TREASURY_OWNER,
    true,
    params.tokenProgramId,
  );
}

/* ───────── Fee recorder (fire-and-forget) ───────── */

async function recordSwapFeeFromChainAsync(params: {
  userId: string;
  signature: string;
  feeMintHint?: string;
}): Promise<void> {
  const { userId, signature, feeMintHint } = params;

  try {
    await connect();

    const mongoId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : null;

    const user =
      (mongoId
        ? await User.findById(mongoId).select({ _id: 1 }).lean()
        : null) ||
      (await User.findOne({ privyId: userId }).select({ _id: 1 }).lean());

    if (!user?._id) {
      console.warn("[JUP/SEND] Fee recording skipped: user not found", userId);
      return;
    }

    const conn = getConnection();
    const parsed = await fetchParsedTxWithRetry(conn, signature, 5);

    if (!parsed) {
      console.warn(
        "[JUP/SEND] Fee parse skipped: tx not available yet",
        signature.slice(0, 8),
      );
      return;
    }

    const all = flattenParsedInstructions(parsed);
    const hintMint = feeMintHint ? feeMintHint.trim() : "";

    for (const ix of all) {
      const parsedIxUnknown = (ix as unknown as { parsed?: unknown }).parsed;
      if (!parsedIxUnknown || typeof parsedIxUnknown !== "object") continue;

      const parsedIx = parsedIxUnknown as TransferCheckedParsed;
      if (parsedIx.type !== "transferChecked") continue;

      const info = parsedIx.info || {};
      const destination = String(info.destination || "");
      const mint = String(info.mint || "");
      const tokenAmount = info.tokenAmount || {};
      const amountBase = String(tokenAmount.amount || "");
      const decimals = Number(tokenAmount.decimals ?? 0);

      if (!destination || !mint || !amountBase) continue;
      if (hintMint && mint !== hintMint) continue;

      const programIdStr = String(
        (ix as ParsedIxWithProgramId).programId || "",
      );
      const tokenProgramId =
        programIdStr === TOKEN_2022_PROGRAM_ID.toBase58()
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

      const treasuryAta = await deriveTreasuryAtaForMint({
        mint: new PublicKey(mint),
        tokenProgramId,
      });

      if (destination !== treasuryAta.toBase58()) continue;

      const symbol = getSymbolForMint(mint);

      const result = await recordUserFeesExact({
        userId: user._id,
        signature,
        kind: "swap",
        tokens: [
          {
            mint,
            amountBase,
            decimals: clampDecimals(decimals),
            symbol,
          },
        ],
      });

      if (result.ok && result.recorded) {
        console.log(
          `[JUP/SEND] Fee recorded: ${amountBase} base units (${symbol || mint.slice(0, 8)}) for ${signature.slice(0, 8)}`,
        );
      } else if (result.ok && !result.recorded) {
        console.log(
          `[JUP/SEND] Fee skipped (${result.reason}): ${signature.slice(0, 8)}`,
        );
      }

      return;
    }

    console.warn(
      "[JUP/SEND] No treasury transferChecked found for fee in tx",
      signature.slice(0, 8),
      { feeMintHint: hintMint || undefined },
    );
  } catch (err) {
    console.error(
      "[JUP/SEND] Fee recording failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/* ───────── Confirm helper (fast) ───────── */

async function confirmFast(params: {
  conn: Connection;
  signature: string;
  lastValidBlockHeight?: number;
  blockhash?: string;
  timeoutMs: number;
}) {
  const { conn, signature, lastValidBlockHeight, blockhash, timeoutMs } =
    params;

  const p = (async () => {
    if (blockhash && typeof lastValidBlockHeight === "number") {
      return conn.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        SEND_CONFIG.CONFIRM_COMMITMENT,
      );
    }
    return conn.confirmTransaction(signature, SEND_CONFIG.CONFIRM_COMMITMENT);
  })();

  const t = new Promise<"timeout">((r) =>
    setTimeout(() => r("timeout"), timeoutMs),
  );

  const res = await Promise.race([p, t]);
  if (res === "timeout") return { ok: false as const, timeout: true as const };

  const value = (res as unknown as { value?: { err?: unknown } }).value;
  const err = value?.err;
  if (err) return { ok: false as const, timeout: false as const, err };
  return { ok: true as const, timeout: false as const };
}

/* ───────── Route Handler ───────── */

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // ─────────── Auth (server cookie) ───────────
    let userPk: PublicKey;
    let userIdForFeeEvents: string;

    try {
      const user = await requireServerUser();
      userPk = getUserWalletPubkey(user as UserWithWalletLike);

      const u = user as unknown as { _id?: unknown; privyId?: unknown };
      userIdForFeeEvents =
        typeof u?._id === "string"
          ? u._id
          : u?._id && typeof u._id === "object"
            ? String(u._id)
            : typeof u?.privyId === "string"
              ? u.privyId
              : "";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unauthorized";
      return jsonError(401, "Unauthorized", {
        code: "UNAUTHORIZED",
        userMessage: "Please log in again.",
        tip: "Refresh the app and try again.",
        details: msg,
      });
    }

    // ✅ Rate limit EARLY (after auth, before any signing/broadcast)
    // Money-moving endpoint: fail closed.
    const blocked = await rateLimitServer(req, {
      api: "jup:send",
      requireAuth: true,
      allowIpFallback: false,
      failMode: "closed",

      globalTiers: [
        { limit: 30, windowMs: 2000, suffix: "g_burst" },
        { limit: 300, windowMs: 60_000, suffix: "g_minute" },
        { limit: 2000, windowMs: 60 * 60 * 1000, suffix: "g_hour" },
      ],

      tiers: [
        { limit: 2, windowMs: 2000, suffix: "burst" }, // double-click protection
        { limit: 6, windowMs: 60_000, suffix: "minute" },
        { limit: 30, windowMs: 60 * 60 * 1000, suffix: "hour" },
      ],
    });
    if (blocked) return blocked;

    // ─────────── Parse Body ───────────
    const body = (await req.json().catch(() => null)) as SendRequestBody | null;

    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, "Missing 'transaction' in body", {
        code: "INVALID_PAYLOAD",
        userMessage: "Something went wrong sending this swap.",
      });
    }

    const feeMintHint =
      typeof body.feeMint === "string" ? body.feeMint.trim() : undefined;

    const buildBlockhash =
      typeof body.recentBlockhash === "string"
        ? body.recentBlockhash
        : undefined;
    const buildLastValid =
      typeof body.lastValidBlockHeight === "number"
        ? body.lastValidBlockHeight
        : undefined;

    // ─────────── Deserialize Transaction ───────────
    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length) {
      return jsonError(400, "Invalid transaction encoding", {
        code: "INVALID_TX_ENCODING",
        userMessage: "This swap request is invalid. Please try again.",
      });
    }

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, "Invalid VersionedTransaction", {
        code: "INVALID_TX",
        userMessage: "This swap request is invalid. Please try again.",
      });
    }

    // ─────────── Validate Transaction (server invariants) ───────────

    // Fee payer must be Haven
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, "Invalid fee payer", {
        code: "INVALID_FEE_PAYER",
        userMessage:
          "This swap request is invalid. Please refresh and try again.",
      });
    }

    const blockhash = userSignedTx.message.recentBlockhash;
    if (!blockhash || blockhash === "11111111111111111111111111111111") {
      return jsonError(400, "Invalid blockhash", {
        code: "INVALID_BLOCKHASH",
        userMessage: "This swap expired. Please try again.",
      });
    }

    // User signature must be present
    try {
      assertUserSigned(userSignedTx, userPk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Missing user signature";
      const code = msg.toLowerCase().includes("required signer")
        ? "TX_MISSING_USER_SIGNER"
        : "TX_MISSING_USER_SIGNATURE";

      return jsonError(400, msg, {
        code,
        userMessage:
          "Your wallet isn’t ready to sign yet. Please try again in a moment.",
        tip: "If it keeps happening, refresh the app or log out and back in.",
      });
    }

    // ✅ CRITICAL: prevent users from getting Haven to sign SOL-draining txs
    try {
      validateHavenSpendGuards(userSignedTx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unsafe transaction";
      return jsonError(400, "Unsafe transaction", {
        code: "UNSAFE_TX",
        userMessage:
          "This swap request is invalid. Please refresh and try again.",
        details: msg,
      });
    }

    const conn = getConnection();
    const privy = getPrivyClient();

    // ─────────── Co-sign with Haven Fee Payer ───────────
    let coSignedBytes: Uint8Array;
    try {
      const resp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[JUP/SEND] Privy sign failed:", msg);

      if (msg.toLowerCase().includes("invalid wallet id")) {
        return jsonError(500, "Invalid Haven wallet configuration", {
          code: "INVALID_HAVEN_WALLET_ID",
          userMessage:
            "Service temporarily unavailable. Please try again later.",
        });
      }
      return jsonError(500, "Signing failed", {
        code: "PRIVY_SIGN_FAILED",
        userMessage: "Couldn't finalize this swap right now. Please try again.",
        details: msg,
      });
    }

    // ─────────── Broadcast ───────────
    let signature: string;

    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: SEND_CONFIG.SKIP_PREFLIGHT,
        maxRetries: SEND_CONFIG.MAX_RETRIES,
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
      console.error("[JUP/SEND] Broadcast failed:", msg, logs.slice(0, 5));

      if (isAlreadyProcessedError(msg)) {
        // Most RPCs don't give us the signature here, but returning a retryable error is worse UX.
        // Client should re-fetch status (or user can see history).
        return jsonError(400, "Already processed", {
          code: "ALREADY_PROCESSED",
          userMessage: "This swap was already submitted. Check your activity.",
          logs: logs.slice(0, 10),
          retryable: false,
        });
      }

      if (isBlockhashNotFoundError(msg) || isBlockhashError(msg)) {
        return jsonError(400, "Transaction expired", {
          code: "BLOCKHASH_EXPIRED",
          userMessage: "This swap expired. Please try again.",
          logs: logs.slice(0, 10),
          retryable: true,
        });
      }

      if (isSlippageError(msg)) {
        return jsonError(400, "Slippage exceeded", {
          code: "SLIPPAGE_EXCEEDED",
          userMessage: "Price moved too much. Try again.",
          tip: "If it keeps failing, increase slippage a bit.",
          logs: logs.slice(0, 10),
          retryable: true,
        });
      }

      if (isInsufficientError(msg)) {
        return jsonError(400, "Insufficient balance", {
          code: "INSUFFICIENT_BALANCE",
          userMessage: "You don't have enough balance for this swap.",
          logs: logs.slice(0, 10),
          retryable: false,
        });
      }

      return jsonError(400, "Broadcast failed", {
        code: "BROADCAST_FAILED",
        userMessage: "Couldn't send this swap. Please try again.",
        details: msg,
        logs: logs.slice(0, 10),
        retryable: true,
      });
    }

    // ─────────── Confirm quickly ───────────
    const confirmRes = await confirmFast({
      conn,
      signature,
      blockhash: buildBlockhash ?? blockhash,
      lastValidBlockHeight: buildLastValid,
      timeoutMs: SEND_CONFIG.CONFIRM_TIMEOUT_MS,
    });

    // ─────────── Fee recording (fire-and-forget) ───────────
    if (userIdForFeeEvents) {
      recordSwapFeeFromChainAsync({
        userId: userIdForFeeEvents,
        signature,
        feeMintHint,
      }).catch(() => {});
    } else {
      console.warn("[JUP/SEND] Fee recording skipped: missing user id");
    }

    // ─────────── Success ───────────
    const sendTime = Date.now() - startTime;

    if (
      !confirmRes.ok &&
      confirmRes.timeout &&
      SEND_CONFIG.RETURN_SIG_ON_TIMEOUT
    ) {
      console.log(
        `[JUP/SEND] ${signature.slice(0, 8)}... ${sendTime}ms (confirm timeout)`,
      );
      return NextResponse.json({
        signature,
        sendTimeMs: sendTime,
        confirmed: false,
        confirmTimeout: true,
      });
    }

    if (!confirmRes.ok && !confirmRes.timeout) {
      console.warn(
        "[JUP/SEND] confirm returned err:",
        signature.slice(0, 8),
        confirmRes.err,
      );
      return jsonError(400, "Transaction failed", {
        code: "TX_FAILED",
        userMessage: "This swap failed on-chain. Please try again.",
        signature,
        confirmed: false,
        retryable: true,
      });
    }

    console.log(`[JUP/SEND] ${signature.slice(0, 8)}... ${sendTime}ms`);
    return NextResponse.json({
      signature,
      sendTimeMs: sendTime,
      confirmed: true,
      confirmTimeout: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[JUP/SEND] Unhandled:", msg);
    return jsonError(500, "Internal server error", {
      code: "UNHANDLED",
      userMessage: "Something went wrong. Please try again.",
      details: msg,
    });
  }
}
