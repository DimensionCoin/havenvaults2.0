// app/api/jup/build/route.ts
import { NextResponse } from "next/server";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { Buffer } from "buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── ENV ───────── */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const JUP_API_KEY = required("JUP_API_KEY");
const HELIUS_API_KEY = process.env.HELIUS_API_KEY; // optional
const HAVEN_FEEPAYER_STR = required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS");
const TREASURY_OWNER_STR = required("NEXT_PUBLIC_APP_TREASURY_OWNER");
const FEE_RATE_RAW = process.env.NEXT_PUBLIC_CRYPTO_SWAP_FEE_UI ?? "0.01";

const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);

const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUP_SWAP_IXS = "https://api.jup.ag/swap/v1/swap-instructions";

// Solana v0 raw tx size limit (bytes)
const MAX_TX_RAW_BYTES = 1232;

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/* ───────── Priority Fee Config ───────── */

const PRIORITY_FEE_CONFIG = {
  MIN_MICRO_LAMPORTS: 1,
  FALLBACK_MICRO_LAMPORTS: 10_000,
  MAX_MICRO_LAMPORTS: 500_000,
  MAX_TOTAL_LAMPORTS: 100_000,
  PRIORITY_LEVEL: "Medium" as const,
};

/* ───────── Singletons ───────── */

let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(RPC, {
      commitment: "confirmed",
      disableRetryOnRateLimit: false,
    });
  }
  return _conn;
}

/* ───────── CACHES ───────── */

const tokenProgramCache = new Map<string, PublicKey>();
const decimalsCache = new Map<string, number>();
const altCache = new Map<
  string,
  { account: AddressLookupTableAccount; expires: number }
>();
const ALT_CACHE_TTL = 5 * 60 * 1000;

let priorityFeeCache: { microLamports: number; expires: number } | null = null;
const PRIORITY_FEE_CACHE_TTL = 10_000;

/* ───────── HELPERS ───────── */

function jsonError(
  status: number,
  payload: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    stage?: string;
    traceId?: string;
  }
) {
  console.error("[/api/jup/build]", status, payload.code, payload.error);
  return NextResponse.json(payload, { status });
}

async function getTokenProgramId(
  conn: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const key = mint.toBase58();
  const cached = tokenProgramCache.get(key);
  if (cached) return cached;

  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found: ${key}`);

  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  tokenProgramCache.set(key, programId);
  return programId;
}

async function getDecimals(conn: Connection, mint: PublicKey): Promise<number> {
  const key = mint.toBase58();
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info?.data || info.data.length < 45) {
    throw new Error(`Invalid mint account: ${key}`);
  }
  const decimals = info.data[44];
  decimalsCache.set(key, decimals);
  return decimals;
}

async function getAltCached(
  conn: Connection,
  key: string
): Promise<AddressLookupTableAccount | null> {
  const now = Date.now();
  const cached = altCache.get(key);
  if (cached && cached.expires > now) return cached.account;

  const { value } = await conn.getAddressLookupTable(new PublicKey(key));
  if (value)
    altCache.set(key, { account: value, expires: now + ALT_CACHE_TTL });
  return value;
}

async function getHeliusPriorityFee(accountKeys?: string[]): Promise<number> {
  const now = Date.now();
  if (priorityFeeCache && priorityFeeCache.expires > now) {
    return priorityFeeCache.microLamports;
  }

  try {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "helius-priority-fee",
        method: "getPriorityFeeEstimate",
        params: [
          {
            ...(accountKeys?.length ? { accountKeys } : {}),
            options: {
              includeAllPriorityFeeLevels: true,
              recommended: true,
              evaluateEmptySlotAsZero: true,
            },
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`Helius API returned ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "Helius API error");

    const result = data.result;
    let microLamports: number;

    if (typeof result?.priorityFeeEstimate === "number") {
      microLamports = result.priorityFeeEstimate;
    } else if (result?.priorityFeeLevels) {
      const levels = result.priorityFeeLevels;
      const levelKey = PRIORITY_FEE_CONFIG.PRIORITY_LEVEL.toLowerCase();
      microLamports =
        levels[levelKey] ??
        levels.medium ??
        PRIORITY_FEE_CONFIG.FALLBACK_MICRO_LAMPORTS;
    } else {
      throw new Error("Unexpected Helius response format");
    }

    microLamports = Math.max(
      PRIORITY_FEE_CONFIG.MIN_MICRO_LAMPORTS,
      Math.min(
        PRIORITY_FEE_CONFIG.MAX_MICRO_LAMPORTS,
        Math.floor(microLamports)
      )
    );

    priorityFeeCache = {
      microLamports,
      expires: now + PRIORITY_FEE_CACHE_TTL,
    };

    return microLamports;
  } catch (err) {
    console.warn("[PriorityFee] Helius failed, using fallback:", err);
    return PRIORITY_FEE_CONFIG.FALLBACK_MICRO_LAMPORTS;
  }
}

