// app/api/booster/close/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Commitment,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  RPC_CONNECTION,
  JUPITER_PERPETUALS_PROGRAM_ID,
  JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
  JUPITER_PERPETUALS_CONFIG_PUBKEY,
  CUSTODY_PUBKEY,
  JLP_POOL_ACCOUNT_PUBKEY,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  USDC_MINT,
} from "@/types/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── ENV / CONSTANTS ───────── */

const HAVEN_FEEPAYER_STR = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!;

const PROCESSED_COMMITMENT: Commitment = "processed";

// ✅ Optimized compute settings
// Close is simpler than open - needs less compute
const PRIORITY_MICROLAMPORTS = 50_000; // Match open route for consistent priority
const COMPUTE_UNIT_LIMIT = 300_000; // Reduced from 400k - close uses less CU

// ✅ FIXED RENT VALUES - No RPC calls needed (Solana rents are constant)
const RENT_TOKEN_ACC = 2_039_280; // ~0.00204 SOL (165 bytes)
const RENT_POSITION_REQUEST = 3_565_920; // ~0.00357 SOL (512 bytes)

const BASE_FEE_BUFFER_LAMPORTS = 10_000;

// SOL management - match open route exactly
const JUP_MIN_WALLET_LAMPORTS = 30_000_000; // 0.03 SOL
const KEEP_DUST_LAMPORTS = 900_000; // 0.0009 SOL (rent-exempt minimum)
const SAFE_SOL_BUFFER_LAMPORTS = 300_000; // ~0.0003 SOL buffer

// ✅ Safety limit on SOL top-up
const ABSOLUTE_MAX_TOPUP = 50_000_000; // 0.05 SOL max

// Pre-compute fee payer at module load
let HAVEN_FEEPAYER: PublicKey | null = null;
if (HAVEN_FEEPAYER_STR) {
  try {
    HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
  } catch {
    console.error("[close] Invalid HAVEN_FEEPAYER_ADDRESS");
  }
}

/* ───────── HELPERS ───────── */

function jsonError(
  status: number,
  payload: {
    code: string;
    error: string;
    userMessage: string;
    stage?: string;
    details?: unknown;
  }
) {
  console.error("[/api/booster/close] error", status, payload);
  return NextResponse.json({ ok: false, ...payload }, { status });
}

async function detectTokenProgramId(mint: PublicKey): Promise<PublicKey> {
  const info = await RPC_CONNECTION.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

function generatePositionPda(args: {
  custody: PublicKey;
  collateralCustody: PublicKey;
  walletAddress: PublicKey;
  side: "long" | "short";
}) {
  const sideSeed = args.side === "long" ? Buffer.from([1]) : Buffer.from([2]);

  const [position] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      args.walletAddress.toBuffer(),
      JLP_POOL_ACCOUNT_PUBKEY.toBuffer(),
      args.custody.toBuffer(),
      args.collateralCustody.toBuffer(),
      sideSeed,
    ],
    JUPITER_PERPETUALS_PROGRAM_ID
  );

  return { position };
}

function generatePositionRequestPda(args: {
  position: PublicKey;
  counter?: BN;
  requestChange: "increase" | "decrease";
}) {
  const counter =
    args.counter ?? new BN(Math.floor(Math.random() * 1_000_000_000));
  const requestChangeEnum =
    args.requestChange === "increase" ? Buffer.from([1]) : Buffer.from([2]);

  const [positionRequest] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position_request"),
      args.position.toBuffer(),
      counter.toArrayLike(Buffer, "le", 8),
      requestChangeEnum,
    ],
    JUPITER_PERPETUALS_PROGRAM_ID
  );

  return { positionRequest, counter };
}

const UNDERLYING_BY_SYMBOL: Record<"BTC" | "ETH" | "SOL", PublicKey> = {
  BTC: new PublicKey(CUSTODY_PUBKEY.BTC),
  ETH: new PublicKey(CUSTODY_PUBKEY.ETH),
  SOL: new PublicKey(CUSTODY_PUBKEY.SOL),
};
const USDC_CUSTODY = new PublicKey(CUSTODY_PUBKEY.USDC);

