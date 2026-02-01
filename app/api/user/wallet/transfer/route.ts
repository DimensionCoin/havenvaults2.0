// app/api/user/wallet/transfer/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendOptions,
  SendTransactionError,
  LAMPORTS_PER_SOL,
  type ParsedTransactionMeta,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import mongoose from "mongoose";

import { connect as connectMongo } from "@/lib/db";
import { recordUserFees, type FeeToken } from "@/lib/fees";
import {
  requireServerUser,
  getUserWalletPubkey,
  assertUserSigned,
} from "@/lib/getServerUser";
import { rateLimitServer } from "@/lib/rateLimitServer";

/* ───────── Next.js route config ───────── */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Env ───────── */

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
const TREASURY_OWNER = new PublicKey(
  required("NEXT_PUBLIC_APP_TREASURY_OWNER"),
);
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT"));

const IS_PROD = process.env.NODE_ENV === "production";

/* ───────── Types ───────── */

type Body = {
  transaction?: string;
  /**
   * ✅ Bind request to the authenticated user (prevents using someone else's signed tx)
   * Client should send their wallet base58 that they believe they're using.
   */
  expectedUserBase58?: string;

  // Optional: allow server confirm optimization if client provides these
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
};

type ErrorPayload = {
  error: string;
  code: string;
  userMessage?: string;
  details?: string;
  logs?: string[];
  traceId?: string;
  signature?: string;
  debug?: Record<string, unknown>;
};

type SerializableTx = { serialize: () => Uint8Array };
type SignedTransactionContainer = {
  signedTransaction: string | Uint8Array | number[] | SerializableTx;
};
type SignResp =
  | string
  | Uint8Array
  | number[]
  | SerializableTx
  | SignedTransactionContainer;

/* ───────── Singletons ───────── */

