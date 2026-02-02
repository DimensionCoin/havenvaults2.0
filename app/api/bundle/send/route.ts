// app/api/bundle/send/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendTransactionError,
  ParsedTransactionMeta,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import mongoose from "mongoose";

import { rateLimitServer } from "@/lib/rateLimitServer";
import {
  requireServerUser,
  getUserWalletPubkey,
  assertUserSigned,
} from "@/lib/getServerUser";
import { validateHavenSpendGuards } from "@/lib/havenSpendGuards";
import { recordUserFees, type FeeToken } from "@/lib/fees";
import { validateCsrf } from "@/lib/csrf";
import { WSOL_MINT } from "@/lib/tokenConfig";

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
const TREASURY_OWNER = new PublicKey(
  required("NEXT_PUBLIC_APP_TREASURY_OWNER"),
);
const USDC_MINT_STR =
  process.env.NEXT_PUBLIC_USDC_SWAP_MINT || process.env.NEXT_PUBLIC_USDC_MINT;

const IS_PROD = process.env.NODE_ENV === "production";

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

/* ───────── Helpers ───────── */

type ErrorPayload = {
  error: string;
  code: string;
  userMessage?: string;
  details?: string;
  logs?: string[];
  traceId?: string;
  signature?: string;
  stage?: string;
  debug?: Record<string, unknown>;
};

function jsonError(status: number, payload: ErrorPayload) {
  if (!IS_PROD && payload.debug) {
    console.error("[/api/bundle/send]", status, payload.code, {
      error: payload.error,
      stage: payload.stage,
      debug: payload.debug,
    });
  }
  const safe = IS_PROD ? { ...payload, debug: undefined } : payload;
  return NextResponse.json(safe, { status });
}

/* ───────── Privy signing helpers (NO any) ───────── */

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

function isSignedTransactionContainer(
  x: unknown,
): x is SignedTransactionContainer {
  return !!x && typeof x === "object" && "signedTransaction" in x;
}

