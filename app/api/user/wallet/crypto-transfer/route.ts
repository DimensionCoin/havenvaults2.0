// app/api/user/wallet/crypto-transfer/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendOptions,
  SendTransactionError,
  LAMPORTS_PER_SOL,
  type Commitment,
  type RpcResponseAndContext,
  type SignatureResult,
  type TransactionResponse,
  type TokenBalance,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { connect as connectMongo } from "@/lib/db";
import { recordUserFees, type FeeToken } from "@/lib/fees";
import mongoose from "mongoose";

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

// USDC mint is blocked for this route (use /transfer instead)
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT"));

const IS_PROD = process.env.NODE_ENV === "production";

/* ───────── Types ───────── */

type Body = {
  transaction?: string;

  /**
   * ✅ Client binds request to the authenticated wallet.
   * Prevents replaying somebody else's signed tx from another session.
   */
  expectedUserBase58?: string;

  // Optional: confirm optimization
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
};

type ErrorLike = { message?: unknown; body?: unknown; bodyAsString?: unknown };

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

type JsonErrorExtra = Record<string, unknown> | undefined;

/** Minimal meta shape we need, typed (avoids `any`). */
type MetaSubset = {
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
};

type TxSubset = TransactionResponse & { meta?: MetaSubset | null };

/* ───────── Response helpers ───────── */

function jsonError(
  status: number,
  message: string,
  extra?: JsonErrorExtra,
): NextResponse {
  const safeExtra = IS_PROD ? undefined : extra;
  return NextResponse.json(
    { error: message, ...(safeExtra || {}) },
    { status },
  );
}

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

/* ───────── Privy signing normalize ───────── */

