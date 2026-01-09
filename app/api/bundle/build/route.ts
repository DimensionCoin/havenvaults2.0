// app/api/bundle/build/route.ts
// Dedicated bundle swap builder - optimized for reliability over speed
// - Lower priority fees (cheaper)
// - Single fee charge for entire bundle
// - Simpler routes (maxAccounts limited)

import { NextResponse } from "next/server";
import {
  AddressLookupTableAccount,
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
const HAVEN_FEEPAYER_STR = required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS");
const TREASURY_OWNER_STR = required("NEXT_PUBLIC_APP_TREASURY_OWNER");
const FEE_RATE_RAW = process.env.NEXT_PUBLIC_CRYPTO_SWAP_FEE_UI ?? "0.01";

const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);

const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ||
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const USDC_DECIMALS = 6;

const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUP_SWAP_IXS = "https://api.jup.ag/swap/v1/swap-instructions";

// Lower max to ensure transactions fit after signing
const MAX_ENCODED_LEN = 1400;

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

// Connection singleton
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
const altCache = new Map<
  string,
  { account: AddressLookupTableAccount; expires: number }
>();
const ALT_CACHE_TTL = 5 * 60 * 1000;

/* ───────── HELPERS ───────── */

function jsonError(status: number, payload: Record<string, unknown>) {
  console.error("[/api/bundle/build]", status, payload);
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

async function getAltCached(
  conn: Connection,
  key: string
): Promise<AddressLookupTableAccount | null> {
  const now = Date.now();
  const cached = altCache.get(key);
  if (cached && cached.expires > now) {
    return cached.account;
  }

  const { value } = await conn.getAddressLookupTable(new PublicKey(key));
  if (value) {
    altCache.set(key, { account: value, expires: now + ALT_CACHE_TTL });
  }
  return value;
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

  if (!pid || !dataStr || !keys) {
    throw new Error("Invalid Jupiter instruction shape");
  }

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

function feeBpsFromEnv(): number {
  const rate = Number(FEE_RATE_RAW);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(Math.min(rate, 0.2) * 10_000);
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

/* ───────── ROUTE ───────── */

export async function POST(req: Request) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();

  try {
    const body = (await req.json().catch(() => null)) as {
      fromOwnerBase58?: string;
      outputMint?: string;
      amountUsdcUnits?: number;
      slippageBps?: number;
      // If true, this is the first swap in the bundle - include fee transfer
      includeFee?: boolean;
      // Total bundle amount (for fee calculation on first swap)
      totalBundleUsdcUnits?: number;
    } | null;

    const fromOwnerBase58 = body?.fromOwnerBase58?.trim() ?? "";
    const outputMintStr = body?.outputMint?.trim() ?? "";
    const amountUsdcUnits = body?.amountUsdcUnits ?? 0;
    const slippageBps = body?.slippageBps ?? 150; // Higher slippage for reliability
    const includeFee = body?.includeFee ?? false;
    const totalBundleUsdcUnits = body?.totalBundleUsdcUnits ?? amountUsdcUnits;

    if (!fromOwnerBase58 || !outputMintStr || amountUsdcUnits <= 0) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Missing required fields",
        userMessage: "Invalid request",
        traceId,
      });
    }

    const conn = getConnection();
    const userOwner = new PublicKey(fromOwnerBase58);
    const outputMint = new PublicKey(outputMintStr);

    // Get token programs
    const [usdcProgId, outputProgId] = await Promise.all([
      getTokenProgramId(conn, USDC_MINT),
      getTokenProgramId(conn, outputMint),
    ]);

    // Get ATAs
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      userOwner,
      false,
      usdcProgId
    );
    const userOutputAta = getAssociatedTokenAddressSync(
      outputMint,
      userOwner,
      false,
      outputProgId
    );
    const treasuryUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      TREASURY_OWNER,
      false,
      usdcProgId
    );

    // Calculate fee (only on first swap of bundle)
    let feeUnits = 0;
    if (includeFee) {
      const feeBps = feeBpsFromEnv();
      feeUnits = Math.floor((totalBundleUsdcUnits * feeBps + 9999) / 10_000);
    }

    // Net amount for this swap
    const netUnits = amountUsdcUnits;

    // Check balance
    const balanceInfo = await conn
      .getTokenAccountBalance(userUsdcAta, "confirmed")
      .catch(() => null);
    const available = Number(balanceInfo?.value?.amount ?? 0);

    // Need enough for this swap + fee if first swap
    const totalNeeded = netUnits + feeUnits;
    if (available < totalNeeded) {
      return jsonError(400, {
        code: "INSUFFICIENT_BALANCE",
        error: `need=${totalNeeded}, have=${available}`,
        userMessage: "Insufficient USDC balance",
        traceId,
      });
    }

    /* ───────── Quote with simple routes ───────── */

    // Try progressively simpler routes
    const routeAttempts = [
      { maxAccounts: 30, directOnly: false },
      { maxAccounts: 20, directOnly: false },
      { maxAccounts: 15, directOnly: true },
    ];

    let quoteResponse: unknown = null;

    for (const attempt of routeAttempts) {
      const quoteUrl =
        `${JUP_QUOTE}?` +
        new URLSearchParams({
          inputMint: USDC_MINT.toBase58(),
          outputMint: outputMint.toBase58(),
          amount: String(netUnits),
          slippageBps: String(slippageBps),
          maxAccounts: String(attempt.maxAccounts),
          onlyDirectRoutes: attempt.directOnly ? "true" : "false",
        });

      const quoteRes = await jupFetch(quoteUrl);

      if (quoteRes.ok) {
        quoteResponse = await quoteRes.json();
        console.log(
          `[BUNDLE/BUILD] ${traceId} route: maxAccounts=${attempt.maxAccounts} direct=${attempt.directOnly}`
        );
        break;
      }

      // If direct routes don't work, give up
      if (attempt.directOnly) {
        return jsonError(400, {
          code: "NO_ROUTE",
          error: "No route found",
          userMessage: "No swap route available for this token",
          traceId,
        });
      }
    }

    if (!quoteResponse) {
      return jsonError(400, {
        code: "NO_ROUTE",
        error: "All route attempts failed",
        userMessage: "Couldn't find a swap route",
        traceId,
      });
    }

    /* ───────── Swap instructions with LOW priority ───────── */

    const swapIxRes = await jupFetch(JUP_SWAP_IXS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userOwner.toBase58(),
        wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: true,
        // LOW priority fees - save money, slightly slower
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 100_000, // 0.0001 SOL max (was 1_000_000)
            priorityLevel: "medium", // was "veryHigh"
          },
        },
      }),
    });

    if (!swapIxRes.ok) {
      return jsonError(500, {
        code: "SWAP_IX_FAILED",
        error: `swap-instructions failed: ${swapIxRes.status}`,
        userMessage: "Couldn't prepare swap",
        traceId,
      });
    }

    const swapData = (await swapIxRes.json()) as {
      setupInstructions?: unknown[];
      swapInstruction?: unknown;
      cleanupInstructions?: unknown[];
      addressLookupTableAddresses?: string[];
    };

    if (!swapData.swapInstruction) {
      return jsonError(500, {
        code: "NO_SWAP_IX",
        error: "No swap instruction returned",
        userMessage: "Couldn't build swap",
        traceId,
      });
    }

    /* ───────── Load ALTs ───────── */

    const altKeys = swapData.addressLookupTableAddresses ?? [];
    const altAccounts = (
      await Promise.all(altKeys.map((k) => getAltCached(conn, k)))
    ).filter((a): a is AddressLookupTableAccount => a !== null);

    /* ───────── Build transaction ───────── */

    const setupIxs = (swapData.setupInstructions ?? []).map(toIx);
    const { sponsoredAtaIxs, nonAtaSetupIxs } =
      rebuildAtaCreatesAsSponsored(setupIxs);

    // ATA creation instructions (sponsored by feepayer)
    const ataIxs = [
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userUsdcAta,
        userOwner,
        USDC_MINT,
        usdcProgId
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userOutputAta,
        userOwner,
        outputMint,
        outputProgId
      ),
    ];

    // Fee transfer (only on first swap)
    const feeIx =
      feeUnits > 0
        ? [
            createAssociatedTokenAccountIdempotentInstruction(
              HAVEN_FEEPAYER,
              treasuryUsdcAta,
              TREASURY_OWNER,
              USDC_MINT,
              usdcProgId
            ),
            createTransferCheckedInstruction(
              userUsdcAta,
              USDC_MINT,
              treasuryUsdcAta,
              userOwner,
              feeUnits,
              USDC_DECIMALS,
              [],
              usdcProgId
            ),
          ]
        : [];

    const cleanupIxs = (swapData.cleanupInstructions ?? []).map(toIx);

    // Combine all instructions
    const allIxs = [
      ...ataIxs,
      ...sponsoredAtaIxs,
      ...nonAtaSetupIxs,
      ...feeIx,
      toIx(swapData.swapInstruction),
      ...cleanupIxs,
    ];

    /* ───────── Compile ───────── */

    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: HAVEN_FEEPAYER,
        recentBlockhash: blockhash,
        instructions: allIxs,
      }).compileToV0Message(altAccounts)
    );

    const encodedLen = tx.serialize().length;

    if (encodedLen > MAX_ENCODED_LEN) {
      return jsonError(413, {
        code: "TX_TOO_LARGE",
        error: `Size ${encodedLen} > ${MAX_ENCODED_LEN}`,
        userMessage: "This swap route is too complex. Try a different token.",
        traceId,
      });
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    const buildTime = Date.now() - startTime;

    console.log(
      `[BUNDLE/BUILD] ${traceId} ${buildTime}ms USDC→${outputMintStr.slice(0, 8)} ` +
        `amt=${netUnits} fee=${feeUnits} size=${encodedLen}`
    );

    return NextResponse.json({
      transaction: b64,
      blockhash,
      lastValidBlockHeight,
      traceId,
      outputMint: outputMintStr,
      amountUsdcUnits: netUnits,
      feeUnits,
      encodedSize: encodedLen,
      buildTimeMs: buildTime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[BUNDLE/BUILD] ${traceId} error:`, msg);
    return jsonError(500, {
      code: "BUILD_ERROR",
      error: msg,
      userMessage: "Couldn't build swap",
      traceId,
    });
  }
}
