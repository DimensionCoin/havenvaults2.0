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
  ParsedTransactionMeta,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getSessionFromCookies } from "@/lib/auth";
import { connect as connectMongo } from "@/lib/db";
import { recordUserFees, type FeeToken } from "@/lib/fees";
import mongoose from "mongoose";

/* ───────── Next.js route config ───────── */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Env ───────── */

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
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);
const TREASURY_OWNER = new PublicKey(
  required("NEXT_PUBLIC_APP_TREASURY_OWNER")
);
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT"));

/* ───────── Types ───────── */

type Body = { transaction: string };

type ErrorLike = {
  message?: unknown;
  body?: unknown;
  bodyAsString?: unknown;
};

type MessageV0Subset = {
  staticAccountKeys: PublicKey[];
  recentBlockhash?: string;
};

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

/* ───────── Response helpers ───────── */

function jsonError(
  status: number,
  message: string,
  extra?: JsonErrorExtra
): NextResponse {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status });
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
      (payload as { serialize: () => Uint8Array }).serialize()
    );
  }

  throw new Error("Unexpected signTransaction return type");
}

/* ───────── Tx confirmation ───────── */

async function confirmSig(conn: Connection, signature: string) {
  try {
    const bh = await conn.getLatestBlockhash("confirmed");
    const res = await conn.confirmTransaction(
      { signature, ...bh },
      "confirmed"
    );
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
  } catch {
    const res2 = await conn.confirmTransaction(signature, "confirmed");
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
        l.startsWith("Instruction ")
    );
}

/* ───────── BigInt helpers (NO BigInt literals) ───────── */

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

// 10^d without bigint exponentiation / literals (keeps TS target < ES2020 happy)
function pow10BigInt(decimals: number): bigint {
  const d = clampDecimals(decimals);
  let out = BigInt(1);
  const ten = BigInt(10);
  for (let i = 0; i < d; i++) out = out * ten;
  return out;
}

/* ───────── Fee detection (reliable: uses confirmed meta) ───────── */

type TokenBalanceMetaLike = {
  accountIndex?: number;
  owner?: string;
  mint?: string;
  uiTokenAmount?: {
    amount?: string; // base units string
    decimals?: number;
  };
  // some RPCs also include these:
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

/**
 * Detect all token deltas RECEIVED by treasury owner by reading tx meta:
 * - Supports SPL + Token-2022
 * - Supports ALTs (loaded addresses)
 * - Supports inner instructions
 * - Supports Transfer + TransferChecked
 *
 * Mechanism:
 *   For each token account owned by TREASURY_OWNER:
 *     delta = postTokenBalance.amount - preTokenBalance.amount  (base units)
 *   Aggregate deltas by mint.
 */
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

    // Only token accounts owned by the treasury owner
    const owner = pb?.owner;
    if (owner !== ownerStr) continue;

    const mint = String(pb?.mint || "").trim();
    if (!mint) continue;

    const decimalsRaw = Number(
      pb?.uiTokenAmount?.decimals ?? pb?.decimals ?? 0
    );
    const decimals = clampDecimals(decimalsRaw);

    // `uiTokenAmount.amount` is base-units string (best source)
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
    if (delta <= bi0()) continue; // only received amounts

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

    // Fees are expected to be small -> converting is safe for your use case.
    // If you ever allow very large fee transfers, switch FeeToken.amountUi to string.
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

/**
 * Transaction meta can be briefly unavailable right after confirmation depending on RPC.
 * This retries a couple times to avoid missing fee events.
 */
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
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return jsonError(415, "Content-Type must be application/json");
  }

  try {
    const session = await getSessionFromCookies();
    if (!session?.userId) return jsonError(401, "Unauthorized");

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, "Missing 'transaction' in body");
    }

    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length) return jsonError(400, "Invalid transaction encoding");

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, "Invalid VersionedTransaction");
    }

    // Fee payer must be Haven sponsor wallet (index 0 in v0 message)
    const payer = userSignedTx.message.staticAccountKeys[0];
    if (!payer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, "Invalid fee payer (must be Haven sponsor wallet)");
    }

    // Reject dummy/empty blockhash
    const recentBlockhash = (userSignedTx.message as unknown as MessageV0Subset)
      .recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return jsonError(400, "Transaction has invalid or dummy recentBlockhash");
    }

    const conn = new Connection(SOLANA_RPC, "confirmed");

    // Pre-flight: ensure fee payer has SOL to sponsor fees
    try {
      const lamports = await conn.getBalance(HAVEN_PUBKEY, "processed");
      const balanceSol = lamports / LAMPORTS_PER_SOL;
      const MIN_FEE_WALLET_SOL = 0.005;

      if (balanceSol < MIN_FEE_WALLET_SOL) {
        console.error(
          "[/api/user/wallet/transfer] Haven fee payer underfunded",
          { balanceSol }
        );
        return jsonError(
          503,
          "Haven fee wallet is temporarily underfunded. Please try again shortly.",
          { code: "FEEPAYER_UNDERFUNDED" }
        );
      }
    } catch (err) {
      console.error(
        "[/api/user/wallet/transfer] Failed to read fee payer balance:",
        err
      );
    }

    // Co-sign with Privy (Haven fee payer)
    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });

    let coSignedBytes: Uint8Array;
    try {
      const resp: unknown = await appPrivy.walletApi.solana.signTransaction({
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
        return jsonError(
          400,
          "Signature verification failed (message mutated or signer order incorrect).",
          { code: "SIGNATURE_VERIFICATION_FAILED" }
        );
      }

      console.error(
        "[/api/user/wallet/transfer] Privy signTransaction failed",
        { message: msgStr }
      );
      return jsonError(500, "Privy signTransaction failed.", {
        code: "PRIVY_SIGN_FAILED",
      });
    }

    const sendOpts: SendOptions = { skipPreflight: false, maxRetries: 3 };

    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, sendOpts);
    } catch (err: unknown) {
      const msg = String(
        (err as { message?: unknown })?.message ?? err
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
        console.error(
          "[/api/user/wallet/transfer] Insufficient funds for fee or transfer:",
          err
        );
        return jsonError(
          400,
          "Not enough SOL to pay network fees. Check the fee wallet and sender balance.",
          { code: "INSUFFICIENT_FUNDS" }
        );
      }

      if (typeof (err as SendTransactionError)?.getLogs === "function") {
        try {
          const logs = await (err as SendTransactionError).getLogs(conn);
          console.error(
            "[/api/user/wallet/transfer] Simulation failed. Full logs:",
            logs
          );
          return jsonError(400, "Simulation failed.", {
            code: "SIMULATION_FAILED",
            logs: summarizeLogs(logs),
          });
        } catch {
          // ignore getLogs failures
        }
      }

      console.error(
        "[/api/user/wallet/transfer] sendRawTransaction error:",
        err
      );
      return jsonError(500, "Broadcast failed.", {
        code: "BROADCAST_FAILED",
        details: String((err as { message?: unknown })?.message ?? err),
      });
    }

    // Confirm
    await confirmSig(conn, signature);

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

        const userId = mongoose.Types.ObjectId.isValid(session.userId)
          ? new mongoose.Types.ObjectId(session.userId)
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
      console.error("[/api/user/wallet/transfer] Fee tracking failed:", e);
    }

    return NextResponse.json({
      signature,
      feeTokensDetected,
      treasuryOwner: TREASURY_OWNER.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/user/wallet/transfer] Unhandled error:", msg);
    return jsonError(500, "Internal server error.", {
      code: "UNHANDLED",
      details: msg,
    });
  }
}