/* ───────── IX ENCODING ───────── */

function encodeU64(value: BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8);
}

function encodeOptionU64(value: BN | null): Buffer {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeU64(value)]);
}

function encodeOptionBool(value: boolean | null | undefined): Buffer {
  if (value === null || value === undefined) return Buffer.from([0]);
  return Buffer.from([1, value ? 1 : 0]);
}

const CREATE_DECREASE_POSITION_DISC = crypto
  .createHash("sha256")
  .update("global:create_decrease_position_market_request")
  .digest()
  .subarray(0, 8);

function encodeCreateDecreasePositionMarketRequest(args: {
  collateralUsdDelta: BN;
  sizeUsdDelta: BN;
  priceSlippage: BN;
  jupiterMinimumOut: BN | null;
  entirePosition: boolean | null;
  counter: BN;
}): Buffer {
  return Buffer.concat([
    CREATE_DECREASE_POSITION_DISC,
    encodeU64(args.collateralUsdDelta),
    encodeU64(args.sizeUsdDelta),
    encodeU64(args.priceSlippage),
    encodeOptionU64(args.jupiterMinimumOut),
    encodeOptionBool(args.entirePosition),
    encodeU64(args.counter),
  ]);
}

/* ───────── ROUTE ───────── */

export async function POST(req: Request) {
  const startTime = Date.now();
  const stageRef = { stage: "init" };

  try {
    // ✅ Early validation - fail fast
    stageRef.stage = "envCheck";
    if (!HAVEN_FEEPAYER || !USDC_MINT) {
      return jsonError(500, {
        code: "MISSING_ENV",
        error: "Missing env vars",
        userMessage: "Service configuration error.",
        stage: stageRef.stage,
      });
    }

    stageRef.stage = "parseBody";
    const body = (await req.json().catch(() => null)) as {
      ownerBase58?: string;
      side?: "long" | "short";
      symbol?: "BTC" | "ETH" | "SOL";
      entirePosition?: boolean;
      sizeUsdDeltaUnits?: number | string;
      collateralUsdDeltaUnits?: number | string;
      priceSlippageBps?: number;
    } | null;

    const ownerBase58 = body?.ownerBase58?.trim() ?? "";
    const side = body?.side ?? "long";
    const symbol = body?.symbol ?? "BTC";
    const priceSlippageBps = Number(body?.priceSlippageBps ?? 500);
    const entirePosition = body?.entirePosition !== false; // Default true

    // Validation
    if (
      !ownerBase58 ||
      !(symbol in UNDERLYING_BY_SYMBOL) ||
      (side !== "long" && side !== "short") ||
      !Number.isFinite(priceSlippageBps) ||
      priceSlippageBps < 0
    ) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Invalid payload",
        userMessage: "Invalid close parameters.",
        stage: stageRef.stage,
      });
    }

    const owner = new PublicKey(ownerBase58);
    const custody = UNDERLYING_BY_SYMBOL[symbol];
    const collateralCustody = side === "long" ? custody : USDC_CUSTODY;

    stageRef.stage = "derivePDAs";
    const { position } = generatePositionPda({
      custody,
      collateralCustody,
      walletAddress: owner,
      side,
    });
    const { positionRequest, counter } = generatePositionRequestPda({
      position,
      requestChange: "decrease",
    });

    stageRef.stage = "tokenSetup";
    const usdcProgramId = await detectTokenProgramId(USDC_MINT);

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      usdcProgramId
    );
    const positionRequestAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      positionRequest,
      true,
      usdcProgramId
    );

    /* ───────── ✅ BATCHED RPC CALLS ───────── */

    stageRef.stage = "batchedRpcCalls";

    const [
      positionInfo,
      positionReqInfo,
      userAtaInfo,
      prAtaInfo,
      ownerLamportsBefore,
      havenLamports,
      blockhashData,
    ] = await Promise.all([
      RPC_CONNECTION.getAccountInfo(position, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getAccountInfo(positionRequest, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getAccountInfo(userUsdcAta, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getAccountInfo(positionRequestAta, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getBalance(owner, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getBalance(HAVEN_FEEPAYER, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getLatestBlockhash(PROCESSED_COMMITMENT),
    ]);

    // Check position exists
    if (!positionInfo) {
      return jsonError(400, {
        code: "POSITION_NOT_FOUND",
        error: "Position does not exist",
        userMessage: "No open position found to close.",
        stage: stageRef.stage,
        details: { position: position.toBase58() },
      });
    }

    // Account existence flags
    const willCreatePositionReq = !positionReqInfo;
    const userAtaExists = !!userAtaInfo;
    const prAtaExists = !!prAtaInfo;

    /* ───────── AMOUNTS ───────── */

    stageRef.stage = "amounts";
    const zero = new BN(0);

    let sizeUsdDeltaBn = new BN(
      typeof body?.sizeUsdDeltaUnits === "string"
        ? body.sizeUsdDeltaUnits
        : Math.floor(Number(body?.sizeUsdDeltaUnits || 0))
    );

    let collateralUsdDeltaBn = new BN(
      typeof body?.collateralUsdDeltaUnits === "string"
        ? body.collateralUsdDeltaUnits
        : Math.floor(Number(body?.collateralUsdDeltaUnits || 0))
    );

    // Full close: set deltas to 0
    if (entirePosition) {
      sizeUsdDeltaBn = zero;
      collateralUsdDeltaBn = zero;
    } else if (sizeUsdDeltaBn.lte(zero) && collateralUsdDeltaBn.lte(zero)) {
      return jsonError(400, {
        code: "INVALID_CLOSE_DELTAS",
        error: "Partial close requires non-zero delta",
        userMessage: "Please specify an amount to close.",
        stage: stageRef.stage,
      });
    }

    const priceSlippageBn = new BN(priceSlippageBps);

    /* ───────── SOL TOP-UP MATH ───────── */

    stageRef.stage = "solMath";

    // Using constant rent values
    const rentNeededReq = willCreatePositionReq ? RENT_POSITION_REQUEST : 0;
    const predictedOwnerRentNeed = rentNeededReq;

    const requiredOwnerLamportsDuringTx = Math.max(
      JUP_MIN_WALLET_LAMPORTS,
      predictedOwnerRentNeed + KEEP_DUST_LAMPORTS
    );

    const targetOwnerLamports =
      requiredOwnerLamportsDuringTx + SAFE_SOL_BUFFER_LAMPORTS;

    const topUpLamports = Math.max(
      0,
      targetOwnerLamports - ownerLamportsBefore
    );

    // Safety check
    if (topUpLamports > ABSOLUTE_MAX_TOPUP) {
      return jsonError(400, {
        code: "TOPUP_EXCEEDS_LIMIT",
        error: `Top-up ${topUpLamports} exceeds limit ${ABSOLUTE_MAX_TOPUP}`,
        userMessage: "Required SOL amount is too high.",
        stage: stageRef.stage,
        details: { topUpLamports, limit: ABSOLUTE_MAX_TOPUP },
      });
    }

    /* ───────── HAVEN SOL CHECK ───────── */

    stageRef.stage = "havenSolCheck";

    const missingAtaRent =
      (userAtaExists ? 0 : RENT_TOKEN_ACC) + (prAtaExists ? 0 : RENT_TOKEN_ACC);

    const estimatedPriorityFeeLamports = Math.ceil(
      (COMPUTE_UNIT_LIMIT * PRIORITY_MICROLAMPORTS) / 1_000_000
    );

    const requiredLamportsForThisTx =
      topUpLamports +
      missingAtaRent +
      estimatedPriorityFeeLamports +
      BASE_FEE_BUFFER_LAMPORTS;

    if (havenLamports < requiredLamportsForThisTx) {
      return jsonError(500, {
        code: "HAVEN_FEEPAYER_LOW_SOL",
        error: "Haven fee payer low SOL",
        userMessage: "Service temporarily unavailable.",
        stage: stageRef.stage,
      });
    }

    /* ───────── BUILD INSTRUCTIONS ───────── */

    stageRef.stage = "buildInstructions";

    const ixs: TransactionInstruction[] = [];

    // ✅ Compute budget - limit first for better validator estimation
    ixs.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_MICROLAMPORTS,
      })
    );

    // Top-up if needed
    if (topUpLamports > 0) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: HAVEN_FEEPAYER,
          toPubkey: owner,
          lamports: topUpLamports,
        })
      );
    }

    // Create ATAs (idempotent)
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userUsdcAta,
        owner,
        USDC_MINT,
        usdcProgramId
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        positionRequestAta,
        positionRequest,
        USDC_MINT,
        usdcProgramId
      )
    );

    // Jupiter perps close instruction
    const data = encodeCreateDecreasePositionMarketRequest({
      collateralUsdDelta: collateralUsdDeltaBn,
      sizeUsdDelta: sizeUsdDeltaBn,
      priceSlippage: priceSlippageBn,
      jupiterMinimumOut: null,
      entirePosition,
      counter,
    });

    ixs.push(
      new TransactionInstruction({
        programId: JUPITER_PERPETUALS_PROGRAM_ID,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: userUsdcAta, isSigner: false, isWritable: true },
          {
            pubkey: JUPITER_PERPETUALS_CONFIG_PUBKEY,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: JLP_POOL_ACCOUNT_PUBKEY,
            isSigner: false,
            isWritable: true,
          },
          { pubkey: position, isSigner: false, isWritable: true },
          { pubkey: positionRequest, isSigner: false, isWritable: true },
          { pubkey: positionRequestAta, isSigner: false, isWritable: true },
          { pubkey: custody, isSigner: false, isWritable: false },
          { pubkey: collateralCustody, isSigner: false, isWritable: false },
          { pubkey: USDC_MINT, isSigner: false, isWritable: false },
          { pubkey: PublicKey.default, isSigner: false, isWritable: false },
          { pubkey: usdcProgramId, isSigner: false, isWritable: false },
          {
            pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: JUPITER_PERPETUALS_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
          },
        ],
        data,
      })
    );

    /* ───────── COMPILE TX ───────── */

    stageRef.stage = "compile";

    const { blockhash, lastValidBlockHeight } = blockhashData;

    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const unsignedTx = new VersionedTransaction(msg);
    const b64 = Buffer.from(unsignedTx.serialize()).toString("base64");

    const buildTime = Date.now() - startTime;
    console.log(
      `[CLOSE] Built in ${buildTime}ms for ${symbol} ${side} entirePosition=${entirePosition}`
    );

    return NextResponse.json({
      ok: true,
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      meta: {
        symbol,
        side,
        entirePosition,
        sizeUsdDeltaUnits: sizeUsdDeltaBn.toString(),
        collateralUsdDeltaUnits: collateralUsdDeltaBn.toString(),
        position: position.toBase58(),
        positionRequest: positionRequest.toBase58(),
        requestCounter: counter.toString(),
        priceSlippageBps,
        ownerLamportsBefore,
        topUpLamports,
        predictedOwnerRentNeed,
        keepDustLamports: KEEP_DUST_LAMPORTS,
        buildTimeMs: buildTime,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[CLOSE] Error at ${stageRef.stage}:`, msg);
    return jsonError(500, {
      code: "UNHANDLED_BOOSTER_CLOSE_ERROR",
      error: msg,
      userMessage: "Failed to build close transaction.",
      stage: stageRef.stage,
    });
  }
}
