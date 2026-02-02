// app/api/booster/send/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  ParsedTransactionMeta,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getSessionFromCookies } from "@/lib/auth";
import { requireServerUser, getUserWalletPubkey } from "@/lib/getServerUser";
import { rateLimitServer } from "@/lib/rateLimitServer";
import { recordUserFees, type FeeToken } from "@/lib/fees";
import User from "@/models/User";
import { connect } from "@/lib/db";
import { TOKENS, getCluster, getMintFor } from "@/lib/tokenConfig";
import { validateHavenSpendGuards } from "@/lib/havenSpendGuards";

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
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);
const TREASURY_OWNER = new PublicKey(
  required("NEXT_PUBLIC_APP_TREASURY_OWNER")
);
const USDC_MINT_STR =
  process.env.NEXT_PUBLIC_USDC_SWAP_MINT || process.env.NEXT_PUBLIC_USDC_MINT;

/* ───────── Singletons ───────── */
let _privy: PrivyClient | null = null;
function getPrivyClient(): PrivyClient {
  if (!_privy) {
    _privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });
  }
  return _privy;
}

/* ───────── CONSTANTS ───────── */
const KEEP_DUST_LAMPORTS = 900_000; // 0.0009 SOL
const DUST_TOLERANCE_LAMPORTS = 100_000;
const DUST_MAX_LAMPORTS = KEEP_DUST_LAMPORTS + DUST_TOLERANCE_LAMPORTS;
const BOOSTER_MAX_TOPUP_LAMPORTS = Number(
  process.env.BOOSTER_MAX_TOPUP_LAMPORTS ?? "50000000", // 0.05 SOL
);

/* ───────── Token Lookup ───────── */

const CLUSTER = getCluster();

/**
 * Look up token symbol from token config by mint address
 */
function getSymbolForMint(mint: string): string | undefined {
  if (!mint) return undefined;

  for (const token of TOKENS) {
    const tokenMint = getMintFor(token, CLUSTER);
    if (tokenMint === mint) {
      return token.symbol;
    }
  }

  return undefined;
}

/* ───────── TYPES ───────── */
type ErrorLike = {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  body?: unknown;
  bodyAsString?: (() => unknown) | unknown;
};

type MessageV0Subset = {
  staticAccountKeys?: (PublicKey | string)[];
  recentBlockhash?: string;
  header?: { numRequiredSignatures?: number };
};

type HasSignatures = { signatures?: Uint8Array[] };

interface SendRequestBody {
  transaction?: string;
  // Fee tracking info (optional)
  feeUnits?: number;
  feeMint?: string;
  feeDecimals?: number;
  feeKind?: string; // e.g. "perp_open", "perp_close", "perp_increase"
}

