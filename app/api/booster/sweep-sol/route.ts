// app/api/booster/sweep-sol/route.ts
import { NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Commitment,
} from "@solana/web3.js";

import { RPC_CONNECTION } from "@/types/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HAVEN_FEEPAYER_STR = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!;

const COMMITMENT: Commitment = "processed";

// Exact rent-exempt minimum for a 0-data account (128 bytes base)
// = 2 years of rent = ceil(128 * 3.48 * 2) = 890,880 lamports
const RENT_EXEMPT_MINIMUM = 890_880;
const DEFAULT_KEEP_LAMPORTS = RENT_EXEMPT_MINIMUM;

// Optimized compute settings for simple SOL transfer
// SystemProgram.transfer uses ~450 CUs, add buffer for compute budget ixs
const COMPUTE_UNIT_LIMIT = 1_500;

// Priority fee: balance between speed and cost
// 10k microlamports * 1.5k CU = 15 lamports (very cheap)
const PRIORITY_MICROLAMPORTS = 10_000;

// Don't bother sweeping if less than this (~0.0001 SOL)
const MIN_SWEEP_LAMPORTS = 100_000;

// Cache blockhash to reduce RPC calls (valid for ~60-90 seconds)
let cachedBlockhash: {
  blockhash: string;
  lastValidBlockHeight: number;
  fetchedAt: number;
} | null = null;

const BLOCKHASH_CACHE_MS = 30_000; // Refresh every 30s to be safe

// Pre-compute fee payer pubkey at module load
let HAVEN_FEEPAYER: PublicKey | null = null;
if (HAVEN_FEEPAYER_STR) {
  try {
    HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
  } catch {
    console.error("[sweep-sol] Invalid HAVEN_FEEPAYER_ADDRESS");
  }
}

function jsonError(
  status: number,
  payload: {
    code: string;
    error: string;
    userMessage: string;
    details?: unknown;
  }
) {
  console.error("[/api/booster/sweep-sol] error", status, payload);
  return NextResponse.json(payload, { status });
}

function safeBase58Pk(input: unknown): PublicKey | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s.length < 32 || s.length > 44) return null; // Quick length check
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

async function getBlockhashCached(): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const now = Date.now();

  if (cachedBlockhash && now - cachedBlockhash.fetchedAt < BLOCKHASH_CACHE_MS) {
    return {
      blockhash: cachedBlockhash.blockhash,
      lastValidBlockHeight: cachedBlockhash.lastValidBlockHeight,
    };
  }

  const result = await RPC_CONNECTION.getLatestBlockhash(COMMITMENT);
  cachedBlockhash = {
    ...result,
    fetchedAt: now,
  };

  return result;
}

export async function POST(req: Request) {
  const traceId = Math.random().toString(36).slice(2, 10);

  try {
    // Early validation - fail fast
    if (!HAVEN_FEEPAYER) {
      return jsonError(500, {
        code: "MISSING_ENV",
        error: "Missing or invalid HAVEN_FEEPAYER_ADDRESS",
        userMessage: "We couldn't sweep SOL right now.",
        details: { traceId },
      });
    }

    // Parse body - use streaming parse for efficiency
    let body: { ownerBase58?: string; keepLamports?: number } | null = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    const owner = safeBase58Pk(body?.ownerBase58);
    if (!owner) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "ownerBase58 is required and must be valid base58",
        userMessage: "We couldn't sweep SOL.",
        details: { ownerBase58: body?.ownerBase58 ?? null, traceId },
      });
    }

    // Calculate keep amount with rent-exempt floor
    let keepLamports = DEFAULT_KEEP_LAMPORTS;
    if (
      typeof body?.keepLamports === "number" &&
      body.keepLamports > RENT_EXEMPT_MINIMUM
    ) {
      keepLamports = Math.floor(body.keepLamports);
    }

    // Parallel fetch: balance + blockhash (key optimization)
    const [ownerLamports, blockhashData] = await Promise.all([
      RPC_CONNECTION.getBalance(owner, COMMITMENT),
      getBlockhashCached(),
    ]);

    const { blockhash, lastValidBlockHeight } = blockhashData;

    // Calculate sweepable amount
    // Since Haven pays fees, owner just needs to keep rent-exempt minimum
    const drainLamports = ownerLamports - keepLamports;

    // Nothing to sweep check
    if (drainLamports < MIN_SWEEP_LAMPORTS) {
      return NextResponse.json({
        traceId,
        transaction: null,
        meta: {
          reason: drainLamports <= 0 ? "NOTHING_TO_SWEEP" : "BELOW_MINIMUM",
          owner: owner.toBase58(),
          ownerLamports,
          keepLamports,
          drainLamports: Math.max(0, drainLamports),
          userMessage:
            drainLamports <= 0
              ? "Balance is already at minimum required level."
              : `Only ${(drainLamports / 1e9).toFixed(6)} SOL available, below minimum sweep threshold.`,
        },
      });
    }

    // Build minimal transaction
    const ixs = [
      // Set compute limit first (helps validators estimate resources)
      ComputeBudgetProgram.setComputeUnitLimit({
        units: COMPUTE_UNIT_LIMIT,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_MICROLAMPORTS,
      }),
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: HAVEN_FEEPAYER,
        lamports: drainLamports,
      }),
    ];

    // Compile v0 message (more efficient than legacy)
    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);

    // Serialize directly to base64
    const b64 = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json({
      traceId,
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      meta: {
        reason: "SWEEP_SOL_BUILT",
        owner: owner.toBase58(),
        to: HAVEN_FEEPAYER.toBase58(),
        ownerLamports,
        keepLamports,
        drainLamports,
        estimatedRemainingLamports: keepLamports,
        computeUnits: COMPUTE_UNIT_LIMIT,
        priorityFee: Math.ceil(
          (PRIORITY_MICROLAMPORTS * COMPUTE_UNIT_LIMIT) / 1_000_000
        ),
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonError(500, {
      code: "UNHANDLED_SWEEP_ERROR",
      error: message,
      userMessage: "We couldn't sweep SOL right now.",
      details: { traceId },
    });
  }
}