async function getRecentPriorityFee(conn: Connection): Promise<number> {
  try {
    const fees = await conn.getRecentPrioritizationFees();
    if (!fees.length) return PRIORITY_FEE_CONFIG.FALLBACK_MICRO_LAMPORTS;

    const sortedFees = fees
      .sort((a, b) => b.slot - a.slot)
      .slice(0, 20)
      .map((f) => f.prioritizationFee)
      .filter((f) => f > 0);

    if (!sortedFees.length) return PRIORITY_FEE_CONFIG.MIN_MICRO_LAMPORTS;

    sortedFees.sort((a, b) => a - b);
    const median = sortedFees[Math.floor(sortedFees.length / 2)];
    const withBuffer = Math.ceil(median * 1.1);

    return Math.max(
      PRIORITY_FEE_CONFIG.MIN_MICRO_LAMPORTS,
      Math.min(PRIORITY_FEE_CONFIG.MAX_MICRO_LAMPORTS, withBuffer)
    );
  } catch (err) {
    console.warn("[PriorityFee] getRecentPrioritizationFees failed:", err);
    return PRIORITY_FEE_CONFIG.FALLBACK_MICRO_LAMPORTS;
  }
}

async function getOptimalPriorityFee(
  conn: Connection,
  accountKeys?: string[]
): Promise<number> {
  if (HELIUS_API_KEY || RPC.includes("helius")) {
    return getHeliusPriorityFee(accountKeys);
  }
  return getRecentPriorityFee(conn);
}

function toIx(obj: unknown): TransactionInstruction {
  const rec = obj as Record<string, unknown>;
  const pid = rec.programId as string;
  const dataStr = rec.data as string;
  const keys = (rec.keys ?? rec.accounts) as Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;

  if (!pid || !dataStr || !keys) throw new Error("Invalid Jupiter instruction");

  return new TransactionInstruction({
    programId: new PublicKey(pid),
    keys: keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: Boolean(k.isSigner),
      isWritable: Boolean(k.isWritable),
    })),
    data: Buffer.from(dataStr, "base64"),
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function feeBpsFromEnv(): number {
  const rate = Number(FEE_RATE_RAW);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(clamp(rate, 0, 0.2) * 10_000);
}

function computeFeeUnits(amountUnits: number) {
  const bps = feeBpsFromEnv();
  if (!Number.isFinite(amountUnits) || amountUnits <= 0 || bps <= 0) {
    return { feeUnits: 0, feeBps: 0, feeRate: 0 };
  }
  // ceil(amount * bps / 10_000)
  const feeUnits = Math.floor((amountUnits * bps + 9999) / 10_000);
  return { feeUnits, feeBps: bps, feeRate: bps / 10_000 };
}

async function jupFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.headers || {}),
      "x-api-key": JUP_API_KEY,
    },
  });
}