/* ───────── HELPERS ───────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === "number");
}

function shapeErr(e: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  const r = (e ?? {}) as ErrorLike;
  let message = "";
  try {
    const bas = r.bodyAsString;
    if (typeof bas === "function") message = String(bas());
    else if (typeof r.body === "string") message = r.body;
    else if (typeof r.message === "string") message = r.message;
    else message = String(e);
  } catch {
    message = String(e);
  }
  return {
    name: typeof r.name === "string" ? r.name : "Error",
    message,
    stack: typeof r.stack === "string" ? r.stack : undefined,
  };
}

function jsonError(
  status: number,
  body: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    traceId?: string;
    stage?: string;
    logs?: unknown;
    details?: unknown;
  }
) {
  console.error(`[booster/send] ERROR ${status}:`, body);
  return NextResponse.json(body, { status });
}

function anyZero(sig: Uint8Array | number[]): boolean {
  for (let i = 0; i < sig.length; i++) if (sig[i] !== 0) return false;
  return true;
}

function toSignedBytes(resp: unknown): Uint8Array {
  // Direct Uint8Array
  if (resp instanceof Uint8Array) {
    return resp;
  }

  // Base64 string
  if (typeof resp === "string") {
    return new Uint8Array(Buffer.from(resp, "base64"));
  }

  // Number array
  if (isNumberArray(resp)) {
    return new Uint8Array(resp);
  }

  // Object responses
  if (isRecord(resp)) {
    // Check for signedTransaction field
    if ("signedTransaction" in resp) {
      const st = resp.signedTransaction;

      // Base64 string
      if (typeof st === "string") {
        return new Uint8Array(Buffer.from(st, "base64"));
      }

      // Uint8Array
      if (st instanceof Uint8Array) {
        return st;
      }

      // Number array
      if (isNumberArray(st)) {
        return new Uint8Array(st);
      }

      // Has serialize method
      if (isRecord(st) && typeof st.serialize === "function") {
        const out = st.serialize();
        if (out instanceof Uint8Array) return new Uint8Array(out);
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(out))
          return new Uint8Array(out);
        if (isNumberArray(out)) return new Uint8Array(out);
      }
    }

    // Has serialize method directly
    if (typeof resp.serialize === "function") {
      const out = resp.serialize();
      if (out instanceof Uint8Array) return new Uint8Array(out);
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(out))
        return new Uint8Array(out);
      if (isNumberArray(out)) return new Uint8Array(out);
    }

    // Check for data field
    if ("data" in resp) {
      const data = resp.data;

      if (typeof data === "string") {
        return new Uint8Array(Buffer.from(data, "base64"));
      }
      if (data instanceof Uint8Array) {
        return data;
      }
      if (isNumberArray(data)) {
        return new Uint8Array(data);
      }
    }
  }

  // Debug log
  console.error("[toSignedBytes] Unexpected format:", {
    type: typeof resp,
    isArray: Array.isArray(resp),
    keys: isRecord(resp) ? Object.keys(resp) : null,
  });

  throw new Error("Unexpected signTransaction return type");
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

async function detectTreasuryFeeTokensFromMeta(params: {
  conn: Connection;
  signature: string;
  treasuryOwner: PublicKey;
  mintHint?: string;
}): Promise<FeeToken[]> {
  const { conn, signature, treasuryOwner, mintHint } = params;

  const tx = (await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  })) as TxWithMetaLike;

  const meta = tx?.meta ?? null;
  if (!meta) return [];

  const ownerStr = treasuryOwner.toBase58();
  const hint = mintHint ? mintHint.trim() : "";

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
    if (hint && mint !== hint) continue;

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
      symbol: v.symbol ?? getSymbolForMint(v.mint),
    });
  }

  return out;
}

async function detectTreasuryFeeTokensWithRetry(params: {
  conn: Connection;
  signature: string;
  treasuryOwner: PublicKey;
  mintHint?: string;
  attempts?: number;
  delayMs?: number;
}): Promise<FeeToken[]> {
  const { conn, signature, treasuryOwner, mintHint } = params;
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
      mintHint,
    });
    if (tokens.length > 0 || i === attempts - 1) return tokens;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return [];
}

/**
 * Record fee to database (fire-and-forget, non-blocking)
 */
async function recordFeeFromChainAsync(params: {
  conn: Connection;
  privyId: string;
  signature: string;
  feeMintHint?: string;
  feeKind: string;
}): Promise<void> {
  const { conn, privyId, signature, feeMintHint, feeKind } = params;

  try {
    await connect();

    const user = await User.findOne({ privyId }).select({ _id: 1 }).lean();

    if (!user?._id) {
      console.warn(
        "[booster/send] Fee recording skipped: user not found",
        privyId
      );
      return;
    }

    const feeTokens = await detectTreasuryFeeTokensWithRetry({
      conn,
      signature,
      treasuryOwner: TREASURY_OWNER,
      mintHint: feeMintHint,
      attempts: 4,
      delayMs: 300,
    });

    if (!feeTokens.length) {
      console.warn(
        "[booster/send] Fee tracking skipped: no treasury inflow found",
        signature.slice(0, 8),
      );
      return;
    }

    const result = await recordUserFees({
      userId: user._id,
      signature,
      kind: feeKind,
      tokens: feeTokens,
    });

    if (result.ok && result.recorded) {
      console.log(
        `[booster/send] Fee recorded (${feeKind}) for ${signature.slice(0, 8)}`
      );
    } else if (result.ok && !result.recorded) {
      console.log(
        `[booster/send] Fee skipped (${result.reason}): ${signature.slice(0, 8)}`
      );
    }
  } catch (err) {
    // Log but don't throw - fee recording shouldn't break the transaction
    console.error(
      "[booster/send] Fee recording failed:",
      err instanceof Error ? err.message : err
    );
  }
}