let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(SOLANA_RPC, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60_000,
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

/* ───────── Response helpers ───────── */

function jsonError(status: number, payload: ErrorPayload): NextResponse {
  if (!IS_PROD && payload.debug) {
    // eslint-disable-next-line no-console
    console.error("[/api/user/wallet/transfer]", status, payload.code, {
      error: payload.error,
      debug: payload.debug,
    });
  }
  const safe = IS_PROD ? { ...payload, debug: undefined } : payload;
  return NextResponse.json(safe, { status });
}

/* ───────── Privy signing normalize (NO any) ───────── */

function isSignedTransactionContainer(
  x: unknown,
): x is SignedTransactionContainer {
  return !!x && typeof x === "object" && "signedTransaction" in x;
}

function isSerializableTx(x: unknown): x is SerializableTx {
  return (
    !!x &&
    typeof x === "object" &&
    "serialize" in x &&
    typeof (x as { serialize?: unknown }).serialize === "function"
  );
}

function toSignedBytes(resp: unknown): Uint8Array {
  const payload: unknown = isSignedTransactionContainer(resp)
    ? resp.signedTransaction
    : resp;

  if (typeof payload === "string") {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  if (payload instanceof Uint8Array) return payload;

  if (Array.isArray(payload) && payload.every((n) => typeof n === "number")) {
    return new Uint8Array(payload);
  }

  if (isSerializableTx(payload)) {
    return new Uint8Array(payload.serialize());
  }

  throw new Error("Unexpected signTransaction return type");
}

/* ───────── Error helpers ───────── */

function summarizeLogs(logs?: string[] | null): string[] {
  if (!logs?.length) return [];
  return logs
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        /error|fail|insufficient|custom program error/i.test(l) ||
        l.startsWith("Program ") ||
        l.startsWith("Instruction "),
    )
    .slice(0, 40);
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

/* ───────── Tx confirmation ───────── */

async function confirmSig(params: {
  conn: Connection;
  signature: string;
  providedBlockhash?: string | null;
  providedLastValidBlockHeight?: number | null;
}) {
  const { conn, signature, providedBlockhash, providedLastValidBlockHeight } =
    params;

  if (providedBlockhash && typeof providedLastValidBlockHeight === "number") {
    const res = await conn.confirmTransaction(
      {
        signature,
        blockhash: providedBlockhash,
        lastValidBlockHeight: providedLastValidBlockHeight,
      },
      "confirmed",
    );
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
    return;
  }

  // Fallback (older confirm API)
  const res2 = await conn.confirmTransaction(signature, "confirmed");
  if (res2.value.err) throw new Error(JSON.stringify(res2.value.err));
}

/* ───────── Fee detection (reliable: uses confirmed meta) ───────── */

type TokenBalanceMetaLike = {
  accountIndex?: number;
  owner?: string;
  mint?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
  amount?: string;
  decimals?: number;
};

type TxMetaLike = Pick<
  ParsedTransactionMeta,
  "preTokenBalances" | "postTokenBalances"
> & {
  preTokenBalances?: TokenBalanceMetaLike[];
  postTokenBalances?: TokenBalanceMetaLike[];
};

type TxWithMetaLike = { meta?: TxMetaLike | null } | null;

function bi0(): bigint {
  return BigInt(0);
}

function bigIntFromString(x: unknown): bigint {
  try {
    if (typeof x === "string" && x.trim()) return BigInt(x.trim());
  } catch {}
  return bi0();
}

function clampDecimals(decimals: number) {
  const d = Number.isFinite(decimals) ? Math.floor(decimals) : 0;
  return Math.max(0, Math.min(18, d));
}

function pow10BigInt(decimals: number): bigint {
  const d = clampDecimals(decimals);
  let out = BigInt(1);
  const ten = BigInt(10);
  for (let i = 0; i < d; i++) out = out * ten;
  return out;
}

async function detectTreasuryFeeTokensFromMeta(params: {
  conn: Connection;
  signature: string;
  treasuryOwner: PublicKey;
}): Promise<FeeToken[]> {
  const { conn, signature, treasuryOwner } = params;

  const tx = (await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  })) as TxWithMetaLike;

  const meta = tx?.meta ?? null;
  if (!meta) return [];

  const ownerStr = treasuryOwner.toBase58();

  const pre: TokenBalanceMetaLike[] = Array.isArray(meta.preTokenBalances)
    ? meta.preTokenBalances
    : [];
  const post: TokenBalanceMetaLike[] = Array.isArray(meta.postTokenBalances)
    ? meta.postTokenBalances
    : [];

  const preByIdx = new Map<number, TokenBalanceMetaLike>();
  for (const b of pre) {
    if (typeof b?.accountIndex === "number") preByIdx.set(b.accountIndex, b);
  }

  const deltas = new Map<
    string,
    { mint: string; decimals: number; baseDelta: bigint; symbol?: string }
  >();

  for (const pb of post) {
    const idx = pb?.accountIndex;
    if (typeof idx !== "number") continue;

    if (pb?.owner !== ownerStr) continue;

    const mint = String(pb?.mint || "").trim();
    if (!mint) continue;

    const decimalsRaw = Number(
      pb?.uiTokenAmount?.decimals ?? pb?.decimals ?? 0,
    );
    const decimals = clampDecimals(decimalsRaw);

    const postBaseStr =
      pb?.uiTokenAmount?.amount ??
      (typeof pb?.amount === "string" ? pb.amount : "0");

    const preBal = preByIdx.get(idx);
    const preBaseStr =
      preBal?.uiTokenAmount?.amount ??
      (typeof preBal?.amount === "string" ? preBal.amount : "0");

    const postBase = bigIntFromString(postBaseStr);
    const preBase = bigIntFromString(preBaseStr);

    const delta = postBase - preBase;
    if (delta <= bi0()) continue;

    const prev = deltas.get(mint);
    if (!prev) {
      deltas.set(mint, {
        mint,
        decimals,
        baseDelta: delta,
        symbol: mint === USDC_MINT.toBase58() ? "USDC" : undefined,
      });
    } else {
      deltas.set(mint, {
        mint,
        decimals: prev.decimals > 0 ? prev.decimals : decimals,
        baseDelta: prev.baseDelta + delta,
        symbol:
          prev.symbol ?? (mint === USDC_MINT.toBase58() ? "USDC" : undefined),
      });
    }
  }

  const out: FeeToken[] = [];
  for (const v of deltas.values()) {
    const denom = pow10BigInt(v.decimals);
    const ui = Number(v.baseDelta) / Number(denom);
    if (Number.isFinite(ui) && ui > 0) {
      out.push({
        mint: v.mint,
        decimals: v.decimals,
        amountUi: ui,
        symbol: v.symbol,
      });
    }
  }

  return out;
}

