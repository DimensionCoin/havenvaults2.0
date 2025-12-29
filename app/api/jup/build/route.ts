// app/api/jup/build/route.ts
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
  getMint,
} from "@solana/spl-token";

export const runtime = "nodejs";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const JUP_API_KEY = required("JUP_API_KEY");

const HAVEN_FEEPAYER = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);
const TREASURY_OWNER = new PublicKey(
  required("NEXT_PUBLIC_APP_TREASURY_OWNER")
);

const FEE_RATE_RAW = process.env.NEXT_PUBLIC_CRYPTO_SWAP_FEE_UI ?? "0.01";

const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUP_SWAP_IXS = "https://api.jup.ag/swap/v1/swap-instructions";

const MAX_ENCODED_LEN = 1644;

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

function jsonError(
  status: number,
  payload: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    stage?: string;
    traceId?: string;
    details?: unknown;
  }
) {
  console.error("[/api/jup/build] error", status, payload);
  return NextResponse.json(payload, { status });
}

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found on chain: ${mint.toBase58()}`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

function toIx(obj: unknown): TransactionInstruction {
  const rec = (obj ?? {}) as Record<string, unknown>;
  const pid = rec.programId;
  const dataStr = rec.data;
  const listUnknown = Array.isArray(rec.keys)
    ? (rec.keys as unknown[])
    : Array.isArray(rec.accounts)
    ? (rec.accounts as unknown[])
    : null;

  if (typeof pid !== "string" || typeof dataStr !== "string" || !listUnknown)
    throw new Error("Unexpected Jupiter instruction shape");

  const keys = listUnknown.map((k) => {
    const r = (k ?? {}) as Record<string, unknown>;
    return {
      pubkey: new PublicKey(String(r.pubkey)),
      isSigner: Boolean(r.isSigner),
      isWritable: Boolean(r.isWritable),
    };
  });

  return new TransactionInstruction({
    programId: new PublicKey(pid),
    keys,
    data: Buffer.from(String(dataStr), "base64"),
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function feeBpsFromEnv(): number {
  const rate = Number(FEE_RATE_RAW);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const clamped = clamp(rate, 0, 0.2);
  return Math.round(clamped * 10_000);
}

function ceilMulDiv(amount: number, mul: number, div: number) {
  return Math.floor((amount * mul + (div - 1)) / div);
}

function computeFeeUnits(amountUnits: number) {
  const bps = feeBpsFromEnv();
  if (!Number.isFinite(amountUnits) || amountUnits <= 0 || bps <= 0) {
    return { feeUnits: 0, feeBps: 0, feeRate: 0 };
  }
  const feeUnits = ceilMulDiv(amountUnits, bps, 10_000);
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

/** Replace Jupiter ATA creates with payer=HAVEN_FEEPAYER */
function rebuildAtaCreatesAsSponsored(setupIxs: TransactionInstruction[]) {
  const sponsored: TransactionInstruction[] = [];
  const nonAta: TransactionInstruction[] = [];
  const seen = new Set<string>();

  for (const ix of setupIxs) {
    if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      nonAta.push(ix);
      continue;
    }

    const keys = ix.keys ?? [];
    const ata = keys[1]?.pubkey;
    const owner = keys[2]?.pubkey;
    const mint = keys[3]?.pubkey;
    const tokenProgram = keys[5]?.pubkey ?? TOKEN_PROGRAM_ID;

    if (!ata || !owner || !mint) continue;

    const dedupeKey = `${ata.toBase58()}|${owner.toBase58()}|${mint.toBase58()}|${tokenProgram.toBase58()}`;
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

/** Parse "12.34" into base units using decimals (safe, avoids float drift). */
function parseUiAmountToUnits(amountUi: string, decimals: number): number {
  const s = (amountUi ?? "").trim().replace(/,/g, "");
  if (!s) return 0;

  const [wRaw, fRaw = ""] = s.split(".");
  const whole = wRaw.replace(/[^\d]/g, "");
  const frac = fRaw.replace(/[^\d]/g, "");

  if (!whole && !frac) return 0;

  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const unitsStr = (whole || "0") + fracPadded;
  const unitsBig = BigInt(unitsStr || "0");

  if (unitsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is too large.");
  }
  return Number(unitsBig);
}

export async function POST(req: Request) {
  const traceId = Math.random().toString(36).slice(2, 10);
  let stage = "init";

  try {
    stage = "envCheck";
    if (!RPC?.includes("mainnet")) {
      return jsonError(500, {
        code: "NON_MAINNET_RPC",
        error: "RPC must be mainnet",
        userMessage: "Something's misconfigured on our side.",
        tip: "Please try again later.",
        stage,
        traceId,
      });
    }

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

    const fromOwnerBase58 = body?.fromOwnerBase58 ?? "";
    const inputMintStr = body?.inputMint ?? "";
    const outputMintStr = body?.outputMint ?? "";
    const slippageBps = body?.slippageBps ?? 50;
    const isMax = Boolean(body?.isMax);

    if (!fromOwnerBase58 || !inputMintStr || !outputMintStr) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Need fromOwnerBase58, inputMint, outputMint",
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
        error: "inputMint equals outputMint",
        userMessage: "Choose two different assets.",
        tip: "Pick another asset to receive.",
        stage,
        traceId,
      });
    }

    const conn = new Connection(RPC, "confirmed");

    stage = "detectTokenPrograms";
    const inputProgId = await detectTokenProgramId(conn, inputMint);
    const outputProgId = await detectTokenProgramId(conn, outputMint);

    // decimals for input fee transfer + ui conversion
    const inputMintInfo = await getMint(
      conn,
      inputMint,
      "confirmed",
      inputProgId
    );
    const inputDecimals = inputMintInfo.decimals;

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

    // -----------------------------
    // Amount: WSOL is treated as SPL token ONLY.
    // No native SOL fallback / wrapping.
    // -----------------------------
    stage = "amount";
    let amountUnits = 0;

    const bal = await conn
      .getTokenAccountBalance(userInputAta, "confirmed")
      .catch(() => null);
    const available = Number(bal?.value?.amount || "0");

    if (isMax) {
      if (available <= 0) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Token balance is zero",
          userMessage: "You don’t have enough balance to swap.",
          tip: "Try a smaller amount or deposit funds.",
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
          error: `need=${amountUnits}, available=${available}`,
          userMessage: "You don’t have enough balance for that amount.",
          tip: "Try a smaller amount.",
          stage,
          traceId,
        });
      }
    }

    // Fee is ALWAYS in the input token (including WSOL as SPL token)
    stage = "fee";
    const { feeUnits, feeBps, feeRate } = computeFeeUnits(amountUnits);
    const netUnits = Math.max(amountUnits - feeUnits, 0);

    if (feeUnits > 0 && netUnits <= 0) {
      return jsonError(400, {
        code: "AMOUNT_TOO_SMALL_FOR_FEE",
        error: `gross=${amountUnits} fee=${feeUnits}`,
        userMessage: "This amount is too small to cover the fee.",
        tip: "Try a slightly larger amount.",
        stage,
        traceId,
      });
    }

    // QUOTE on netUnits (so fee stays aside)
    stage = "quote";
    const qUrl =
      `${JUP_QUOTE}?` +
      new URLSearchParams({
        inputMint: inputMint.toBase58(),
        outputMint: outputMint.toBase58(),
        amount: String(netUnits),
        slippageBps: String(slippageBps),
      });

    const qRes = await jupFetch(qUrl);
    const qText = await qRes.text().catch(() => "");
    if (!qRes.ok) {
      return jsonError(qRes.status, {
        code: "JUP_QUOTE_FAILED",
        error: `Quote failed: ${qRes.status} ${qText}`,
        userMessage: "We couldn’t price this swap right now.",
        tip: "Try again in a moment or reduce the amount.",
        stage,
        traceId,
      });
    }

    const quoteResponse = qText ? JSON.parse(qText) : {};

    // SWAP instructions
    stage = "swapInstructions";
    const swapIxRes = await jupFetch(JUP_SWAP_IXS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userOwner.toBase58(),

        // ✅ CRITICAL: prevent Jupiter from inserting native SOL wrap/unwrap steps
        wrapAndUnwrapSol: false,

        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 1_000_000,
            priorityLevel: "veryHigh",
          },
        },
      }),
    });

    const swapText = await swapIxRes.text().catch(() => "");
    if (!swapIxRes.ok) {
      return jsonError(swapIxRes.status, {
        code: "JUP_SWAP_INSTRUCTIONS_FAILED",
        error: `swap-instructions failed: ${swapIxRes.status} ${swapText}`,
        userMessage: "We couldn’t prepare this swap.",
        tip: "Try again in a moment.",
        stage,
        traceId,
      });
    }

    const j: {
      setupInstructions?: unknown[];
      swapInstruction?: unknown;
      cleanupInstructions?: unknown[];
      addressLookupTableAddresses?: unknown;
    } = swapText ? JSON.parse(swapText) : {};
    const setupIxsRaw = j.setupInstructions ?? [];
    const swapIxRaw = j.swapInstruction;
    const cleanupIxsRaw = j.cleanupInstructions ?? [];
    const altKeys: string[] = Array.isArray(j.addressLookupTableAddresses)
      ? j.addressLookupTableAddresses.map((k) => String(k))
      : [];

    if (!swapIxRaw) {
      return jsonError(500, {
        code: "NO_SWAP_INSTRUCTION",
        error: "Jupiter returned no swapInstruction",
        userMessage: "We couldn’t prepare this route.",
        tip: "Try again with a slightly different amount.",
        stage,
        traceId,
      });
    }

    stage = "loadALTs";
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const k of altKeys) {
      const { value } = await conn.getAddressLookupTable(new PublicKey(k));
      if (value) altAccounts.push(value);
    }

    stage = "buildInstructions";

    const setupIxs = setupIxsRaw.map(toIx);
    const { sponsoredAtaIxs, nonAtaSetupIxs } =
      rebuildAtaCreatesAsSponsored(setupIxs);

    // Ensure ATAs needed for (a) paying, (b) receiving, (c) treasury fee
    const mustHaveAtas: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userInputAta,
        userOwner,
        inputMint,
        inputProgId
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userOutputAta,
        userOwner,
        outputMint,
        outputProgId
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        treasuryInputAta,
        TREASURY_OWNER,
        inputMint,
        inputProgId
      ),
    ];

    const feeIx: TransactionInstruction | null =
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

    const ixsWithFee: TransactionInstruction[] = [
      ...mustHaveAtas,
      ...sponsoredAtaIxs,
      ...nonAtaSetupIxs,
      toIx(swapIxRaw),
      ...(feeIx ? [feeIx] : []),
      ...cleanupIxsRaw.map(toIx),
    ];

    const ixsNoFee: TransactionInstruction[] = [
      ...mustHaveAtas,
      ...sponsoredAtaIxs,
      ...nonAtaSetupIxs,
      toIx(swapIxRaw),
      ...cleanupIxsRaw.map(toIx),
    ];

    stage = "compile";
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );

    const compile = (ixs: TransactionInstruction[]) =>
      new VersionedTransaction(
        new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message(altAccounts)
      );

    let tx = compile(ixsWithFee);
    let encodedLen = Buffer.from(tx.serialize()).length;

    // If fee pushes over size, fallback to swap-only tx (still swaps netUnits)
    let postChargeFeeUnits: number | undefined;
    if (feeIx && encodedLen > MAX_ENCODED_LEN) {
      tx = compile(ixsNoFee);
      encodedLen = Buffer.from(tx.serialize()).length;
      postChargeFeeUnits = feeUnits;
    }

    if (encodedLen > MAX_ENCODED_LEN) {
      return jsonError(413, {
        code: "TX_TOO_LARGE",
        error: "Route too large to fit in one transaction.",
        userMessage: "This route is too complex to complete right now.",
        tip: "Try a smaller amount or a different pair.",
        stage,
        traceId,
        details: { encodedLen, limit: MAX_ENCODED_LEN },
      });
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      traceId,

      feeUnits,
      feeBps,
      feeRate,
      feeMint: inputMint.toBase58(),
      feeDecimals: inputDecimals,
      postChargeFeeUnits: postChargeFeeUnits ?? null,

      grossInUnits: amountUnits,
      netInUnits: netUnits,

      isMax,
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, {
      code: "UNHANDLED_BUILD_ERROR",
      error: msg,
      userMessage: "We couldn’t build this swap.",
      tip: "Please try again. If it keeps failing, contact support.",
      stage,
      traceId,
    });
  }
}