/* ───────── ROUTE ───────── */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const traceId = Math.random().toString(36).slice(2, 10);
  const stageRef: { stage: string } = { stage: "init" };

  try {
    // ─────────── Auth ───────────
    stageRef.stage = "auth";
    let authedUserPk: PublicKey;
    const session = await getSessionFromCookies();
    if (!session?.userId) {
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: "Not authenticated",
        userMessage: "Please sign in to continue.",
        tip: "Refresh the page and try again.",
        traceId,
        stage: stageRef.stage,
      });
    }
    try {
      const user = await requireServerUser();
      authedUserPk = getUserWalletPubkey(user);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Unauthorized";
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: m,
        userMessage: "Please sign in again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    // ─────────── Rate Limit ───────────
    stageRef.stage = "rateLimit";
    const blocked = await rateLimitServer(req, {
      api: "booster:send",
      requireAuth: true,
      allowIpFallback: false,
      failMode: "closed",
      tiers: [
        { limit: 3, windowMs: 10_000, suffix: "burst" },
        { limit: 8, windowMs: 60_000, suffix: "minute" },
        { limit: 40, windowMs: 3_600_000, suffix: "hour" },
      ],
      globalTiers: [
        { limit: 20, windowMs: 10_000, suffix: "burst" },
        { limit: 100, windowMs: 60_000, suffix: "minute" },
      ],
    });
    if (blocked) return blocked;

    stageRef.stage = "parseBody";
    const parsed = (await req
      .json()
      .catch(() => null)) as SendRequestBody | null;

    const transaction = parsed?.transaction;
    if (!transaction) {
      return jsonError(400, {
        code: "MISSING_TRANSACTION",
        error: "Missing transaction payload",
        userMessage: "Invalid request.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    // Extract fee info (optional)
    const feeUnits = typeof parsed?.feeUnits === "number" ? parsed.feeUnits : 0;
    const feeMint =
      typeof parsed?.feeMint === "string" ? parsed.feeMint.trim() : "";
    const feeKind =
      typeof parsed?.feeKind === "string" ? parsed.feeKind.trim() : "perp";

    stageRef.stage = "deserialize";
    let userSignedTx: VersionedTransaction;
    try {
      const raw = Buffer.from(transaction, "base64");
      if (raw.length === 0) throw new Error("Empty transaction");
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, {
        code: "INVALID_TRANSACTION",
        error: "Failed to deserialize transaction",
        userMessage: "Invalid transaction format.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    /* ───────── VALIDATION ───────── */

    stageRef.stage = "validateFeePayer";
    const msgShape = userSignedTx.message as unknown as MessageV0Subset;
    const payerRaw = msgShape.staticAccountKeys?.[0];

    let payerPk: PublicKey | null = null;
    try {
      payerPk =
        payerRaw instanceof PublicKey ? payerRaw : new PublicKey(payerRaw!);
    } catch {
      payerPk = null;
    }

    if (!payerPk || !payerPk.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "INVALID_FEE_PAYER",
        error: "Invalid fee payer",
        userMessage: "Transaction validation failed.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    stageRef.stage = "validateBlockhash";
    const recentBlockhash = msgShape.recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return jsonError(400, {
        code: "INVALID_BLOCKHASH",
        error: "Invalid or dummy blockhash",
        userMessage: "Transaction expired.",
        tip: "Please try again with a fresh transaction.",
        traceId,
        stage: stageRef.stage,
      });
    }

    stageRef.stage = "validateUserSignature";
    const header = msgShape.header ?? {};
    const requiredSignatures = header.numRequiredSignatures ?? 0;
    const preSigSlots =
      (userSignedTx as unknown as HasSignatures).signatures ?? [];
    const preSigPresent = preSigSlots.map((s) => (s ? !anyZero(s) : false));

    if (requiredSignatures >= 2 && !preSigPresent[1]) {
      return jsonError(400, {
        code: "MISSING_USER_SIGNATURE",
        error: "User signature missing",
        userMessage: "Please sign the transaction in your wallet.",
        tip: "Try again and approve when prompted.",
        traceId,
        stage: stageRef.stage,
      });
    }

    // Extract owner pubkey
    let ownerPk: PublicKey | null = null;
    if (requiredSignatures >= 2) {
      const ownerRaw = msgShape.staticAccountKeys?.[1];
      try {
        ownerPk =
          ownerRaw instanceof PublicKey ? ownerRaw : new PublicKey(ownerRaw!);
      } catch {
        ownerPk = null;
      }
    }

    // ─────────── Wallet Binding ───────────
    stageRef.stage = "walletBinding";
    if (requiredSignatures >= 2 && !ownerPk) {
      return jsonError(400, {
        code: "MISSING_OWNER_PK",
        error: "Missing owner public key",
        userMessage: "This request is missing the owner public key.",
        traceId,
        stage: stageRef.stage,
      });
    }
    if (ownerPk && !ownerPk.equals(authedUserPk)) {
      return jsonError(403, {
        code: "WALLET_MISMATCH",
        error: "Transaction owner does not match authenticated user",
        userMessage: "This request doesn't match your account.",
        traceId,
        stage: stageRef.stage,
      });
    }

    // ✅ Prevent SOL drain attacks via SystemProgram instructions
    stageRef.stage = "spendGuards";
    try {
      validateHavenSpendGuards(userSignedTx, {
        allowSystemTransfers: [
          { to: authedUserPk, maxLamports: BOOSTER_MAX_TOPUP_LAMPORTS },
        ],
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Unsafe transaction";
      return jsonError(400, {
        code: "UNSAFE_TX",
        error: m,
        userMessage: "Security check failed. Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    /* ───────── PRIVY CO-SIGN ───────── */

    stageRef.stage = "privySign";
    const privy = getPrivyClient();

    let coSignedBytes: Uint8Array;
    try {
      console.log(`[booster/send] ${traceId} Calling Privy signTransaction...`);

      const resp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });

      coSignedBytes = toSignedBytes(resp);

      console.log(
        `[booster/send] ${traceId} Successfully parsed signed bytes, length: ${coSignedBytes.length}`
      );
    } catch (err: unknown) {
      const shaped = shapeErr(err);
      const low = shaped.message.toLowerCase();

      console.error(`[booster/send] ${traceId} Privy signing error:`, shaped);

      if (low.includes("blockhash") || low.includes("expired")) {
        return jsonError(409, {
          code: "BLOCKHASH_EXPIRED",
          error: "Blockhash expired during signing",
          userMessage: "Transaction expired.",
          tip: "Please try again with a fresh transaction.",
          traceId,
          stage: stageRef.stage,
        });
      }

      return jsonError(500, {
        code: "SIGNING_FAILED",
        error: "Failed to co-sign transaction",
        userMessage: "Internal signing error.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
        details: shaped.message,
      });
    }

    stageRef.stage = "verifySignatures";
    const cosignedTx = VersionedTransaction.deserialize(coSignedBytes);
    const postSigSlots =
      (cosignedTx as unknown as HasSignatures).signatures ?? [];
    const postSigPresent = postSigSlots.map((s) => (s ? !anyZero(s) : false));

    if (
      requiredSignatures > 0 &&
      postSigPresent.slice(0, requiredSignatures).some((v) => !v)
    ) {
      return jsonError(400, {
        code: "INCOMPLETE_SIGNATURES",
        error: "Missing signatures after co-sign",
        userMessage: "Transaction signing failed.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    /* ───────── SIMULATE + SEND ───────── */

    stageRef.stage = "initConnection";
    const conn = new Connection(SOLANA_RPC, "confirmed");

    stageRef.stage = "simulate";
    let simSuccess = false;

    try {
      const sim = await conn.simulateTransaction(cosignedTx, {
        replaceRecentBlockhash: false,
        commitment: "confirmed",
        sigVerify: true,
      });

      if (sim.value.err) {
        return jsonError(400, {
          code: "SIMULATION_FAILED",
          error: "Transaction would fail on-chain",
          userMessage: "Transaction simulation failed.",
          tip: "Try adjusting your trade amount.",
          traceId,
          stage: stageRef.stage,
          logs: sim.value.logs ?? [],
          details: sim.value.err,
        });
      }

      simSuccess = true;
    } catch (simErr: unknown) {
      const shaped = shapeErr(simErr);
      console.warn(
        `[booster/send] ${traceId} simulation threw:`,
        shaped.message
      );
    }

    stageRef.stage = "send";
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: simSuccess,
        maxRetries: 2,
        preflightCommitment: "processed",
      });
    } catch (err: unknown) {
      const asSendErr = err as SendTransactionError;
      const shaped = shapeErr(err);

      let logs: string[] = [];
      if (typeof asSendErr?.getLogs === "function") {
        logs = (await asSendErr.getLogs(conn).catch(() => [])) ?? [];
      }

      return jsonError(400, {
        code: "SEND_FAILED",
        error: "Failed to broadcast transaction",
        userMessage: "Failed to send transaction.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
        logs,
        details: shaped.message,
      });
    }

    /* ───────── RECORD FEE (fire-and-forget) ───────── */
    if (feeMint || feeUnits > 0) {
      recordFeeFromChainAsync({
        conn,
        privyId: session.userId,
        signature,
        feeMintHint: feeMint || undefined,
        feeKind,
      }).catch(() => {
        // Already logged inside the function
      });
    }

    /* ───────── CONFIRM ───────── */

    stageRef.stage = "confirm";
    let confirmed = false;
    try {
      if (recentBlockhash) {
        const latest = await conn.getLatestBlockhash("confirmed");
        await conn.confirmTransaction(
          {
            signature,
            blockhash: recentBlockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed"
        );
        confirmed = true;
      }
    } catch {
      confirmed = false;
    }

    /* ───────── POST-CONFIRMATION ───────── */

    stageRef.stage = "postConfirm";
    let ownerLamportsAfter: number | null = null;
    let dustExceeded = false;

    if (confirmed && ownerPk) {
      try {
        ownerLamportsAfter = await conn.getBalance(ownerPk, "confirmed");
        dustExceeded = ownerLamportsAfter > DUST_MAX_LAMPORTS;
      } catch {
        // Not critical
      }
    }

    /* ───────── RESPONSE ───────── */

    const totalTime = Date.now() - startTime;
    console.log(
      `[booster/send] ✅ ${signature.slice(0, 8)} in ${totalTime}ms (confirmed: ${confirmed})`
    );

    return NextResponse.json({
      signature,
      traceId,
      confirmed,
      owner: ownerPk?.toBase58() ?? null,
      ownerLamportsAfter,
      dustPolicy: {
        keepDustLamports: KEEP_DUST_LAMPORTS,
        toleranceLamports: DUST_TOLERANCE_LAMPORTS,
        maxAllowedLamports: DUST_MAX_LAMPORTS,
      },
      dustExceeded,
      sweepSuggestion:
        confirmed && ownerLamportsAfter !== null && dustExceeded
          ? {
              userMessage: "Extra SOL detected. Sweep recommended.",
              endpoint: "/api/booster/sweep-sol",
              keepLamports: KEEP_DUST_LAMPORTS,
            }
          : null,
      meta: {
        processingTimeMs: totalTime,
      },
    });
  } catch (e: unknown) {
    const totalTime = Date.now() - startTime;
    const shaped = shapeErr(e);
    console.error(
      `[booster/send] ❌ Failed in ${totalTime}ms at ${stageRef.stage}:`,
      shaped
    );

    return jsonError(500, {
      code: "UNHANDLED_ERROR",
      error: shaped.message,
      userMessage: "Internal error.",
      tip: "Please try again.",
      traceId,
      stage: stageRef.stage,
      details: shaped,
    });
  }
}