function rebuildAtaCreatesAsSponsored(setupIxs: TransactionInstruction[]) {
  const sponsored: TransactionInstruction[] = [];
  const nonAta: TransactionInstruction[] = [];
  const seen = new Set<string>();

  for (const ix of setupIxs) {
    if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      nonAta.push(ix);
      continue;
    }

    const keys = ix.keys;
    const ata = keys[1]?.pubkey;
    const owner = keys[2]?.pubkey;
    const mint = keys[3]?.pubkey;
    const tokenProgram = keys[5]?.pubkey ?? TOKEN_PROGRAM_ID;

    if (!ata || !owner || !mint) continue;

    const dedupeKey = `${ata.toBase58()}|${mint.toBase58()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    sponsored.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        ata,
        owner,
        mint,
        tokenProgram
      )
    );
  }

  return { sponsoredAtaIxs: sponsored, nonAtaSetupIxs: nonAta };
}

function filterComputeBudgetIxs(ixs: TransactionInstruction[]) {
  const COMPUTE_BUDGET_PROGRAM = new PublicKey(
    "ComputeBudget111111111111111111111111111111"
  );
  return ixs.filter((ix) => !ix.programId.equals(COMPUTE_BUDGET_PROGRAM));
}

function createComputeBudgetIxs(
  computeUnits: number,
  microLamportsPerCu: number
): TransactionInstruction[] {
  const totalLamports = Math.floor(
    (computeUnits * microLamportsPerCu) / 1_000_000
  );
  const cappedLamports = Math.min(
    totalLamports,
    PRIORITY_FEE_CONFIG.MAX_TOTAL_LAMPORTS
  );

  const effectiveMicroLamports =
    cappedLamports < totalLamports
      ? Math.floor((cappedLamports * 1_000_000) / computeUnits)
      : microLamportsPerCu;

  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: effectiveMicroLamports,
    }),
  ];
}

function parseUiAmountToUnits(amountUi: string, decimals: number): number {
  const s = (amountUi ?? "").trim().replace(/,/g, "");
  if (!s) return 0;

  const [wRaw, fRaw = ""] = s.split(".");
  const whole = wRaw.replace(/\D/g, "");
  const frac = fRaw.replace(/\D/g, "");
  if (!whole && !frac) return 0;

  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const unitsStr = (whole || "0") + fracPadded;
  const units = Number(unitsStr);

  if (!Number.isFinite(units) || units > Number.MAX_SAFE_INTEGER) {
    throw new Error("Amount is too large.");
  }
  return units;
}

/* ───────── ROUTE ───────── */

export async function POST(req: Request) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();
  let stage = "init";

  try {
    stage = "parseBody";
    const body = (await req.json().catch(() => null)) as {
      fromOwnerBase58?: string;
      inputMint?: string;
      outputMint?: string;
      amountUnits?: number;
      amountUi?: string;
      slippageBps?: number;
      isMax?: boolean;
    } | null;

    const fromOwnerBase58 = body?.fromOwnerBase58?.trim() ?? "";
    const inputMintStr = body?.inputMint?.trim() ?? "";
    const outputMintStr = body?.outputMint?.trim() ?? "";
    const slippageBps = body?.slippageBps ?? 50;
    const isMax = Boolean(body?.isMax);

    if (!fromOwnerBase58 || !inputMintStr || !outputMintStr) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Missing required fields",
        userMessage: "Something went wrong building this swap.",
        tip: "Please refresh and try again.",
        stage,
        traceId,
      });
    }

    const userOwner = new PublicKey(fromOwnerBase58);
    const inputMint = new PublicKey(inputMintStr);
    const outputMint = new PublicKey(outputMintStr);

    if (inputMint.equals(outputMint)) {
      return jsonError(400, {
        code: "SAME_TOKEN",
        error: "Input equals output",
        userMessage: "Choose two different assets.",
        tip: "Pick another asset to receive.",
        stage,
        traceId,
      });
    }

    const conn = getConnection();

    stage = "tokenInfo";
    const [inputProgId, outputProgId, inputDecimals] = await Promise.all([
      getTokenProgramId(conn, inputMint),
      getTokenProgramId(conn, outputMint),
      getDecimals(conn, inputMint),
    ]);

    stage = "deriveATAs";
    const userInputAta = getAssociatedTokenAddressSync(
      inputMint,
      userOwner,
      false,
      inputProgId
    );

    const userOutputAta = getAssociatedTokenAddressSync(
      outputMint,
      userOwner,
      false,
      outputProgId
    );

    const treasuryInputAta = getAssociatedTokenAddressSync(
      inputMint,
      TREASURY_OWNER,
      false,
      inputProgId
    );

    stage = "amount";
    const balResp = await conn
      .getTokenAccountBalance(userInputAta, "confirmed")
      .catch(() => null);
    const available = Number(balResp?.value?.amount || "0");

    let amountUnits = 0;

    if (isMax) {
      if (available <= 0) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Zero balance",
          userMessage: "You don't have any balance to swap.",
          tip: "Deposit funds first.",
          stage,
          traceId,
        });
      }
      amountUnits = available;
    } else {
      if (typeof body?.amountUi === "string" && body.amountUi.trim()) {
        amountUnits = parseUiAmountToUnits(body.amountUi, inputDecimals);
      } else {
        amountUnits = Number(body?.amountUnits ?? 0);
      }

      if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
        return jsonError(400, {
          code: "INVALID_AMOUNT",
          error: "Amount must be > 0",
          userMessage: "Please enter an amount.",
          tip: "Try again.",
          stage,
          traceId,
        });
      }

      if (available < amountUnits) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: `need=${amountUnits}, have=${available}`,
          userMessage: "You don't have enough balance.",
          tip: "Try a smaller amount.",
          stage,
          traceId,
        });
      }
    }

    stage = "fee";
    const { feeUnits, feeBps, feeRate } = computeFeeUnits(amountUnits);
    const netUnits = Math.max(amountUnits - feeUnits, 0);

    if (feeUnits > 0 && netUnits <= 0) {
      return jsonError(400, {
        code: "AMOUNT_TOO_SMALL",
        error: `gross=${amountUnits} fee=${feeUnits}`,
        userMessage: "Amount is too small to cover the fee.",
        tip: "Try a larger amount.",
        stage,
        traceId,
      });
    }

    stage = "quoteAndPriorityFee";
    const quoteUrl =
      `${JUP_QUOTE}?` +
      new URLSearchParams({
        inputMint: inputMint.toBase58(),
        outputMint: outputMint.toBase58(),
        amount: String(netUnits), // ✅ swap uses net (after fee)
        slippageBps: String(slippageBps),
      });

    const [quoteRes, blockhashData, priorityFeeMicroLamports] =
      await Promise.all([
        jupFetch(quoteUrl),
        conn.getLatestBlockhash("confirmed"),
        getOptimalPriorityFee(conn, [
          inputMint.toBase58(),
          outputMint.toBase58(),
          userOwner.toBase58(),
        ]),
      ]);

    if (!quoteRes.ok) {
      return jsonError(quoteRes.status, {
        code: "JUP_QUOTE_FAILED",
        error: `Quote failed: ${quoteRes.status}`,
        userMessage: "Couldn't price this swap right now.",
        tip: "Try again in a moment.",
        stage,
        traceId,
      });
    }

    const quoteResponse = await quoteRes.json();

    stage = "swapInstructions";
    const swapIxRes = await jupFetch(JUP_SWAP_IXS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userOwner.toBase58(),
        wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 0, // ✅ we add our own compute budget ixs
      }),
    });

    if (!swapIxRes.ok) {
      return jsonError(swapIxRes.status, {
        code: "JUP_SWAP_IX_FAILED",
        error: `swap-instructions failed: ${swapIxRes.status}`,
        userMessage: "Couldn't prepare this swap.",
        tip: "Try again in a moment.",
        stage,
        traceId,
      });
    }

    const swapData = (await swapIxRes.json()) as {
      setupInstructions?: unknown[];
      swapInstruction?: unknown;
      cleanupInstructions?: unknown[];
      addressLookupTableAddresses?: string[];
      computeUnitLimit?: number;
    };

    if (!swapData.swapInstruction) {
      return jsonError(500, {
        code: "NO_SWAP_IX",
        error: "Jupiter returned no swapInstruction",
        userMessage: "Couldn't build this route.",
        tip: "Try a different amount.",
        stage,
        traceId,
      });
    }

    stage = "loadALTs";
    const altKeys = swapData.addressLookupTableAddresses ?? [];
    const altAccounts = (
      await Promise.all(altKeys.map((k) => getAltCached(conn, k)))
    ).filter((a): a is AddressLookupTableAccount => a !== null);

    stage = "buildInstructions";

    // Jupiter setup rewritten as sponsored ATAs (payer = HAVEN_FEEPAYER)
    const setupIxs = (swapData.setupInstructions ?? []).map(toIx);
    const { sponsoredAtaIxs, nonAtaSetupIxs } =
      rebuildAtaCreatesAsSponsored(setupIxs);

    const filteredNonAtaSetupIxs = filterComputeBudgetIxs(nonAtaSetupIxs);

    // Ensure treasury ATA exists for fee mint (payer = HAVEN_FEEPAYER)
    const treasuryAtaCreateIx =
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        treasuryInputAta,
        TREASURY_OWNER,
        inputMint,
        inputProgId
      );

    // Transfer fee from user -> treasury (user signs; fee payer pays SOL)
    const feeIx =
      feeUnits > 0
        ? createTransferCheckedInstruction(
            userInputAta,
            inputMint,
            treasuryInputAta,
            userOwner,
            feeUnits,
            inputDecimals,
            [],
            inputProgId
          )
        : null;

    const swapIx = toIx(swapData.swapInstruction);

    const cleanupIxs = (swapData.cleanupInstructions ?? []).map(toIx);
    const filteredCleanupIxs = filterComputeBudgetIxs(cleanupIxs);

    // Compute budget sizing
    const baseComputeUnits = swapData.computeUnitLimit || 200_000;
    const additionalIxCount = sponsoredAtaIxs.length + 1 + (feeIx ? 1 : 0); // treasury ATA + fee ix
    const computeUnits = Math.min(
      baseComputeUnits + additionalIxCount * 30_000,
      1_400_000
    );

    const computeBudgetIxs = createComputeBudgetIxs(
      computeUnits,
      priorityFeeMicroLamports
    );

    // ✅ Final instruction order
    const ixs: TransactionInstruction[] = [
      ...computeBudgetIxs,
      ...sponsoredAtaIxs,
      ...filteredNonAtaSetupIxs,
      treasuryAtaCreateIx,
      ...(feeIx ? [feeIx] : []),
      swapIx,
      ...filteredCleanupIxs,
    ];

    stage = "compile";
    const { blockhash, lastValidBlockHeight } = blockhashData;

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: HAVEN_FEEPAYER, // ✅ Haven pays SOL
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message(altAccounts)
    );

    const rawLen = tx.serialize().length;
    if (rawLen > MAX_TX_RAW_BYTES) {
      return jsonError(413, {
        code: "TX_TOO_LARGE",
        error: `Raw size ${rawLen} > ${MAX_TX_RAW_BYTES}`,
        userMessage:
          "This swap route is too large. Try a smaller amount or a different pair.",
        tip: "If this happens often, pre-create treasury ATAs for popular mints.",
        stage,
        traceId,
      });
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    const buildTime = Date.now() - startTime;

    const priorityFeeLamports = Math.floor(
      (computeUnits * priorityFeeMicroLamports) / 1_000_000
    );
    const cappedPriorityFeeLamports = Math.min(
      priorityFeeLamports,
      PRIORITY_FEE_CONFIG.MAX_TOTAL_LAMPORTS
    );

    console.log(
      `[JUP/BUILD] ${traceId} ${buildTime}ms ${inputMintStr.slice(0, 8)}→${outputMintStr.slice(0, 8)} ` +
        `gross=${amountUnits} fee=${feeUnits} net=${netUnits} ` +
        `priorityFee=${cappedPriorityFeeLamports}lamports (${priorityFeeMicroLamports}µL/CU × ${computeUnits}CU)`
    );

    // IMPORTANT:
    // - These fee fields are "expected fee" for UI only.
    // - Your /api/jup/send route should compute the ACTUAL fee received by treasury from tx meta and record to DB.
    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      traceId,

      // Expected fee (UI only)
      expectedFeeUnits: feeUnits,
      expectedFeeBps: feeBps,
      expectedFeeRate: feeRate,
      feeMint: inputMint.toBase58(),
      feeDecimals: inputDecimals,

      // Priority fee info
      priorityFeeMicroLamports,
      priorityFeeLamports: cappedPriorityFeeLamports,
      computeUnits,

      // Swap sizing
      grossInUnits: amountUnits,
      netInUnits: netUnits,
      isMax,
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
      buildTimeMs: buildTime,

      // Audit info
      treasuryOwner: TREASURY_OWNER.toBase58(),
      treasuryFeeAta: treasuryInputAta.toBase58(),
      userInputAta: userInputAta.toBase58(),
      userOutputAta: userOutputAta.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[JUP/BUILD] ${traceId} error at ${stage}:`, msg);
    return jsonError(500, {
      code: "UNHANDLED_BUILD_ERROR",
      error: msg,
      userMessage: "Couldn't build this swap.",
      tip: "Please try again.",
      stage,
      traceId,
    });
  }
}