async function detectTreasuryFeeTokensWithRetry(params: {
  conn: Connection;
  signature: string;
  treasuryOwner: PublicKey;
  attempts?: number;
  delayMs?: number;
}): Promise<FeeToken[]> {
  const { conn, signature, treasuryOwner } = params;
  const attempts = Number.isFinite(params.attempts)
    ? Math.max(1, params.attempts!)
    : 3;
  const delayMs = Number.isFinite(params.delayMs)
    ? Math.max(0, params.delayMs!)
    : 250;

  for (let i = 0; i < attempts; i++) {
    const tokens = await detectTreasuryFeeTokensFromMeta({
      conn,
      signature,
      treasuryOwner,
    });
    if (tokens.length > 0 || i === attempts - 1) return tokens;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return [];
}

/* ───────── Route ───────── */

export async function POST(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();

  // Content-type guard
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return jsonError(415, {
      code: "UNSUPPORTED_MEDIA_TYPE",
      error: "Content-Type must be application/json",
      userMessage: "Invalid request.",
      traceId,
    });
  }

  // ✅ Rate limit at the very top (money-moving route: strict)
  const blocked = await rateLimitServer(req, {
    api: "user:wallet:transfer",
    requireAuth: true,
    allowIpFallback: false,
    failMode: "closed",
    tiers: [
      { limit: 2, windowMs: 10_000, suffix: "burst" }, // double click protection
      { limit: 8, windowMs: 60_000, suffix: "minute" },
      { limit: 60, windowMs: 60 * 60_000, suffix: "hour" },
    ],
    globalTiers: [
      { limit: 25, windowMs: 10_000, suffix: "burst" },
      { limit: 180, windowMs: 60_000, suffix: "minute" },
    ],
  });
  if (blocked) return blocked;

  try {
    // ✅ Hard auth + get authed wallet pubkey
    let authedUserPk: PublicKey;
    let authedUserId: string;
    try {
      const user = await requireServerUser();
      authedUserPk = getUserWalletPubkey(user);
      authedUserId = String((user as { _id?: unknown })._id ?? "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unauthorized";
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: msg,
        userMessage: "Please sign in again.",
        traceId,
      });
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, {
        code: "MISSING_TRANSACTION",
        error: "Missing 'transaction' in body",
        userMessage: "Something went wrong sending your transfer.",
        traceId,
      });
    }

    // ✅ Require expectedUserBase58 and bind to session user (prevents cross-account use)
    const expectedUserBase58 =
      typeof body.expectedUserBase58 === "string"
        ? body.expectedUserBase58.trim()
        : "";

    if (!expectedUserBase58) {
      return jsonError(400, {
        code: "MISSING_EXPECTED_USER",
        error: "Missing expectedUserBase58",
        userMessage: "Please approve the transfer again.",
        traceId,
      });
    }

    let expectedPk: PublicKey;
    try {
      expectedPk = new PublicKey(expectedUserBase58);
    } catch {
      return jsonError(400, {
        code: "BAD_EXPECTED_USER",
        error: "Invalid expectedUserBase58",
        userMessage: "Security check failed. Please try again.",
        traceId,
      });
    }

    if (!expectedPk.equals(authedUserPk)) {
      return jsonError(403, {
        code: "WALLET_MISMATCH",
        error: "expectedUserBase58 does not match authenticated user wallet",
        userMessage: "This request doesn't match your account.",
        traceId,
        debug: IS_PROD
          ? undefined
          : {
              authed: authedUserPk.toBase58(),
              provided: expectedPk.toBase58(),
            },
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

    // Fee payer must be Haven sponsor wallet (index 0)
    const payer = userSignedTx.message.staticAccountKeys[0];
    if (!payer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "INVALID_FEE_PAYER",
        error: "Invalid fee payer (must be Haven sponsor wallet)",
        userMessage: "Security check failed. Please try again.",
        traceId,
      });
    }

    // Reject dummy/empty blockhash
    const recentBlockhash = userSignedTx.message.recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return jsonError(400, {
        code: "INVALID_BLOCKHASH",
        error: "Transaction has invalid or dummy recentBlockhash",
        userMessage: "Transaction expired. Please try again.",
        traceId,
      });
    }

    // ✅ Require that the authenticated user is a required signer AND has signed.
    try {
      assertUserSigned(userSignedTx, authedUserPk);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Missing user signature";
      return jsonError(400, {
        code: "MISSING_USER_SIGNATURE",
        error: m,
        userMessage: "Please approve the transaction in your wallet.",
        traceId,
      });
    }

    // ✅ Haven MUST be signer 0
    const msg = userSignedTx.message;
    const numSigners = msg.header.numRequiredSignatures;
    const signerKeys = msg.staticAccountKeys.slice(0, numSigners);
    if (!signerKeys[0]?.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "MISSING_HAVEN_SIGNER",
        error: "Haven is not a required signer",
        userMessage: "Security check failed. Please try again.",
        traceId,
      });
    }

    const conn = getConnection();

    // Pre-flight: ensure fee payer has SOL to sponsor fees
    try {
      const lamports = await conn.getBalance(HAVEN_PUBKEY, "processed");
      const balanceSol = lamports / LAMPORTS_PER_SOL;
      const MIN_FEE_WALLET_SOL = 0.005;

      if (balanceSol < MIN_FEE_WALLET_SOL) {
        return jsonError(503, {
          code: "FEEPAYER_UNDERFUNDED",
          error: "Haven fee payer underfunded",
          userMessage:
            "Haven fee wallet is temporarily underfunded. Please try again shortly.",
          traceId,
          debug: IS_PROD ? undefined : { balanceSol },
        });
      }
    } catch (err) {
      // don't hard-fail on balance read; continue
      if (!IS_PROD) {
        // eslint-disable-next-line no-console
        console.warn(
          "[/api/user/wallet/transfer] fee payer balance read failed",
          err,
        );
      }
    }

    // Co-sign with Privy (Haven fee payer)
    const privy = getPrivyClient();

    let coSignedBytes: Uint8Array;
    try {
      const resp: SignResp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      const low = m.toLowerCase();

      if (isLikelyBlockhashError(m)) {
        return jsonError(409, {
          code: "BLOCKHASH_EXPIRED",
          error: "Blockhash not found or expired",
          userMessage: "Transaction expired. Please try again.",
          traceId,
        });
      }

      if (low.includes("signature verification failure")) {
        return jsonError(400, {
          code: "SIGNATURE_VERIFICATION_FAILED",
          error: "Signature verification failed",
          userMessage: "Signature verification failed. Please try again.",
          traceId,
          details: IS_PROD ? undefined : m,
        });
      }

      return jsonError(500, {
        code: "PRIVY_SIGN_FAILED",
        error: "Privy signTransaction failed",
        userMessage: "Couldn't sign the transaction. Try again.",
        details: IS_PROD ? undefined : m,
        traceId,
      });
    }

    // Simulate with sigVerify TRUE for safety
    const coSignedTx = VersionedTransaction.deserialize(coSignedBytes);
    let sim;
    try {
      sim = await conn.simulateTransaction(coSignedTx, {
        commitment: "confirmed",
        sigVerify: true,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error("[/api/user/wallet/transfer] Simulation threw", m, {
        traceId,
      });
      return jsonError(400, {
        code: "SIMULATION_FAILED",
        error: "Simulation threw",
        userMessage: "Couldn't simulate this transaction. Please try again.",
        details: IS_PROD ? undefined : m,
        traceId,
      });
    }

    if (sim?.value?.err) {
      const logs = sim.value.logs ?? [];
      const joined = logs.join("\n");
      const errMsg =
        typeof sim.value.err === "string"
          ? sim.value.err
          : JSON.stringify(sim.value.err);

      if (isLikelySlippageError(joined) || isLikelySlippageError(errMsg)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Simulation failed (slippage)",
          userMessage: "Price moved too much. Try again.",
          logs: summarizeLogs(logs),
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
          userMessage: "You don't have enough balance for this transfer.",
          logs: summarizeLogs(logs),
          traceId,
        });
      }

      if (isLikelyBlockhashError(joined) || isLikelyBlockhashError(errMsg)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Simulation failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: summarizeLogs(logs),
          traceId,
        });
      }

      return jsonError(400, {
        code: "SIMULATION_FAILED",
        error: "Simulation failed",
        userMessage: "Transaction failed to simulate. Please try again.",
        details: IS_PROD ? undefined : errMsg,
        logs: summarizeLogs(logs),
        traceId,
      });
    }

    // Broadcast
    const sendOpts: SendOptions = { skipPreflight: false, maxRetries: 3 };

    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, sendOpts);
    } catch (err) {
      const ste = err as SendTransactionError;
      const steWithLogs: { getLogs?: (c: Connection) => Promise<string[]> } =
        ste;

      const logs =
        typeof steWithLogs.getLogs === "function"
          ? await steWithLogs.getLogs(conn).catch(() => [])
          : [];

      const m = err instanceof Error ? err.message : String(err);

      if (isLikelySlippageError(m)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Broadcast failed (slippage)",
          userMessage: "Price moved too much. Try again.",
          logs: summarizeLogs(logs),
          details: IS_PROD ? undefined : m,
          traceId,
        });
      }

      if (m.toLowerCase().includes("insufficient")) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Broadcast failed (insufficient balance)",
          userMessage: "You don't have enough balance for this transfer.",
          logs: summarizeLogs(logs),
          details: IS_PROD ? undefined : m,
          traceId,
        });
      }

      if (isLikelyBlockhashError(m)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Broadcast failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: summarizeLogs(logs),
          details: IS_PROD ? undefined : m,
          traceId,
        });
      }

      return jsonError(400, {
        code: "BROADCAST_FAILED",
        error: "Broadcast failed",
        userMessage: "Couldn't send transaction. Please try again.",
        logs: summarizeLogs(logs),
        details: IS_PROD ? undefined : m,
        traceId,
      });
    }

    // Confirm (use provided bh if present)
    const providedBh =
      typeof body.recentBlockhash === "string" ? body.recentBlockhash : null;
    const providedLvb =
      typeof body.lastValidBlockHeight === "number"
        ? body.lastValidBlockHeight
        : null;

    try {
      await confirmSig({
        conn,
        signature,
        providedBlockhash:
          providedBh && providedBh === recentBlockhash ? providedBh : null,
        providedLastValidBlockHeight:
          providedBh && providedBh === recentBlockhash ? providedLvb : null,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(400, {
        code: "CONFIRM_FAILED",
        error: "Confirm failed",
        userMessage:
          "Transfer submitted but could not be confirmed yet. Please check again.",
        signature,
        traceId,
        details: IS_PROD ? undefined : m,
      });
    }

    // Detect + record fees paid to treasury owner (ALL mints, SPL + Token-2022)
    let feeTokensDetected: FeeToken[] = [];
    try {
      feeTokensDetected = await detectTreasuryFeeTokensWithRetry({
        conn,
        signature,
        treasuryOwner: TREASURY_OWNER,
        attempts: 3,
        delayMs: 250,
      });

      if (feeTokensDetected.length > 0) {
        await connectMongo();

        const userId =
          mongoose.Types.ObjectId.isValid(authedUserId) && authedUserId
            ? new mongoose.Types.ObjectId(authedUserId)
            : null;

        if (userId) {
          await recordUserFees({
            userId,
            signature, // idempotency key
            kind: "wallet_transfer_fee",
            tokens: feeTokensDetected,
          });
        }
      }
    } catch (e) {
      // Never fail the transfer response if analytics write fails
      // eslint-disable-next-line no-console
      console.error("[/api/user/wallet/transfer] Fee tracking failed:", e);
    }

    const sendTimeMs = Date.now() - startTime;

    return NextResponse.json({
      signature,
      feeTokensDetected,
      treasuryOwner: TREASURY_OWNER.toBase58(),
      traceId,
      sendTimeMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error("[/api/user/wallet/transfer] Unhandled error:", msg);
    return jsonError(500, {
      code: "UNHANDLED",
      error: "Internal server error.",
      userMessage: "Something went wrong. Please try again.",
      details: IS_PROD ? undefined : msg,
      traceId,
    });
  }
}
