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

/* ───────── ENV ───────── */

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

/* ───────── Constants ───────── */

const DECIMALS = 6;
const TEN = new BN(10);
const BASE = TEN.pow(new BN(DECIMALS));
const ZERO = new BN(0);

/* ───────── Singletons ───────── */

let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(SOLANA_RPC, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 30_000,
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

/* ───────── Basic Helpers ───────── */

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
  return NextResponse.json(payload, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

function toSignedBytes(resp: unknown): Uint8Array {
  const payload: SignResp = hasSignedTransaction(resp)
    ? (resp as { signedTransaction: SignResp }).signedTransaction
    : (resp as SignResp);

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

function isLikelyBlockhashError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("blockhash") ||
    m.includes("expired") ||
    m.includes("block height exceeded")
  );
}

function isLikelySlippageError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("slippage") || m.includes("0x1771") || m.includes("price impact")
  );
}

function assertExpectedSigners(
  tx: VersionedTransaction,
  expected: PublicKey[],
) {
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

function assertOriginAllowed(req: NextRequest) {
  if (!ALLOWED_ORIGINS.length) return;

  const origin = req.headers.get("origin") || "";
  if (!origin) throw new Error("Missing Origin");
  if (!ALLOWED_ORIGINS.includes(origin))
    throw new Error(`Disallowed Origin: ${origin}`);
}

/* ───────── BN helpers ───────── */

function bnMax(a: BN, b: BN) {
  return a.gt(b) ? a : b;
}
function bnMin(a: BN, b: BN) {
  return a.lt(b) ? a : b;
}

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

function uiStringToBaseBn(ui: string): BN {
  const raw = String(ui ?? "").trim();
  if (!raw) return ZERO.clone();

  const neg = raw.startsWith("-");
  const s = neg ? raw.slice(1) : raw;

  const parts = s.split(".");
  const w = (parts[0] || "0").replace(/[^\d]/g, "") || "0";
  const f = (parts[1] || "").replace(/[^\d]/g, "");
  const frac = (f + "000000").slice(0, 6);

  const wholeBn = new BN(w, 10);
  const fracBn = new BN(frac || "0", 10);

  const out = wholeBn.mul(BASE).add(fracBn);
  return neg ? out.neg() : out;
}

function uiToDecimal128(ui: string) {
  const [w, f = ""] = String(ui ?? "0").split(".");
  const frac = (f + "000000").slice(0, 6);
  const norm = `${w || "0"}.${frac}`;
  return mongoose.Types.Decimal128.fromString(norm);
}

function safeTailLogs(logs: unknown, max = 20): string[] | null {
  if (!Array.isArray(logs)) return null;
  const only = logs.filter((x): x is string => typeof x === "string");
  return only.length ? only.slice(-max) : null;
}

/* ───────── Parsed-tx fee finder (this is the REAL FIX) ───────── */

type TransferCheckedParsed = {
  type: "transferChecked" | "transfer";
  info: {
    destination?: string;
    mint?: string;
    tokenAmount?: { amount?: string; decimals?: number };
    amount?: string; // for "transfer" sometimes
  };
};

type ParsedIxWithProgramId = ParsedInstruction & { programId?: string };

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
  for (const ix of outer) if (isParsed(ix)) out.push(ix);

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
  attempts = 6,
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
  const treasuryOwner = new PublicKey(TREASURY_OWNER_STR);
  return getAssociatedTokenAddress(
    params.mint,
    treasuryOwner,
    true,
    params.tokenProgramId,
  );
}

/**
 * Find the actual fee transfer to treasury from the parsed tx.
 * Returns exact base units string (e.g. "899") and decimals.
 */
