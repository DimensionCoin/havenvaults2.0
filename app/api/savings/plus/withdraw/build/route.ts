// app/api/savings/plus/withdraw/build/route.ts
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
const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);

/* ───────── MINTS ─────────
   USDC is standard Solana USDC mint. JupUSD mint is your vault asset mint.
*/
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const JUPUSD_MINT = new PublicKey(
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD"
);

/* ───────── Jupiter endpoints ───────── */

const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUP_SWAP_IXS = "https://api.jup.ag/swap/v1/swap-instructions";
const JUP_EARN_WITHDRAW_IX =
  "https://api.jup.ag/lend/v1/earn/withdraw-instructions";

/* ───────── Solana v0 size limit ───────── */

const MAX_TX_RAW_BYTES = 1232;

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

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

/* ───────── Helpers ───────── */

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
  console.error(
    "[/api/savings/plus/withdraw/build]",
    status,
    payload.code,
    payload.error
  );
  return NextResponse.json(payload, { status });
}

async function getTokenProgramId(conn: Connection, mint: PublicKey) {
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
  if (!info?.data || info.data.length < 45)
    throw new Error(`Invalid mint: ${key}`);
  const decimals = info.data[44];
  decimalsCache.set(key, decimals);
  return decimals;
}

async function getAltCached(conn: Connection, key: string) {
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
  if (priorityFeeCache && priorityFeeCache.expires > now)
    return priorityFeeCache.microLamports;

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

    priorityFeeCache = { microLamports, expires: now + PRIORITY_FEE_CACHE_TTL };
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

    const sorted = fees
      .sort((a, b) => b.slot - a.slot)
      .slice(0, 20)
      .map((f) => f.prioritizationFee)
      .filter((f) => f > 0);

    if (!sorted.length) return PRIORITY_FEE_CONFIG.MIN_MICRO_LAMPORTS;

    sorted.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
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

async function getOptimalPriorityFee(conn: Connection, accountKeys?: string[]) {
  if (HELIUS_API_KEY || RPC.includes("helius"))
    return getHeliusPriorityFee(accountKeys);
  return getRecentPriorityFee(conn);
}

function createComputeBudgetIxs(units: number, microLamportsPerCu: number) {
  const totalLamports = Math.floor((units * microLamportsPerCu) / 1_000_000);
  const cappedLamports = Math.min(
    totalLamports,
    PRIORITY_FEE_CONFIG.MAX_TOTAL_LAMPORTS
  );

  const effectiveMicroLamports =
    cappedLamports < totalLamports
      ? Math.floor((cappedLamports * 1_000_000) / units)
      : microLamportsPerCu;

  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: effectiveMicroLamports,
    }),
  ];
}

function filterComputeBudgetIxs(ixs: TransactionInstruction[]) {
  const COMPUTE_BUDGET_PROGRAM = new PublicKey(
    "ComputeBudget111111111111111111111111111111"
  );
  return ixs.filter((ix) => !ix.programId.equals(COMPUTE_BUDGET_PROGRAM));
}