function isSerializableTx(x: unknown): x is SerializableTx {
  return !!x && typeof x === "object" && "serialize" in x;
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

/* ───────── Fee detection (confirmed meta) ───────── */

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
  "preTokenBalances" | "postTokenBalances" | "preBalances" | "postBalances"
> & {
  preTokenBalances?: TokenBalanceMetaLike[];
  postTokenBalances?: TokenBalanceMetaLike[];
  preBalances?: Array<number | bigint | string>;
  postBalances?: Array<number | bigint | string>;
};

type TxMessageLike = {
  accountKeys?: unknown[];
  staticAccountKeys?: unknown[];
};

type TxWithMetaLike = {
  meta?: TxMetaLike | null;
  transaction?: { message?: TxMessageLike | null } | null;
} | null;

function bi0(): bigint {
  return BigInt(0);
}

function bigIntFromString(x: unknown): bigint {
  try {
    if (typeof x === "string" && x.trim()) return BigInt(x.trim());
  } catch {}
  return bi0();
}

function bigIntFromLamports(x: unknown): bigint {
  if (typeof x === "bigint") return x >= bi0() ? x : bi0();
  if (typeof x === "number" && Number.isFinite(x)) {
    return BigInt(Math.max(0, Math.floor(x)));
  }
  if (typeof x === "string" && x.trim()) {
    try {
      const v = BigInt(x.trim());
      return v >= bi0() ? v : bi0();
    } catch {}
  }
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

function bigintToUiString(base: bigint, decimals: number): string {
  const d = clampDecimals(decimals);
  if (base <= BigInt(0)) return "0";
  if (d === 0) return base.toString();
  const denom = pow10BigInt(d);
  const whole = base / denom;
  const frac = base % denom;
  const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function normalizeAccountKey(key: unknown): string {
  if (typeof key === "string") return key;
  if (key && typeof key === "object") {
    const maybe = key as { toBase58?: () => string; pubkey?: { toBase58?: () => string } };
    if (typeof maybe.toBase58 === "function") return maybe.toBase58();
    if (maybe.pubkey && typeof maybe.pubkey.toBase58 === "function") {
      return maybe.pubkey.toBase58();
    }
  }
  return "";
}

function getAccountKeysFromTx(tx: TxWithMetaLike): string[] {
  const message = tx?.transaction?.message ?? null;
  const keysRaw = Array.isArray(message?.staticAccountKeys)
    ? message?.staticAccountKeys
    : Array.isArray(message?.accountKeys)
      ? message?.accountKeys
      : [];
  const out: string[] = [];
  for (const k of keysRaw) {
    const keyStr = normalizeAccountKey(k);
    if (keyStr) out.push(keyStr);
  }
  return out;
}

function detectTreasurySolFeeLamports(
  tx: TxWithMetaLike,
  treasuryOwner: PublicKey,
): bigint {
  const meta = tx?.meta ?? null;
  if (!meta) return bi0();

  const pre = Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const post = Array.isArray(meta.postBalances) ? meta.postBalances : [];
  if (!pre.length || !post.length) return bi0();

  const keys = getAccountKeysFromTx(tx);
  if (!keys.length) return bi0();

  const idx = keys.indexOf(treasuryOwner.toBase58());
  if (idx < 0 || idx >= pre.length || idx >= post.length) return bi0();

  const preLamports = bigIntFromLamports(pre[idx]);
  const postLamports = bigIntFromLamports(post[idx]);
  const delta = postLamports - preLamports;
  return delta > bi0() ? delta : bi0();
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
        symbol:
          USDC_MINT_STR && mint === USDC_MINT_STR ? "USDC" : undefined,
      });
    } else {
      deltas.set(mint, {
        mint,
        decimals: prev.decimals > 0 ? prev.decimals : decimals,
        baseDelta: prev.baseDelta + delta,
        symbol:
          prev.symbol ??
          (USDC_MINT_STR && mint === USDC_MINT_STR ? "USDC" : undefined),
      });
    }
  }

  const out: FeeToken[] = [];
  for (const v of deltas.values()) {
    if (v.baseDelta <= bi0()) continue;
    out.push({
      mint: v.mint,
      decimals: v.decimals,
      amountUi: bigintToUiString(v.baseDelta, v.decimals),
      symbol: v.symbol,
    });
  }

  const solLamports = detectTreasurySolFeeLamports(tx, treasuryOwner);
  if (solLamports > bi0()) {
    out.push({
      mint: WSOL_MINT,
      decimals: 9,
      amountUi: bigintToUiString(solLamports, 9),
      symbol: "SOL",
    });
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
  let stage = "init";

  try {
    const csrfError = validateCsrf(req);
    if (csrfError) return csrfError;

    // ─────────── Auth (cookie session -> user -> wallet pubkey) ───────────
    stage = "auth";
    let authedUserPk: PublicKey;
    let userIdForFees: mongoose.Types.ObjectId | null = null;
    try {
      const user = await requireServerUser();
      authedUserPk = getUserWalletPubkey(user);

      const rawId = (user as { _id?: unknown })?._id;
      if (rawId instanceof mongoose.Types.ObjectId) {
        userIdForFees = rawId;
      } else if (typeof rawId === "string" && mongoose.Types.ObjectId.isValid(rawId)) {
        userIdForFees = new mongoose.Types.ObjectId(rawId);
      } else {
        userIdForFees = null;
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "Unauthorized";
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: m,
        userMessage: "Please sign in again.",
        traceId,
        stage,
      });
    }

    // ─────────── Rate limit (send = expensive / money moving) ───────────
    stage = "rateLimit";
    const blocked = await rateLimitServer(req, {
      api: "bundle:send",
      requireAuth: true,
      allowIpFallback: false,
      failMode: "closed",
      tiers: [
        { limit: 2, windowMs: 10_000, suffix: "burst" }, // double-click protection
        { limit: 6, windowMs: 60_000, suffix: "minute" }, // normal use
        { limit: 30, windowMs: 60 * 60_000, suffix: "hour" }, // abuse cap
      ],
      globalTiers: [
        { limit: 25, windowMs: 10_000, suffix: "burst" },
        { limit: 180, windowMs: 60_000, suffix: "minute" },
      ],
    });
    if (blocked) return blocked;

    // ─────────── Parse body ───────────
    stage = "parseBody";
    const body = (await req.json().catch(() => null)) as {
      transaction?: string;
      expectedUserBase58?: string;
      recentBlockhash?: string;
      lastValidBlockHeight?: number;
    } | null;

    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, {
        code: "MISSING_TRANSACTION",
        error: "Missing 'transaction' in body",
        userMessage: "Something went wrong sending your swap.",
        traceId,
        stage,
      });
    }

    // ✅ For send route, require expectedUserBase58 and bind it to session user
    const expectedUserBase58 =
      typeof body.expectedUserBase58 === "string"
        ? body.expectedUserBase58.trim()
        : "";

    if (!expectedUserBase58) {
      return jsonError(400, {
        code: "MISSING_EXPECTED_USER",
        error: "Missing expectedUserBase58",
        userMessage: "Please approve the swap again.",
        traceId,
        stage,
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
        stage,
      });
    }

    if (!expectedPk.equals(authedUserPk)) {
      return jsonError(403, {
        code: "WALLET_MISMATCH",
        error: "expectedUserBase58 does not match authenticated user wallet",
        userMessage: "This request doesn't match your account.",
        traceId,
        stage,
        debug: IS_PROD
          ? undefined
          : {
              authed: authedUserPk.toBase58(),
              provided: expectedPk.toBase58(),
            },
      });
    }

    // ─────────── Deserialize ───────────
    stage = "deserialize";
    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length) {
      return jsonError(400, {
        code: "BAD_ENCODING",
        error: "Invalid transaction encoding",
        userMessage: "Bad transaction data.",
        traceId,
        stage,
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
        stage,
      });
    }

    // ─────────── Validation ───────────
    stage = "validate";
    const msg = userSignedTx.message;

    // Fee payer must be Haven
    const feePayer = msg.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "INVALID_FEE_PAYER",
        error: "Invalid fee payer",
        userMessage: "Security check failed. Please try again.",
        traceId,
        stage,
      });
    }

    // Blockhash sanity
    const blockhash = msg.recentBlockhash;
    if (!blockhash || blockhash === "11111111111111111111111111111111") {
      return jsonError(400, {
        code: "INVALID_BLOCKHASH",
        error: "Invalid blockhash",
        userMessage: "Transaction expired. Please try again.",
        traceId,
        stage,
      });
    }

    // ✅ Require that the authenticated user is a required signer AND has signed
    stage = "userSignature";
    try {
      assertUserSigned(userSignedTx, authedUserPk);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Missing user signature";
      return jsonError(400, {
        code: "MISSING_USER_SIGNATURE",
        error: m,
        userMessage: "Please approve the transaction in your wallet.",
        traceId,
        stage,
      });
    }

    // Haven MUST be required signer 0 (payer)
    stage = "havenSigner";
    const numSigners = msg.header.numRequiredSignatures;
    const signerKeys = msg.staticAccountKeys.slice(0, numSigners);
    if (!signerKeys[0]?.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "MISSING_HAVEN_SIGNER",
        error: "Haven is not a required signer",
        userMessage: "Security check failed. Please try again.",
        traceId,
        stage,
      });
    }

    // ✅ Prevent SOL drain attacks via SystemProgram instructions
    stage = "spendGuards";
    try {
      validateHavenSpendGuards(userSignedTx);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Unsafe transaction";
      return jsonError(400, {
        code: "UNSAFE_TX",
        error: m,
        userMessage: "Security check failed. Please try again.",
        traceId,
        stage,
      });
    }

    const conn = getConnection();
    const privy = getPrivyClient();

    // ─────────── Haven co-sign ───────────
    stage = "privySign";
    let coSignedBytes: Uint8Array;
    try {
      const resp: SignResp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error("[BUNDLE/SEND] Privy sign failed:", m);
      return jsonError(500, {
        code: "PRIVY_SIGN_FAILED",
        error: "Signing failed",
        userMessage: "Couldn't sign the transaction. Try again.",
        details: m,
        traceId,
        stage,
      });
    }

    // ─────────── Simulate (sigVerify TRUE) ───────────
    stage = "simulate";
    const coSignedTx = VersionedTransaction.deserialize(coSignedBytes);

    let sim;
    try {
      sim = await conn.simulateTransaction(coSignedTx, {
        commitment: "confirmed",
        sigVerify: true,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error("[BUNDLE/SEND] Simulation threw", m);
      return jsonError(400, {
        code: "SIMULATION_FAILED",
        error: "Simulation threw",
        userMessage: "Couldn't simulate this transaction. Please try again.",
        details: m,
        traceId,
        stage,
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
          logs: logs.slice(0, 30),
          traceId,
          stage,
        });
      }

      const isInsufficientError =
        /\bcustom program error:\s*0x1(?![0-9a-fA-F])/i.test(joined) ||
        /\binsufficient\b/i.test(joined);
      if (isInsufficientError) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Simulation failed (insufficient balance)",
          userMessage: "Insufficient balance for this swap.",
          logs: logs.slice(0, 30),
          traceId,
          stage,
        });
      }

      if (isLikelyBlockhashError(joined) || isLikelyBlockhashError(errMsg)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Simulation failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: logs.slice(0, 30),
          traceId,
          stage,
        });
      }

      return jsonError(400, {
        code: "SIMULATION_FAILED",
        error: "Simulation failed",
        userMessage: "Transaction failed to simulate. Please try again.",
        details: errMsg,
        logs: logs.slice(0, 40),
        traceId,
        stage,
      });
    }

    // ─────────── Broadcast ───────────
    stage = "broadcast";
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
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
          logs: logs.slice(0, 30),
          details: m,
          traceId,
          stage,
        });
      }

      if (m.toLowerCase().includes("insufficient")) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Broadcast failed (insufficient balance)",
          userMessage: "Insufficient balance for this swap.",
          logs: logs.slice(0, 30),
          details: m,
          traceId,
          stage,
        });
      }

      if (isLikelyBlockhashError(m)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Broadcast failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: logs.slice(0, 30),
          details: m,
          traceId,
          stage,
        });
      }

      return jsonError(400, {
        code: "BROADCAST_FAILED",
        error: "Broadcast failed",
        userMessage: "Transaction failed. Please try again.",
        logs: logs.slice(0, 30),
        details: m,
        traceId,
        stage,
      });
    }

    // ─────────── Confirm on server (best landing rate) ───────────
    stage = "confirm";
    const providedBh =
      typeof body.recentBlockhash === "string" ? body.recentBlockhash : null;
    const providedLvb =
      typeof body.lastValidBlockHeight === "number"
        ? body.lastValidBlockHeight
        : null;

    try {
      if (providedBh && providedLvb && providedBh === blockhash) {
        const conf = await conn.confirmTransaction(
          {
            signature,
            blockhash: providedBh,
            lastValidBlockHeight: providedLvb,
          },
          "confirmed",
        );
        if (conf.value.err) {
          return jsonError(400, {
            code: "CONFIRM_FAILED",
            error: "Confirm failed",
            userMessage:
              "Swap submitted but could not be confirmed. Please check again.",
            traceId,
            signature,
            stage,
          });
        }
      } else {
        const conf = await conn.confirmTransaction(signature, "confirmed");
        if (conf.value.err) {
          return jsonError(400, {
            code: "CONFIRM_FAILED",
            error: "Confirm failed",
            userMessage:
              "Swap submitted but could not be confirmed. Please check again.",
            traceId,
            signature,
            stage,
          });
        }
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn("[BUNDLE/SEND] confirm warning:", m);
      // Broadcast succeeded; return sig for UI polling.
      return NextResponse.json({
        signature,
        traceId,
        sendTimeMs: Date.now() - startTime,
        warning: "CONFIRMATION_TIMEOUT",
      });
    }

    const sendTime = Date.now() - startTime;
    console.log(
      `[BUNDLE/SEND] ${traceId} ${signature.slice(0, 12)}... ${sendTime}ms`,
    );

    // Fee tracking (best-effort, never blocks success)
    if (userIdForFees) {
      try {
        const feeTokensDetected = await detectTreasuryFeeTokensWithRetry({
          conn,
          signature,
          treasuryOwner: TREASURY_OWNER,
          attempts: 3,
          delayMs: 250,
        });

        if (feeTokensDetected.length > 0) {
          await recordUserFees({
            userId: userIdForFees,
            signature,
            kind: "swap",
            tokens: feeTokensDetected,
          });
        }
      } catch (e) {
        console.warn("[BUNDLE/SEND] Fee tracking failed:", e);
      }
    }

    return NextResponse.json({
      signature,
      confirmed: true,
      traceId,
      sendTimeMs: sendTime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[BUNDLE/SEND] ${traceId} Unhandled at ${stage}:`, msg);
    return jsonError(500, {
      code: "UNHANDLED",
      error: "Internal server error",
      userMessage: "Something went wrong. Please try again.",
      details: msg,
      traceId,
      stage,
    });
  }
}