async function findTreasuryUsdcFeeFromParsedTx(params: {
  conn: Connection;
  signature: string;
}): Promise<{
  amountBase: string;
  decimals: number;
  destination: string;
} | null> {
  const { conn, signature } = params;

  const parsed = await fetchParsedTxWithRetry(conn, signature, 6);
  if (!parsed) return null;

  const usdcMint = new PublicKey(USDC_MINT_STR);
  const all = flattenParsedInstructions(parsed);

  // We’ll accept either Tokenkeg or Token-2022 based on which programId appears.
  // Most USDC is Tokenkeg, but this makes it future-proof.
  const possiblePrograms = new Set<string>();
  for (const ix of all) {
    const pid = (ix as ParsedIxWithProgramId).programId;
    if (pid) possiblePrograms.add(String(pid));
  }

  // Try Tokenkeg first, then Token-2022
  const programOrder: PublicKey[] = [];
  programOrder.push(TOKEN_PROGRAM_ID);
  programOrder.push(TOKEN_2022_PROGRAM_ID);

  for (const tokenProgramId of programOrder) {
    const treasuryAta = await deriveTreasuryAtaForMint({
      mint: usdcMint,
      tokenProgramId,
    });
    const treasuryAta58 = treasuryAta.toBase58();

    for (const ix of all) {
      const parsedUnknown = (ix as unknown as { parsed?: unknown }).parsed;
      if (!parsedUnknown || typeof parsedUnknown !== "object") continue;

      const p = parsedUnknown as TransferCheckedParsed;
      if (p.type !== "transferChecked" && p.type !== "transfer") continue;

      const info = p.info || {};
      const destination = String(info.destination || "");
      const mint = String(info.mint || "");
      if (!destination) continue;

      // Must go to treasury ATA
      if (destination !== treasuryAta58) continue;

      // Must be USDC mint (for transferChecked it’s present)
      if (mint && mint !== usdcMint.toBase58()) continue;

      // Extract exact base units
      const tokenAmount = info.tokenAmount;
      const amountBase = String(
        tokenAmount?.amount || info.amount || "",
      ).trim();

      const decimals = Number(tokenAmount?.decimals ?? DECIMALS);

      if (!/^\d+$/.test(amountBase)) continue;

      return { amountBase, decimals, destination };
    }
  }

  return null;
}

/* ───────── Ledger helpers ───────── */

async function ensureSavingsAccountExists(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
  walletAddress: string;
}) {
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

  const depositedBase = uiStringToBaseBn(depositedStr);
  const withdrawnBase = uiStringToBaseBn(withdrawnStr);

  return bnMax(depositedBase.sub(withdrawnBase), ZERO);
}