function toIxFromJup(obj: unknown): TransactionInstruction {
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

/**
 * Jupiter swap setup instructions sometimes include ATA creates.
 * We rewrite those ATA creates so HAVEN_FEEPAYER pays for them.
 */
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
      amountUi?: string; // in USDC display units (we treat as JupUSD units too)
      amountUnits?: number; // optional direct base units
      slippageBps?: number;
      isMax?: boolean;
    } | null;

    const fromOwnerBase58 = body?.fromOwnerBase58?.trim() ?? "";
    const slippageBps = body?.slippageBps ?? 50;
    const isMax = Boolean(body?.isMax);

    if (!fromOwnerBase58) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Missing fromOwnerBase58",
        userMessage: "Something went wrong building this withdraw.",
        tip: "Please refresh and try again.",
        stage,
        traceId,
      });
    }

    const userOwner = new PublicKey(fromOwnerBase58);
    const conn = getConnection();

    stage = "tokenInfo";
    const [jupUsdProgId, usdcProgId, jupUsdDecimals] = await Promise.all([
      getTokenProgramId(conn, JUPUSD_MINT),
      getTokenProgramId(conn, USDC_MINT),
      getDecimals(conn, JUPUSD_MINT),
    ]);

    stage = "deriveATAs";
    const userJupUsdAta = getAssociatedTokenAddressSync(
      JUPUSD_MINT,
      userOwner,
      false,
      jupUsdProgId
    );
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      userOwner,
      false,
      usdcProgId
    );

    // Ensure both ATAs exist (fee payer sponsors)
    const ensureUserJupUsdAtaIx =
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userJupUsdAta,
        userOwner,
        JUPUSD_MINT,
        jupUsdProgId
      );

    const ensureUserUsdcAtaIx =
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userUsdcAta,
        userOwner,
        USDC_MINT,
        usdcProgId
      );

    stage = "amount";
    // Determine withdraw amount in JupUSD base units
    let amountUnits = 0;

    if (isMax) {
      // NOTE: getting “max withdrawable” precisely depends on user’s vault token balance;
      // for MVP we’ll treat max as full JupUSD ATA balance (usually works if deposits minted as JupUSD vault token),
      // but if Earn uses a separate share token, you should implement positions lookup and compute max.
      const bal = await conn
        .getTokenAccountBalance(userJupUsdAta, "confirmed")
        .catch(() => null);
      amountUnits = Number(bal?.value?.amount || "0");
      if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Zero JupUSD balance",
          userMessage: "You don't have any JupUSD to withdraw.",
          tip: "Try a smaller amount or deposit first.",
          stage,
          traceId,
        });
      }
    } else {
      if (typeof body?.amountUi === "string" && body.amountUi.trim()) {
        amountUnits = parseUiAmountToUnits(body.amountUi, jupUsdDecimals);
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
    }

    stage = "earnWithdrawInstruction";
    // Get Earn withdraw instruction (asset=JupUSD mint, signer=user pubkey, amount=base units)
    const earnIxRes = await jupFetch(JUP_EARN_WITHDRAW_IX, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: JUPUSD_MINT.toBase58(),
        signer: userOwner.toBase58(),
        amount: String(amountUnits),
      }),
    });

    if (!earnIxRes.ok) {
      return jsonError(earnIxRes.status, {
        code: "EARN_WITHDRAW_IX_FAILED",
        error: `earn withdraw-instructions failed: ${earnIxRes.status}`,
        userMessage: "Couldn't prepare this withdrawal right now.",
        tip: "Try again in a moment.",
        stage,
        traceId,
      });
    }

    const earnIxObj = (await earnIxRes.json()) as unknown;
    const earnWithdrawIx = toIxFromJup(earnIxObj);

    stage = "quoteAndPriorityFee";
    const quoteUrl =
      `${JUP_QUOTE}?` +
      new URLSearchParams({
        inputMint: JUPUSD_MINT.toBase58(),
        outputMint: USDC_MINT.toBase58(),
        amount: String(amountUnits),
        slippageBps: String(slippageBps),
      });

    const [quoteRes, blockhashData, priorityFeeMicroLamports] =
      await Promise.all([
        jupFetch(quoteUrl),
        conn.getLatestBlockhash("confirmed"),
        getOptimalPriorityFee(conn, [
          JUPUSD_MINT.toBase58(),
          USDC_MINT.toBase58(),
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
        prioritizationFeeLamports: 0, // we add our own compute budget
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

    const setupIxs = (swapData.setupInstructions ?? []).map(toIxFromJup);
    const { sponsoredAtaIxs, nonAtaSetupIxs } =
      rebuildAtaCreatesAsSponsored(setupIxs);
    const filteredNonAtaSetupIxs = filterComputeBudgetIxs(nonAtaSetupIxs);

    const swapIx = toIxFromJup(swapData.swapInstruction);
    const cleanupIxs = (swapData.cleanupInstructions ?? []).map(toIxFromJup);
    const filteredCleanupIxs = filterComputeBudgetIxs(cleanupIxs);

    // Compute budget sizing (withdraw ix + ensures)
    const baseComputeUnits = swapData.computeUnitLimit || 220_000;
    const additionalIxCount =
      1 + // earn withdraw ix
      2 + // ensure user ATAs
      sponsoredAtaIxs.length;
    const computeUnits = Math.min(
      baseComputeUnits + additionalIxCount * 30_000,
      1_400_000
    );

    const computeBudgetIxs = createComputeBudgetIxs(
      computeUnits,
      priorityFeeMicroLamports
    );

    // IMPORTANT ordering:
    // - ensure ATAs (so withdraw/swap can write)
    // - earn withdraw (user receives JupUSD)
    // - swap JupUSD -> USDC
    const ixs: TransactionInstruction[] = [
      ...computeBudgetIxs,
      ...sponsoredAtaIxs,
      ...filteredNonAtaSetupIxs,
      ensureUserJupUsdAtaIx,
      ensureUserUsdcAtaIx,
      earnWithdrawIx,
      swapIx,
      ...filteredCleanupIxs,
    ];

    stage = "compile";
    const { blockhash, lastValidBlockHeight } = blockhashData;

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: HAVEN_FEEPAYER,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message(altAccounts)
    );

    const rawLen = tx.serialize().length;
    if (rawLen > MAX_TX_RAW_BYTES) {
      return jsonError(413, {
        code: "TX_TOO_LARGE",
        error: `Raw size ${rawLen} > ${MAX_TX_RAW_BYTES}`,
        userMessage: "This withdraw route is too large. Try a smaller amount.",
        tip: "If this happens often, pre-create user ATAs for popular mints.",
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
      `[PLUS/WITHDRAW/BUILD] ${traceId} ${buildTime}ms JupUSD→USDC amount=${amountUnits} ` +
        `priorityFee=${cappedPriorityFeeLamports}lamports (${priorityFeeMicroLamports}µL/CU × ${computeUnits}CU)`
    );

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      traceId,

      // helpful UI/debug
      jupUsdWithdrawUnits: String(amountUnits),
      usdcOutEstimatedUnits: undefined, // (optional) you can parse quoteResponse.outAmount if you want
      slippageBps,
      computeUnits,
      priorityFeeMicroLamports,
      priorityFeeLamports: cappedPriorityFeeLamports,

      userJupUsdAta: userJupUsdAta.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[PLUS/WITHDRAW/BUILD] ${traceId} error at ${stage}:`, msg);
    return jsonError(500, {
      code: "UNHANDLED_BUILD_ERROR",
      error: msg,
      userMessage: "Couldn't build this withdrawal.",
      tip: "Please try again.",
      stage,
      traceId,
    });
  }
}
