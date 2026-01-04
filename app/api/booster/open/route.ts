// app/api/booster/open/route.ts - OPTIMIZED FOR SPEED & RELIABILITY
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
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  RPC_CONNECTION,
  JUPITER_PERPETUALS_PROGRAM_ID,
  JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
  JUPITER_PERPETUALS_CONFIG_PUBKEY,
  CUSTODY_PUBKEY,
  USDC_DECIMALS,
  JLP_POOL_ACCOUNT_PUBKEY,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  USDC_MINT,
} from "@/types/constants";

export const runtime = "nodejs";

/* ───────── ENV / CONSTANTS ───────── */

const HAVEN_FEEPAYER_STR = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!;
const TREASURY_OWNER_STR = process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!;

const PROCESSED_COMMITMENT: Commitment = "processed";

// Leverage options
const ALLOWED_LEVERAGES = new Set([1.5, 2]);

// Haven fee: 2% of user margin
const BOOSTER_FEE_BPS = 200;

// Priority fee + compute - optimized for Jito/best path
const PRIORITY_MICROLAMPORTS = 50_000; // ✅ Increased for better priority
const COMPUTE_UNIT_LIMIT = 350_000; // ✅ Reduced (was 400k) - saves fees

// ✅ FIXED RENT VALUES - No RPC calls needed (Solana rents are constant)
const RENT_TOKEN_ACC = 2_039_280; // ~0.00204 SOL (165 bytes)
const RENT_POSITION = 6_124_800; // ~0.00612 SOL (896 bytes)
const RENT_REQUEST = 3_565_920; // ~0.00357 SOL (512 bytes)

const BASE_FEE_BUFFER_LAMPORTS = 10_000; // ✅ Increased buffer

// Jupiter requirements
const JUP_MIN_WALLET_LAMPORTS = 30_000_000; // 0.03 SOL
const KEEP_DUST_LAMPORTS = 900_000; // 0.0009 SOL (rent-exempt minimum)
const SAFE_SOL_BUFFER_LAMPORTS = 300_000; // ✅ Increased buffer (was 200k)

// ✅ CRITICAL SAFETY LIMIT
const ABSOLUTE_MAX_TOPUP = 50_000_000; // 0.05 SOL max per operation

// Price caps for slippage calculation
const MAX_PRICE_CAP_USD_1E6: Record<"BTC" | "ETH" | "SOL", BN> = {
  SOL: new BN("100000000000"),
  ETH: new BN("200000000000"),
  BTC: new BN("2000000000000"),
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
  console.error("[/api/booster/open] error", status, payload);
  return NextResponse.json(payload, { status });
}

async function detectTokenProgramId(mint: PublicKey) {
  const info = await RPC_CONNECTION.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

function generatePositionPda({
  custody,
  collateralCustody,
  walletAddress,
  side,
}: {
  custody: PublicKey;
  collateralCustody: PublicKey;
  walletAddress: PublicKey;
  side: "long" | "short";
}) {
  const sideSeed = side === "long" ? Buffer.from([1]) : Buffer.from([2]);
  const [position] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      walletAddress.toBuffer(),
      JLP_POOL_ACCOUNT_PUBKEY.toBuffer(),
      custody.toBuffer(),
      collateralCustody.toBuffer(),
      sideSeed,
    ],
    JUPITER_PERPETUALS_PROGRAM_ID
  );
  return { position };
}

function generatePositionRequestPda({
  position,
  counter,
  requestChange,
}: {
  position: PublicKey;
  counter?: BN;
  requestChange: "increase" | "decrease";
}) {
  const c = counter ?? new BN(Math.floor(Math.random() * 1_000_000_000));
  const requestChangeEnum =
    requestChange === "increase" ? Buffer.from([1]) : Buffer.from([2]);

  const [positionRequest] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position_request"),
      position.toBuffer(),
      c.toArrayLike(Buffer, "le", 8),
      requestChangeEnum,
    ],
    JUPITER_PERPETUALS_PROGRAM_ID
  );

  return { positionRequest, counter: c };
}

const UNDERLYING_BY_SYMBOL: Record<string, PublicKey> = {
  BTC: new PublicKey(CUSTODY_PUBKEY.BTC),
  ETH: new PublicKey(CUSTODY_PUBKEY.ETH),
  SOL: new PublicKey(CUSTODY_PUBKEY.SOL),
};