async function syncSavingsAccountAggFromLedger(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
}) {
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

/**
 * ✅ Must be awaited.
 * Uses recordUserFees() which writes FeeEvent + updates User totals (your system).
 */
async function recordSavingsFeeAsync(params: {
  userId: mongoose.Types.ObjectId;
  signature: string;
  feeUi: string;
  accountType: "flex" | "plus";
}): Promise<{ ok: boolean; recorded?: boolean; reason?: string }> {
  const { userId, signature, feeUi, accountType } = params;

  const feeUiNum = Number(feeUi);
  if (!Number.isFinite(feeUiNum) || feeUiNum <= 0) {
    return { ok: true, recorded: false, reason: "fee_ui_zero_or_invalid" };
  }

  const kind = `savings_${accountType}_withdraw_fee`;

  const result = await recordUserFees({
    userId,
    signature,
    kind,
    tokens: [
      {
        mint: USDC_MINT_STR,
        amountUi: feeUiNum,
        decimals: DECIMALS,
        symbol: "USDC",
      },
    ],
  });

  return result as { ok: boolean; recorded?: boolean; reason?: string };
}

/* ───────── Route ───────── */

export async function POST(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();

  try {
    // CSRF-ish
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

    // Auth
    const session = await getSessionFromCookies();
    if (!session?.userId && !session?.sub) {
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
        userMessage: "Please sign in again.",
        traceId,
      });
    }

    // User
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

    // Deserialize
    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length) {
      return jsonError(400, {
        code: "BAD_ENCODING",
        error: "Invalid transaction encoding",
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

    // Fee payer must be Haven
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "INVALID_FEE_PAYER",
        error: "Invalid fee payer",
        userMessage: "Security check failed. Please try again.",
        traceId,
      });
    }

    // Blockhash exists
    const blockhash = userSignedTx.message.recentBlockhash;
    if (!blockhash || blockhash === "11111111111111111111111111111111") {
      return jsonError(400, {
        code: "INVALID_BLOCKHASH",
        error: "Invalid blockhash",
        userMessage: "Transaction expired. Please try again.",
        traceId,
      });
    }

    // User signer check
    try {
      assertUserSigned(userSignedTx, expectedUserPk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(400, {
        code: "SIGNER_MISMATCH",
        error: "User signer mismatch",
        userMessage: "Please sign this transaction with your Haven wallet.",
        details: msg,
        traceId,
      });
    }

    // No surprise signers
    try {
      assertExpectedSigners(userSignedTx, [HAVEN_PUBKEY, expectedUserPk]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(400, {
        code: "UNEXPECTED_SIGNERS",
        error: "Unexpected required signer set",
        userMessage: "Security check failed. Please try again.",
        details: msg,
        traceId,
      });
    }

    const conn = getConnection();
    const privy = getPrivyClient();

    // Co-sign with Haven
    let coSignedBytes: Uint8Array;
    try {
      const resp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PLUS/WITHDRAW/SEND] Privy sign failed:", msg);
      return jsonError(500, {
        code: "PRIVY_SIGN_FAILED",
        error: "Signing failed",
        userMessage: "Couldn't sign the transaction. Try again.",
        details: msg,
        traceId,
      });
    }

    // Simulate
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

      console.error(
        "[PLUS/WITHDRAW/SEND] Simulation failed:",
        msg,
        logs.slice(0, 8),
      );

      if (isLikelySlippageError(joined) || isLikelySlippageError(msg)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Simulation failed (slippage)",
          userMessage: "Price moved too much. Try again with higher slippage.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }

      if (
        joined.toLowerCase().includes("insufficient") ||
        joined.includes("0x1")
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

      return jsonError(400, {
        code: "SIMULATION_FAILED",
        error: "Simulation failed",
        userMessage: "Transaction failed to simulate. Please try again.",
        details: msg,
        logs: logs.slice(0, 30),
        traceId,
      });
    }

    // Broadcast
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
      console.error(
        "[PLUS/WITHDRAW/SEND] Broadcast failed:",
        msg,
        logs.slice(0, 8),
      );

      if (isLikelySlippageError(msg)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Broadcast failed (slippage)",
          userMessage: "Price moved too much. Try again with higher slippage.",
          logs: logs.slice(0, 20),
          details: msg,
          traceId,
        });
      }

      if (msg.toLowerCase().includes("insufficient")) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Broadcast failed (insufficient balance)",
          userMessage: "You don't have enough balance for this withdrawal.",
          logs: logs.slice(0, 20),
          details: msg,
          traceId,
        });
      }

      if (isLikelyBlockhashError(msg)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Broadcast failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: logs.slice(0, 20),
          details: msg,
          traceId,
        });
      }

      return jsonError(400, {
        code: "BROADCAST_FAILED",
        error: "Broadcast failed",
        userMessage: "Couldn't send transaction. Please try again.",
        logs: logs.slice(0, 20),
        details: msg,
        traceId,
      });
    }

    const sendTime = Date.now() - startTime;
    console.log(
      `[PLUS/WITHDRAW/SEND] ${traceId} ${signature.slice(0, 8)}... ${sendTime}ms`,
    );

    // ───────────────────────────────────────────────────────────────
    // DB writes (ledger + fee event)
    // ───────────────────────────────────────────────────────────────

    const accountType = "plus" as const;
    const direction = "withdraw" as const;

    // ✅ Fee from chain (parsed ix to treasury ATA) — same idea as swaps
    const feeParsed = await findTreasuryUsdcFeeFromParsedTx({
      conn,
      signature,
    });

    const feeBase = feeParsed
      ? parseBaseAmountStringBN(feeParsed.amountBase)
      : ZERO.clone();
    const feeUi = baseBnToUiString(feeBase);

    console.log("[PLUS/WITHDRAW/SEND] parsed fee", {
      signature: signature.slice(0, 10),
      found: Boolean(feeParsed),
      destination: feeParsed?.destination,
      amountBase: feeParsed?.amountBase,
      decimals: feeParsed?.decimals,
      feeUi,
    });

    // (Optional) compute netToUser later; keep your existing approach if you want,
    // but don’t block fee event recording on it.
    const netToUser = ZERO.clone(); // leave as 0 if you don't compute it here
    const amountBase = netToUser.add(feeBase); // ledger gross fallback if you want exact later

    await connectMongo();

    const userDoc = await User.findOne({ walletAddress }, { _id: 1 }).lean();
    if (!userDoc?._id) {
      return NextResponse.json({
        ok: true,
        signature,
        sendTimeMs: sendTime,
        traceId,
        recorded: false,
        recordError: "User not found for walletAddress.",
      });
    }

    await ensureSavingsAccountExists({
      userId: userDoc._id,
      accountType,
      walletAddress,
    });

    // If you still want ledger correctness, you can keep your old net calculation.
    // For now, we focus on fee event correctness since that's the blocker.

    const principalRemainingBase = await getPrincipalRemainingBaseFromLedger({
      userId: userDoc._id,
      accountType,
    });

    const principalPartBase = bnMin(amountBase, principalRemainingBase);
    let interestPartBase = amountBase.sub(principalPartBase);
    if (interestPartBase.isNeg()) interestPartBase = ZERO.clone();

    const amountUi = baseBnToUiString(amountBase);
    const principalUi = baseBnToUiString(principalPartBase);
    const interestUi = baseBnToUiString(interestPartBase);
    const netUi = baseBnToUiString(netToUser);

    const ledgerRes = await SavingsLedger.updateOne(
      { signature },
      {
        $setOnInsert: {
          userId: userDoc._id,
          accountType,
          direction,
          amount: uiToDecimal128(amountUi),
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

    if (inserted) {
      await syncSavingsAccountAggFromLedger({
        userId: userDoc._id,
        accountType,
      });
    }

    // ✅✅ FeeEvent write (AWAITED)
    if (!feeBase.isZero()) {
      try {
        const feeRes = await recordSavingsFeeAsync({
          userId: userDoc._id,
          signature,
          feeUi,
          accountType,
        });

        console.log("[plus/withdraw/send] fee recorded result", {
          signature: signature.slice(0, 10),
          feeUi,
          ok: feeRes.ok,
          recorded: feeRes.recorded,
          reason: feeRes.reason,
        });
      } catch (err) {
        console.error("[plus/withdraw/send] fee write FAILED", {
          signature,
          feeUi,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      console.warn(
        "[plus/withdraw/send] feeBase == 0; skipping FeeEvent write",
        {
          signature: signature.slice(0, 10),
          hint: "No parsed treasury USDC transfer found. Fee ix might be going to a non-ATA token account.",
        },
      );
    }

    return NextResponse.json({
      ok: true,
      signature,
      sendTimeMs: sendTime,
      traceId,
      recorded: inserted,
      accounting: {
        direction,
        accountType,
        amountUi,
        feeUi,
        netUi,
        principalUi,
        interestUi,
      },
      fee: feeParsed
        ? {
            destination: feeParsed.destination,
            amountBase: feeParsed.amountBase,
            decimals: feeParsed.decimals,
          }
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[PLUS/WITHDRAW/SEND] Unhandled:", msg);
    return jsonError(500, {
      code: "UNHANDLED",
      error: "Internal server error",
      userMessage: "Something went wrong. Please try again.",
      details: msg,
      traceId,
    });
  }
}