function toSignedBytes(resp: unknown): Uint8Array {
  const asObj = resp as Record<string, unknown> | null;

  const payload =
    asObj && "signedTransaction" in asObj
      ? (asObj.signedTransaction as unknown)
      : resp;

  if (typeof payload === "string")
    return new Uint8Array(Buffer.from(payload, "base64"));
  if (payload instanceof Uint8Array) return payload;

  if (Array.isArray(payload) && payload.every((n) => typeof n === "number")) {
    return new Uint8Array(payload as number[]);
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

/* ───────── Tx confirmation ───────── */

async function confirmSig(params: {
  conn: Connection;
  signature: string;
  providedBlockhash?: string | null;
  providedLastValidBlockHeight?: number | null;
}) {
  const { conn, signature, providedBlockhash, providedLastValidBlockHeight } =
    params;

  const commitment: Commitment = "confirmed";

  if (providedBlockhash && typeof providedLastValidBlockHeight === "number") {
    const res: RpcResponseAndContext<SignatureResult> =
      await conn.confirmTransaction(
        {
          signature,
          blockhash: providedBlockhash,
          lastValidBlockHeight: providedLastValidBlockHeight,
        },
        commitment,
      );
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
    return;
  }

  try {
    const bh = await conn.getLatestBlockhash(commitment);
    const res: RpcResponseAndContext<SignatureResult> =
      await conn.confirmTransaction({ signature, ...bh }, commitment);
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
  } catch {
    const res2: RpcResponseAndContext<SignatureResult> =
      await conn.confirmTransaction(signature, commitment);
    if (res2.value.err) throw new Error(JSON.stringify(res2.value.err));
  }
}

/* ───────── Error log summarizer ───────── */

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

/* ───────── BigInt helpers (NO BigInt literals) ───────── */

function bi0(): bigint {
  return BigInt("0");
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
  let out = BigInt("1");
  const ten = BigInt("10");
  for (let i = 0; i < d; i++) out = out * ten;
  return out;
}

/* ───────── Fee detection (reliable: uses confirmed meta) ───────── */

async function detectTreasuryFeeTokensFromMeta(params: {
  conn: Connection;
  signature: string;
  treasuryOwner: PublicKey;
}): Promise<FeeToken[]> {
  const { conn, signature, treasuryOwner } = params;

  const tx = (await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  })) as TxSubset | null;

  const meta = tx?.meta ?? null;
  if (!meta) return [];

  const ownerStr = treasuryOwner.toBase58();

  const pre: TokenBalance[] = Array.isArray(meta.preTokenBalances)
    ? meta.preTokenBalances
    : [];
  const post: TokenBalance[] = Array.isArray(meta.postTokenBalances)
    ? meta.postTokenBalances
    : [];

  const preByIdx = new Map<number, TokenBalance>();
  for (const b of pre) {
    if (typeof b.accountIndex === "number") preByIdx.set(b.accountIndex, b);
  }

  const deltas = new Map<
    string,
    { mint: string; decimals: number; baseDelta: bigint; symbol?: string }
  >();

  for (const pb of post) {
    const idx = pb.accountIndex;
    if (typeof idx !== "number") continue;

    const owner = typeof pb.owner === "string" ? pb.owner : "";
    if (owner !== ownerStr) continue;

    const mint = String(pb.mint || "").trim();
    if (!mint) continue;

    const decimalsRaw = Number(pb.uiTokenAmount?.decimals ?? 0);
    const decimals = clampDecimals(decimalsRaw);

    const postBaseStr = pb.uiTokenAmount?.amount ?? "0";
    const preBal = preByIdx.get(idx);
    const preBaseStr = preBal?.uiTokenAmount?.amount ?? "0";

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
  const attempts = Number.isFinite(params.attempts)
    ? Math.max(1, params.attempts!)
    : 3;
  const delayMs = Number.isFinite(params.delayMs)
    ? Math.max(0, params.delayMs!)
    : 250;

  for (let i = 0; i < attempts; i++) {
    const tokens = await detectTreasuryFeeTokensFromMeta({
      conn: params.conn,
      signature: params.signature,
      treasuryOwner: params.treasuryOwner,
    });

    if (tokens.length > 0 || i === attempts - 1) return tokens;
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return [];
}

/* ───────── Route ───────── */

export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return jsonError(415, "Content-Type must be application/json");
  }

  // ✅ Rate limit FIRST (money-moving route)
  const blocked = await rateLimitServer(req, {
    api: "user:wallet:crypto-transfer",
    requireAuth: true,
    allowIpFallback: false,
    failMode: "closed",
    tiers: [
      { limit: 2, windowMs: 10_000, suffix: "burst" },
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
    // ✅ Strong auth (DB-backed) + wallet pubkey
    const user = await requireServerUser();
    const authedUserPk = getUserWalletPubkey(user);
    const userIdStr = String((user as { _id?: unknown })._id ?? "");

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, "Missing 'transaction' in body", {
        code: "MISSING_TRANSACTION",
      });
    }

    // ✅ Bind the request to the authed wallet (client must send it)
    const expectedUserBase58 =
      typeof body.expectedUserBase58 === "string"
        ? body.expectedUserBase58.trim()
        : "";
    if (!expectedUserBase58) {
      return jsonError(400, "Missing expectedUserBase58", {
        code: "MISSING_EXPECTED_USER",
      });
    }

    let expectedPk: PublicKey;
    try {
      expectedPk = new PublicKey(expectedUserBase58);
    } catch {
      return jsonError(400, "Invalid expectedUserBase58", {
        code: "BAD_EXPECTED_USER",
      });
    }

    if (!expectedPk.equals(authedUserPk)) {
      return jsonError(403, "Wallet mismatch", {
        code: "WALLET_MISMATCH",
        ...(IS_PROD
          ? {}
          : {
              debug: {
                authed: authedUserPk.toBase58(),
                provided: expectedPk.toBase58(),
              },
            }),
      });
    }

    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length)
      return jsonError(400, "Invalid transaction encoding", {
        code: "BAD_ENCODING",
      });

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, "Invalid VersionedTransaction", { code: "BAD_TX" });
    }

    // ✅ Fee payer must be Haven sponsor wallet
    const payer = userSignedTx.message.staticAccountKeys[0];
    if (!payer.equals(HAVEN_PUBKEY)) {
      return jsonError(
        400,
        "Invalid fee payer (must be Haven sponsor wallet)",
        {
          code: "INVALID_FEE_PAYER",
        },
      );
    }

    // ✅ Reject dummy/empty blockhash
    const recentBlockhash = userSignedTx.message.recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return jsonError(
        400,
        "Transaction has invalid or dummy recentBlockhash",
        {
          code: "INVALID_BLOCKHASH",
        },
      );
    }

    // ✅ Ensure authed user is a required signer AND they actually signed
    try {
      assertUserSigned(userSignedTx, authedUserPk);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Missing user signature";
      return jsonError(400, m, { code: "MISSING_USER_SIGNATURE" });
    }

    // ✅ Ensure Haven is signer 0
    const numSigners = userSignedTx.message.header.numRequiredSignatures;
    const signerKeys = userSignedTx.message.staticAccountKeys.slice(
      0,
      numSigners,
    );
    if (!signerKeys[0]?.equals(HAVEN_PUBKEY)) {
      return jsonError(400, "Haven is not a required signer", {
        code: "MISSING_HAVEN_SIGNER",
      });
    }

    // ✅ Optional: USDC is blocked here (must use /transfer)
    // Quick, safe check: if ANY static account key equals USDC mint, reject.
    // (Not perfect, but catches accidental misuse.)
    if (
      userSignedTx.message.staticAccountKeys.some((k) => k.equals(USDC_MINT))
    ) {
      return jsonError(400, "USDC transfers are not allowed on this route", {
        code: "USDC_BLOCKED",
      });
    }

    const conn = getConnection();

    // Pre-flight: ensure fee payer has SOL to sponsor fees
    try {
      const lamports = await conn.getBalance(HAVEN_PUBKEY, "processed");
      const balanceSol = lamports / LAMPORTS_PER_SOL;
      const MIN_FEE_WALLET_SOL = 0.005;

      if (balanceSol < MIN_FEE_WALLET_SOL) {
        return jsonError(
          503,
          "Haven fee wallet is temporarily underfunded. Please try again shortly.",
          { code: "FEEPAYER_UNDERFUNDED", ...(IS_PROD ? {} : { balanceSol }) },
        );
      }
    } catch {
      // don't hard fail on read errors
    }

    // Co-sign with Privy (Haven fee payer)
    const privy = getPrivyClient();

    let coSignedBytes: Uint8Array;
    try {
      const resp: unknown = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp as SignResp);
    } catch (err: unknown) {
      const e = err as ErrorLike;
      const bodyStr =
        typeof e.bodyAsString === "function"
          ? String(e.bodyAsString())
          : typeof e.body === "string"
            ? e.body
            : undefined;

      const msgStr =
        typeof e.message === "string" ? e.message : bodyStr || String(err);
      const low = msgStr.toLowerCase();

      if (low.includes("blockhash not found") || low.includes("expired")) {
        return jsonError(409, "Blockhash not found or expired", {
          code: "BLOCKHASH_EXPIRED",
        });
      }
      if (low.includes("signature verification failure")) {
        return jsonError(400, "Signature verification failed.", {
          code: "SIGNATURE_VERIFICATION_FAILED",
          ...(IS_PROD ? {} : { details: msgStr }),
        });
      }

      return jsonError(500, "Privy signTransaction failed.", {
        code: "PRIVY_SIGN_FAILED",
        ...(IS_PROD ? {} : { details: msgStr }),
      });
    }

    // Send
    const sendOpts: SendOptions = { skipPreflight: false, maxRetries: 3 };

    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, sendOpts);
    } catch (err: unknown) {
      const msg = String(
        (err as { message?: unknown })?.message ?? err,
      ).toLowerCase();

      if (msg.includes("blockhash not found") || msg.includes("expired")) {
        return jsonError(409, "Blockhash not found or expired", {
          code: "BLOCKHASH_EXPIRED",
        });
      }

      if (
        msg.includes("insufficient funds") ||
        msg.includes("insufficient lamports")
      ) {
        return jsonError(
          400,
          "Not enough SOL to pay network fees. Check the fee wallet and sender balance.",
          { code: "INSUFFICIENT_FUNDS" },
        );
      }

      if (typeof (err as SendTransactionError)?.getLogs === "function") {
        const logs = await (err as SendTransactionError)
          .getLogs(conn)
          .catch(() => []);
        return jsonError(400, "Simulation failed.", {
          code: "SIMULATION_FAILED",
          logs: summarizeLogs(logs),
          ...(IS_PROD
            ? {}
            : {
                details: String((err as { message?: unknown })?.message ?? err),
              }),
        });
      }

      return jsonError(500, "Broadcast failed.", {
        code: "BROADCAST_FAILED",
        ...(IS_PROD
          ? {}
          : {
              details: String((err as { message?: unknown })?.message ?? err),
            }),
      });
    }

    // Confirm (prefer provided bh if client provided)
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
      const details = err instanceof Error ? err.message : String(err);
      return jsonError(400, "Confirm failed.", {
        code: "CONFIRM_FAILED",
        signature,
        ...(IS_PROD ? {} : { details }),
      });
    }

    // Detect + record fees paid to treasury owner (ALL mints)
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
          mongoose.Types.ObjectId.isValid(userIdStr) && userIdStr
            ? new mongoose.Types.ObjectId(userIdStr)
            : null;

        if (userId) {
          await recordUserFees({
            userId,
            signature,
            kind: "crypto_transfer_fee",
            tokens: feeTokensDetected,
          });
        }
      }
    } catch {
      // analytics failures should not fail transfer
    }

    return NextResponse.json({
      signature,
      feeTokensDetected,
      treasuryOwner: TREASURY_OWNER.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, "Internal server error.", {
      code: "UNHANDLED",
      ...(IS_PROD ? {} : { details: msg }),
    });
  }
}