const USDC_CUSTODY = new PublicKey(CUSTODY_PUBKEY.USDC);

/* ───────── IX ENCODING ───────── */

function encodeU64(value: BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8);
}

type PerpsSideArg = {
  none?: Record<string, never>;
  long?: Record<string, never>;
  short?: Record<string, never>;
};

function encodeSide(side: PerpsSideArg): Buffer {
  let v = 0;
  if ("long" in side) v = 1;
  else if ("short" in side) v = 2;
  return Buffer.from([v]);
}

function encodeOptionU64(value: BN | null): Buffer {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeU64(value)]);
}

const CREATE_INCREASE_POSITION_DISC = crypto
  .createHash("sha256")
  .update("global:create_increase_position_market_request")
  .digest()
  .subarray(0, 8);

function encodeCreateIncreasePositionMarketRequest(args: {
  sizeUsdDelta: BN;
  collateralDelta: BN;
  side: PerpsSideArg;
  priceSlippage: BN;
  jupiterMinimumOut: BN | null;
  counter: BN;
}): Buffer {
  const {
    sizeUsdDelta,
    collateralDelta,
    side,
    priceSlippage,
    jupiterMinimumOut,
    counter,
  } = args;

  return Buffer.concat([
    CREATE_INCREASE_POSITION_DISC,
    encodeU64(sizeUsdDelta),
    encodeU64(collateralDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
    encodeOptionU64(jupiterMinimumOut),
    encodeU64(counter),
  ]);
}

function parseLeverage(raw: unknown): 1.5 | 2 {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;

  const rounded =
    Number.isFinite(n) && Math.abs(n - 1.5) < 1e-9
      ? 1.5
      : Number.isFinite(n) && Math.abs(n - 2) < 1e-9
        ? 2
        : NaN;

  if (!Number.isFinite(rounded) || !ALLOWED_LEVERAGES.has(rounded)) {
    throw new Error("INVALID_LEVERAGE");
  }
  return rounded as 1.5 | 2;
}

function leverageToFraction(lev: 1.5 | 2): { num: number; den: number } {
  return lev === 1.5 ? { num: 15, den: 10 } : { num: 2, den: 1 };
}

/* ───────── ROUTE ───────── */

export async function POST(req: Request) {
  const startTime = Date.now(); // ✅ Performance tracking
  const stageRef: { stage: string } = { stage: "init" };

  try {
    stageRef.stage = "envCheck";
    if (!USDC_MINT || !HAVEN_FEEPAYER_STR || !TREASURY_OWNER_STR) {
      return jsonError(500, {
        code: "MISSING_ENV",
        error: "Missing required environment variables",
        userMessage: "Service configuration error. Please try again.",
        stage: stageRef.stage,
      });
    }

    const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
    const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);

    stageRef.stage = "parseBody";
    const body = (await req.json().catch(() => null)) as {
      ownerBase58?: string;
      side?: "long" | "short";
      symbol?: "BTC" | "ETH" | "SOL";
      marginUnits?: number;
      priceSlippageBps?: number;
      leverage?: number | string;
    } | null;

    const ownerBase58 = body?.ownerBase58 ?? "";
    const side = body?.side ?? "long";
    const symbol = body?.symbol ?? "BTC";
    const marginUnits = body?.marginUnits ?? 0;
    const priceSlippageBps = body?.priceSlippageBps ?? 500;

    let leverage: 1.5 | 2 = 1.5;
    try {
      if (body && "leverage" in body && body.leverage !== undefined) {
        leverage = parseLeverage(body.leverage);
      }
    } catch {
      return jsonError(400, {
        code: "INVALID_LEVERAGE",
        error: "Invalid leverage. Allowed: 1.5 or 2",
        userMessage: "That multiplier isn't supported.",
        tip: "Choose 1.5× or 2× and try again.",
        stage: stageRef.stage,
        details: { leverage: body?.leverage },
      });
    }

    // Validation
    if (
      !ownerBase58 ||
      !UNDERLYING_BY_SYMBOL[symbol] ||
      !Number.isFinite(marginUnits) ||
      marginUnits <= 0 ||
      !Number.isFinite(priceSlippageBps) ||
      priceSlippageBps < 0 ||
      (side !== "long" && side !== "short")
    ) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Invalid request parameters",
        userMessage: "Invalid trade parameters.",
        tip: "Please check your inputs and try again.",
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
      requestChange: "increase",
    });

    /* ───────── Amounts ───────── */

    stageRef.stage = "amounts";
    const marginBn = new BN(marginUnits);
    const feeUnitsBn = marginBn.muln(BOOSTER_FEE_BPS).divn(10_000);
    const collateralBn = marginBn.sub(feeUnitsBn);

    if (feeUnitsBn.lten(0) || collateralBn.lten(0)) {
      return jsonError(400, {
        code: "FEE_OR_COLLATERAL_TOO_SMALL",
        error: "Trade amount too small",
        userMessage: "This trade is too small.",
        tip: "Try a larger amount.",
        stage: stageRef.stage,
      });
    }

    const { num: LEV_NUM, den: LEV_DEN } = leverageToFraction(leverage);
    const sizeUsdBn = collateralBn.muln(LEV_NUM).divn(LEV_DEN);

    /* ───────── Token Setup ───────── */

    stageRef.stage = "tokenSetup";
    const usdcProgramId = await detectTokenProgramId(USDC_MINT);

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      usdcProgramId
    );
    const treasuryUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      TREASURY_OWNER,
      false,
      usdcProgramId
    );
    const positionRequestAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      positionRequest,
      true,
      usdcProgramId
    );

    /* ───────── ✅ BATCHED RPC CALLS (Critical Optimization) ───────── */

    stageRef.stage = "batchedRpcCalls";

    const [
      balResp,
      positionInfo,
      positionReqInfo,
      userAtaInfo,
      treasuryAtaInfo,
      prAtaInfo,
      ownerLamportsBefore,
      havenLamports,
    ] = await Promise.all([
      RPC_CONNECTION.getTokenAccountBalance(userUsdcAta, "confirmed"),
      RPC_CONNECTION.getAccountInfo(position, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getAccountInfo(positionRequest, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getAccountInfo(userUsdcAta, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getAccountInfo(treasuryUsdcAta, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getAccountInfo(positionRequestAta, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getBalance(owner, PROCESSED_COMMITMENT),
      RPC_CONNECTION.getBalance(HAVEN_FEEPAYER, PROCESSED_COMMITMENT),
    ]);

    // USDC balance check
    const available = new BN(balResp?.value?.amount || "0");
    if (available.lt(marginBn)) {
      return jsonError(400, {
        code: "INSUFFICIENT_USDC",
        error: "Insufficient USDC balance",
        userMessage: "You don't have enough USDC.",
        tip: "Add more USDC or try a smaller amount.",
        stage: stageRef.stage,
      });
    }

    // Account existence
    const willCreatePosition = !positionInfo;
    const willCreatePositionReq = !positionReqInfo;
    const userAtaExists = !!userAtaInfo;
    const treasuryAtaExists = !!treasuryAtaInfo;
    const prAtaExists = !!prAtaInfo;

    /* ───────── SOL Top-up Math (Using Constants) ───────── */

    stageRef.stage = "solMath";

    // ✅ Using constant rent values (no RPC calls)
    const rentNeededPos = willCreatePosition ? RENT_POSITION : 0;
    const rentNeededReq = willCreatePositionReq ? RENT_REQUEST : 0;
    const predictedOwnerRentNeed = rentNeededPos + rentNeededReq;

    const requiredOwnerLamportsDuringTx = Math.max(
      JUP_MIN_WALLET_LAMPORTS,
      predictedOwnerRentNeed + KEEP_DUST_LAMPORTS
    );

    const targetOwnerLamports =
      requiredOwnerLamportsDuringTx + SAFE_SOL_BUFFER_LAMPORTS;

    const topUpLamports = Math.max(0, targetOwnerLamports - ownerLamportsBefore);

    // ✅ CRITICAL SAFETY CHECK - Hard limit on SOL top-up
    if (topUpLamports > ABSOLUTE_MAX_TOPUP) {
      return jsonError(400, {
        code: "TOPUP_EXCEEDS_LIMIT",
        error: `Top-up amount (${topUpLamports}) exceeds safety limit (${ABSOLUTE_MAX_TOPUP})`,
        userMessage: "Required SOL amount is too high.",
        tip: "This is a safety check. Please contact support if you believe this is an error.",
        stage: stageRef.stage,
        details: {
          topUpLamports,
          limit: ABSOLUTE_MAX_TOPUP,
          ownerBalance: ownerLamportsBefore,
        },
      });
    }

    // Haven SOL check
    stageRef.stage = "havenSolCheck";

    const missingAtaRent =
      (userAtaExists ? 0 : RENT_TOKEN_ACC) +
      (treasuryAtaExists ? 0 : RENT_TOKEN_ACC) +
      (prAtaExists ? 0 : RENT_TOKEN_ACC);

    const estimatedPriorityFeeLamports = Math.floor(
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
        error: "Haven fee-payer has insufficient SOL",
        userMessage: "Service temporarily unavailable.",
        tip: "Please try again in a few minutes.",
        stage: stageRef.stage,
      });
    }

    /* ───────── Build Instructions ───────── */

    stageRef.stage = "buildInstructions";
    const ixs: TransactionInstruction[] = [];

    // ✅ Optimized priority fee (increased for better success rate)
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_MICROLAMPORTS,
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT })
    );

    // Top-up SOL if needed
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
        treasuryUsdcAta,
        TREASURY_OWNER,
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

    // Jupiter perps instruction
    const sideArg: PerpsSideArg = side === "long" ? { long: {} } : { short: {} };

    const basePriceCap =
      MAX_PRICE_CAP_USD_1E6[symbol as "BTC" | "ETH" | "SOL"] ??
      new BN("1000000000000");

    const priceSlippageBn = basePriceCap
      .muln(10_000 + priceSlippageBps)
      .divn(10_000);

    const jupiterMinimumOut: BN | null = new BN(1);

    const data = encodeCreateIncreasePositionMarketRequest({
      sizeUsdDelta: sizeUsdBn,
      collateralDelta: collateralBn,
      side: sideArg,
      priceSlippage: priceSlippageBn,
      jupiterMinimumOut,
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
          { pubkey: JLP_POOL_ACCOUNT_PUBKEY, isSigner: false, isWritable: true },
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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

    // Haven fee transfer
    const feeUnits = feeUnitsBn.toNumber();
    if (feeUnits > 0) {
      ixs.push(
        createTransferCheckedInstruction(
          userUsdcAta,
          USDC_MINT,
          treasuryUsdcAta,
          owner,
          feeUnits,
          USDC_DECIMALS,
          [],
          usdcProgramId
        )
      );
    }

    /* ───────── Compile Transaction ───────── */

    stageRef.stage = "compile";

    const { blockhash, lastValidBlockHeight } =
      await RPC_CONNECTION.getLatestBlockhash(PROCESSED_COMMITMENT);

    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const unsignedTx = new VersionedTransaction(msg);
    const b64 = Buffer.from(unsignedTx.serialize()).toString("base64");

    const buildTime = Date.now() - startTime;
    console.log(`[OPEN] Built in ${buildTime}ms for ${symbol} ${side} ${leverage}x`);

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      meta: {
        symbol,
        side,
        leverage,
        marginUnits: marginBn.toString(),
        collateralUnits: collateralBn.toString(),
        sizeUsdUnits: sizeUsdBn.toString(),
        feeUnits: feeUnitsBn.toString(),
        position: position.toBase58(),
        positionRequest: positionRequest.toBase58(),
        requestCounter: counter.toString(),
        priceSlippageBps,
        custody: custody.toBase58(),
        collateralCustody: collateralCustody.toBase58(),

        // SOL info
        ownerLamportsBefore,
        topUpLamports,
        predictedOwnerRentNeed,
        keepDustLamports: KEEP_DUST_LAMPORTS,
        jupMinWalletLamports: JUP_MIN_WALLET_LAMPORTS,
        safeSolBufferLamports: SAFE_SOL_BUFFER_LAMPORTS,

        // Performance
        buildTimeMs: buildTime,
      },
    });
  } catch (e) {
    const buildTime = Date.now() - startTime;
    console.error(`[OPEN] Failed in ${buildTime}ms at ${stageRef.stage}:`, e);

    const msg =
      e instanceof Error && e.message === "INVALID_LEVERAGE"
        ? "Invalid leverage. Allowed: 1.5 or 2"
        : e instanceof Error
          ? e.message
          : String(e);

    const code =
      e instanceof Error && e.message === "INVALID_LEVERAGE"
        ? "INVALID_LEVERAGE"
        : "UNHANDLED_BOOSTER_OPEN_ERROR";

    return jsonError(500, {
      code,
      error: msg,
      userMessage: "Failed to build transaction.",
      tip: "Please try again. If it persists, contact support.",
      stage: stageRef.stage,
    });
  }
}