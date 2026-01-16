// app/api/savings/plus/withdraw/build/route.ts
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
} from "@solana/spl-token";
import { Buffer } from "buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Types ───────── */

interface RequestBody {
  fromOwnerBase58?: string;
  amountUi?: string;
  amountUnits?: number;
  amount?: string | number;
  amountUsd?: string | number;
  amountDisplay?: string | number;
  slippageBps?: number;
}

interface JupiterQuoteResponse {
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  priceImpactPct?: string;
}

interface JupiterSwapInstructionsResponse {
  setupInstructions?: InstructionJson[];
  swapInstruction?: InstructionJson;
  cleanupInstructions?: InstructionJson[];
  addressLookupTableAddresses?: string[];
}

interface JupiterEarnResponse {
  instructions?: InstructionJson[];
  programId?: string;
  accounts?: AccountMetaJson[];
  data?: string;
}

interface InstructionJson {
  programId?: string;
  programID?: string;
  program?: string;
  data?: string;
  dataBase64?: string;
  encodedData?: string;
  keys?: AccountMetaJson[];
  accounts?: AccountMetaJson[];
  accountMetas?: AccountMetaJson[];
  instruction?: InstructionJson;
}

interface AccountMetaJson {
  pubkey?: string;
  pubKey?: string;
  address?: string;
  key?: string;
  isSigner?: boolean;
  signer?: boolean;
  is_signer?: boolean;
  isWritable?: boolean;
  writable?: boolean;
  is_writable?: boolean;
}

interface EarnPosition {
  token: {
    address: string;
    symbol: string;
    decimals: number;
    assetAddress: string;
  };
  ownerAddress: string;
  shares: string;
  underlyingAssets: string;
}

/* ───────── ENV ───────── */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const JUP_API_KEY = required("JUP_API_KEY");
const HAVEN_FEEPAYER_STR = required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS");
const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);

/* ───────── Jupiter endpoints ───────── */

const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUP_SWAP_IXS = "https://api.jup.ag/swap/v1/swap-instructions";
const JUP_EARN_WITHDRAW_IX =
  "https://api.jup.ag/lend/v1/earn/withdraw-instructions";
const JUP_EARN_POSITIONS = "https://api.jup.ag/lend/v1/earn/positions";

/* ───────── Constants ───────── */

// Mainnet USDC - output token
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
// JupUSD mint - what we withdraw from the vault
const JUPUSD_MINT = new PublicKey(
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD"
);

// v0 raw tx size limit
const MAX_TX_RAW_BYTES = 1232;

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/* ───────── Connection + caches ───────── */

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

const tokenProgramCache = new Map<string, PublicKey>();
const decimalsCache = new Map<string, number>();
const altCache = new Map<
  string,
  { account: AddressLookupTableAccount; expires: number }
>();
const ALT_CACHE_TTL = 5 * 60 * 1000;

/* ───────── Errors ───────── */

function jsonError(
  status: number,
  payload: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    stage?: string;
    traceId?: string;
    debug?: Record<string, unknown>;
  }
) {
  console.error(
    "[/api/savings/plus/withdraw/build]",
    status,
    payload.code,
    payload.error,
    payload.debug ? { debug: payload.debug } : ""
  );
  return NextResponse.json(payload, { status });
}

/* ───────── Token helpers ───────── */

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
  if (!info?.data || info.data.length < 45)
    throw new Error(`Invalid mint account: ${key}`);

  const decimals = info.data[44];
  decimalsCache.set(key, decimals);
  return decimals;
}

/* ───────── ALT helper ───────── */

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

/* ───────── Jupiter fetch ───────── */

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

/* ───────── Amount parsing ───────── */

function parseUiAmountToUnits(amountUi: string, decimals: number): bigint {
  const s = (amountUi ?? "").trim().replace(/,/g, "");
  if (!s) return BigInt(0);

  const [wRaw, fRaw = ""] = s.split(".");
  const whole = wRaw.replace(/[^\d]/g, "");
  const frac = fRaw.replace(/[^\d]/g, "");
  if (!whole && !frac) return BigInt(0);

  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const unitsStr = (whole || "0") + fracPadded;

  return BigInt(unitsStr);
}

function readAmountUi(body: RequestBody | null): string {
  const raw =
    body?.amountUi ??
    body?.amount ??
    body?.amountUsd ??
    body?.amountDisplay ??
    null;

  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "";
}

/* ───────── Instruction decoding ───────── */

function safePreview(v: unknown) {
  try {
    const s = JSON.stringify(
      v,
      (_key, val) => {
        if (typeof val === "string" && val.length > 180)
          return val.slice(0, 180) + "…";
        return val;
      },
      2
    );
    return s.length > 2000 ? s.slice(0, 2000) + "…(truncated)" : s;
  } catch {
    return String(v);
  }
}

function toIx(obj: unknown): TransactionInstruction {
  const root =
    obj && typeof obj === "object" && "instruction" in obj
      ? (obj as InstructionJson).instruction
      : obj;

  if (!root || typeof root !== "object") {
    throw new Error("Invalid instruction object (not an object)");
  }

  const rec = root as InstructionJson;

  const programId: string | null =
    typeof rec.programId === "string"
      ? rec.programId
      : typeof rec.programID === "string"
        ? rec.programID
        : typeof rec.program === "string"
          ? rec.program
          : null;

  const data: string | null =
    typeof rec.data === "string"
      ? rec.data
      : typeof rec.dataBase64 === "string"
        ? rec.dataBase64
        : typeof rec.encodedData === "string"
          ? rec.encodedData
          : null;

  const accountsRaw: (AccountMetaJson | string)[] | null = Array.isArray(
    rec.keys
  )
    ? rec.keys
    : Array.isArray(rec.accounts)
      ? rec.accounts
      : Array.isArray(rec.accountMetas)
        ? rec.accountMetas
        : null;

  if (!programId || data === null || !accountsRaw) {
    throw new Error(
      "Invalid instruction object (missing programId/data/accounts)"
    );
  }

  const keys = accountsRaw.map((k: AccountMetaJson | string) => {
    const pubkey: string | null =
      typeof k === "string"
        ? k
        : typeof k?.pubkey === "string"
          ? k.pubkey
          : typeof k?.pubKey === "string"
            ? k.pubKey
            : typeof k?.address === "string"
              ? k.address
              : typeof k?.key === "string"
                ? k.key
                : null;

    if (!pubkey)
      throw new Error("Invalid instruction object (account missing pubkey)");

    const isSigner =
      typeof k === "string"
        ? false
        : Boolean(k?.isSigner) ||
          Boolean(k?.signer) ||
          Boolean(k?.is_signer) ||
          false;

    const isWritable =
      typeof k === "string"
        ? false
        : Boolean(k?.isWritable) ||
          Boolean(k?.writable) ||
          Boolean(k?.is_writable) ||
          false;

    return {
      pubkey: new PublicKey(pubkey),
      isSigner,
      isWritable,
    };
  });

  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys,
    data: Buffer.from(data, "base64"),
  });
}

function safeToIx(
  obj: unknown,
  label: string,
  index: number,
  traceId: string
): TransactionInstruction {
  try {
    return toIx(obj);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[PLUS/WITHDRAW/BUILD] ${traceId} bad ix in ${label}[${index}]: ${msg}`
    );
    console.error(
      `[PLUS/WITHDRAW/BUILD] ${traceId} ${label}[${index}] preview:`,
      safePreview(obj)
    );
    throw e;
  }
}

/* ───────── Sponsored ATA rewrite ───────── */

function collectAndSponsorAtas(
  allIxs: TransactionInstruction[],
  traceId: string
): {
  sponsoredAtaIxs: TransactionInstruction[];
  otherIxs: TransactionInstruction[];
} {
  const sponsored: TransactionInstruction[] = [];
  const other: TransactionInstruction[] = [];
  const seenAtas = new Set<string>();

  for (const ix of allIxs) {
    if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      other.push(ix);
      continue;
    }

    const keys = ix.keys;
    if (keys.length < 6) {
      other.push(ix);
      continue;
    }

    const ata = keys[1]?.pubkey;
    const owner = keys[2]?.pubkey;
    const mint = keys[3]?.pubkey;
    const tokenProgram = keys[5]?.pubkey ?? TOKEN_PROGRAM_ID;

    if (!ata || !owner || !mint) {
      other.push(ix);
      continue;
    }

    const dedupeKey = ata.toBase58();
    if (seenAtas.has(dedupeKey)) {
      console.log(
        `[PLUS/WITHDRAW/BUILD] ${traceId} skipping duplicate ATA: ${dedupeKey.slice(0, 8)}...`
      );
      continue;
    }
    seenAtas.add(dedupeKey);

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

  console.log(
    `[PLUS/WITHDRAW/BUILD] ${traceId} ATA summary: ${sponsored.length} sponsored, ${other.length} other instructions`
  );

  return { sponsoredAtaIxs: sponsored, otherIxs: other };
}

/* ───────── ROUTE ───────── */

export async function POST(req: Request) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();
  let stage = "init";

  try {
    stage = "parseBody";

    const body = (await req.json().catch(() => null)) as RequestBody | null;

    const fromOwnerBase58 = body?.fromOwnerBase58?.trim() ?? "";
    const slippageBps = Number.isFinite(body?.slippageBps)
      ? Math.max(1, Math.min(10_000, Number(body?.slippageBps)))
      : 50;

    if (!fromOwnerBase58) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Missing fromOwnerBase58",
        userMessage: "Something went wrong preparing this withdrawal.",
        tip: "Please refresh and try again.",
        stage,
        traceId,
      });
    }

    const userOwner = new PublicKey(fromOwnerBase58);
    const conn = getConnection();

    // JupUSD has 6 decimals (same as USDC)
    stage = "tokenInfo";
    const jupUsdDecimals = await getDecimals(conn, JUPUSD_MINT);
    const usdcProgId = await getTokenProgramId(conn, USDC_MINT);

    stage = "amount";
    const amountUiRaw = readAmountUi(body);
    let withdrawAmountUnits = BigInt(0);

    if (amountUiRaw) {
      withdrawAmountUnits = parseUiAmountToUnits(amountUiRaw, jupUsdDecimals);
    } else {
      const n = Number(body?.amountUnits ?? 0);
      withdrawAmountUnits = Number.isFinite(n)
        ? BigInt(Math.floor(n))
        : BigInt(0);
    }

    console.log("[PLUS/WITHDRAW/BUILD] payload", {
      traceId,
      fromOwnerBase58,
      amountUiRaw,
      withdrawAmountUnits: withdrawAmountUnits.toString(),
      slippageBps,
    });

    if (withdrawAmountUnits <= BigInt(0)) {
      return jsonError(400, {
        code: "INVALID_AMOUNT",
        error: "Amount must be > 0",
        userMessage: "Please enter an amount.",
        tip: "Try again.",
        stage,
        traceId,
        debug: {
          amountUiRaw,
          withdrawAmountUnits: withdrawAmountUnits.toString(),
          keysPresent: body ? Object.keys(body) : [],
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Check user's position in JupUSD vault
    // ═══════════════════════════════════════════════════════════════════════════

    stage = "positionCheck";
    const positionsUrl =
      `${JUP_EARN_POSITIONS}?` +
      new URLSearchParams({ users: userOwner.toBase58() });

    const posRes = await jupFetch(positionsUrl);
    if (!posRes.ok) {
      return jsonError(posRes.status, {
        code: "POSITION_CHECK_FAILED",
        error: `Failed to fetch positions: ${posRes.status}`,
        userMessage: "Couldn't verify your vault balance.",
        tip: "Try again in a moment.",
        stage,
        traceId,
      });
    }

    const positions = (await posRes.json()) as EarnPosition[];
    const jupUsdPosition = positions.find(
      (p) => p.token?.assetAddress === JUPUSD_MINT.toBase58()
    );

    if (!jupUsdPosition) {
      return jsonError(400, {
        code: "NO_POSITION",
        error: "User has no JupUSD vault position",
        userMessage: "You don't have any funds in the Plus vault.",
        tip: "Deposit first to start earning.",
        stage,
        traceId,
      });
    }

    const availableUnits = BigInt(jupUsdPosition.underlyingAssets || "0");
    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} position: available=${availableUnits.toString()}, requested=${withdrawAmountUnits.toString()}`
    );

    if (availableUnits < withdrawAmountUnits) {
      return jsonError(400, {
        code: "INSUFFICIENT_BALANCE",
        error: `need=${withdrawAmountUnits.toString()}, have=${availableUnits.toString()}`,
        userMessage: "You don't have enough funds in the vault.",
        tip: "Try a smaller amount.",
        stage,
        traceId,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Get withdraw instructions from JupUSD vault
    // ═══════════════════════════════════════════════════════════════════════════

    stage = "withdrawInstruction";
    const withdrawIxRes = await jupFetch(JUP_EARN_WITHDRAW_IX, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: JUPUSD_MINT.toBase58(),
        signer: userOwner.toBase58(),
        amount: withdrawAmountUnits.toString(),
      }),
    });

    if (!withdrawIxRes.ok) {
      const t = await withdrawIxRes.text().catch(() => "");
      return jsonError(withdrawIxRes.status, {
        code: "WITHDRAW_IX_FAILED",
        error: `withdraw-instructions failed: ${withdrawIxRes.status}`,
        userMessage: "Couldn't prepare the vault withdrawal.",
        tip: "Try again in a moment.",
        stage,
        traceId,
        debug: { body: t.slice(0, 500) },
      });
    }

    const withdrawJson =
      (await withdrawIxRes.json()) as JupiterEarnResponse | null;

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} withdrawJson keys:`,
      withdrawJson ? Object.keys(withdrawJson) : []
    );

    const withdrawList: unknown[] = Array.isArray(withdrawJson?.instructions)
      ? withdrawJson.instructions
      : withdrawJson
        ? [withdrawJson]
        : [];

    if (!withdrawList.length) {
      return jsonError(500, {
        code: "NO_WITHDRAW_IX",
        error: "Withdraw endpoint returned no instructions",
        userMessage: "Couldn't prepare the vault withdrawal.",
        tip: "Try again in a moment.",
        stage,
        traceId,
        debug: {
          withdrawJsonKeys: withdrawJson ? Object.keys(withdrawJson) : [],
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Get quote for JupUSD → USDC swap
    // ═══════════════════════════════════════════════════════════════════════════

    stage = "quote";
    const quoteUrl =
      `${JUP_QUOTE}?` +
      new URLSearchParams({
        inputMint: JUPUSD_MINT.toBase58(),
        outputMint: USDC_MINT.toBase58(),
        amount: withdrawAmountUnits.toString(),
        slippageBps: String(slippageBps),
      });

    const [quoteRes, blockhashData] = await Promise.all([
      jupFetch(quoteUrl),
      conn.getLatestBlockhash("confirmed"),
    ]);

    if (!quoteRes.ok) {
      return jsonError(quoteRes.status, {
        code: "JUP_QUOTE_FAILED",
        error: `Quote failed: ${quoteRes.status}`,
        userMessage: "Couldn't price this withdrawal right now.",
        tip: "Try again in a moment.",
        stage,
        traceId,
      });
    }

    const quoteResponse =
      (await quoteRes.json()) as JupiterQuoteResponse | null;
    const usdcOutAmount = String(quoteResponse?.outAmount ?? "");

    if (!usdcOutAmount || !/^\d+$/.test(usdcOutAmount)) {
      return jsonError(500, {
        code: "BAD_QUOTE",
        error: "Quote missing outAmount",
        userMessage: "Couldn't prepare this withdrawal route.",
        tip: "Try again in a moment.",
        stage,
        traceId,
        debug: { outAmount: quoteResponse?.outAmount },
      });
    }

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} quote: ${withdrawAmountUnits.toString()} JupUSD -> ${usdcOutAmount} USDC`
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Get swap instructions (JupUSD → USDC)
    // ═══════════════════════════════════════════════════════════════════════════

    stage = "swapInstructions";
    const swapIxRes = await jupFetch(JUP_SWAP_IXS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userOwner.toBase58(),
        wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 0,
      }),
    });

    if (!swapIxRes.ok) {
      const t = await swapIxRes.text().catch(() => "");
      return jsonError(swapIxRes.status, {
        code: "JUP_SWAP_IX_FAILED",
        error: `swap-instructions failed: ${swapIxRes.status}`,
        userMessage: "Couldn't prepare this withdrawal.",
        tip: "Try again in a moment.",
        stage,
        traceId,
        debug: { body: t.slice(0, 500) },
      });
    }

    const swapData =
      (await swapIxRes.json()) as JupiterSwapInstructionsResponse | null;

    if (!swapData?.swapInstruction) {
      return jsonError(500, {
        code: "NO_SWAP_IX",
        error: "Jupiter returned no swapInstruction",
        userMessage: "Couldn't build this route.",
        tip: "Try a different amount.",
        stage,
        traceId,
        debug: { swapDataKeys: swapData ? Object.keys(swapData) : [] },
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: Load ALTs for swap
    // ═══════════════════════════════════════════════════════════════════════════

    stage = "loadALTs";
    const altKeys = (swapData.addressLookupTableAddresses ?? []).slice(0, 16);
    const altAccounts = (
      await Promise.all(altKeys.map((k: string) => getAltCached(conn, k)))
    ).filter((a): a is AddressLookupTableAccount => a !== null);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Decode all instructions
    // ═══════════════════════════════════════════════════════════════════════════

    stage = "buildInstructions";

    // Decode withdraw instructions (these come FIRST - withdraw from vault)
    const withdrawIxs = withdrawList.map((x, i) =>
      safeToIx(x, "withdraw", i, traceId)
    );

    // Decode swap instructions (swap JupUSD → USDC)
    const swapSetupIxs = (swapData.setupInstructions ?? []).map(
      (x: InstructionJson, i: number) => safeToIx(x, "swapSetup", i, traceId)
    );
    const swapIx = safeToIx(swapData.swapInstruction, "swap", 0, traceId);
    const swapCleanupIxs = (swapData.cleanupInstructions ?? []).map(
      (x: InstructionJson, i: number) => safeToIx(x, "swapCleanup", i, traceId)
    );

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} raw ix counts: withdraw=${withdrawIxs.length}, swapSetup=${swapSetupIxs.length}, swap=1, swapCleanup=${swapCleanupIxs.length}`
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 7: Collect ALL instructions, extract and sponsor ATAs
    // Order: withdraw from vault FIRST, then swap
    // ═══════════════════════════════════════════════════════════════════════════

    const allInstructionsInOrder: TransactionInstruction[] = [
      ...withdrawIxs,
      ...swapSetupIxs,
      swapIx,
      ...swapCleanupIxs,
    ];

    const { sponsoredAtaIxs, otherIxs } = collectAndSponsorAtas(
      allInstructionsInOrder,
      traceId
    );

    // Final instruction order:
    // 1. All sponsored ATA creates (Haven pays rent, deduplicated)
    // 2. All other instructions in original order (withdraw -> swap)
    const ixs: TransactionInstruction[] = [...sponsoredAtaIxs, ...otherIxs];

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} final ix count: ${ixs.length} (${sponsoredAtaIxs.length} ATAs + ${otherIxs.length} other)`
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 8: Compile transaction
    // ═══════════════════════════════════════════════════════════════════════════

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
        userMessage: "This route is too large. Try a smaller amount.",
        tip: "If this happens often, you can pre-create common ATAs.",
        stage,
        traceId,
        debug: { rawLen },
      });
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    const buildTime = Date.now() - startTime;

    // User's USDC ATA (where they'll receive the USDC)
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      userOwner,
      false,
      usdcProgId
    );

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} ${buildTime}ms jupUsdWithdraw=${withdrawAmountUnits.toString()} usdcOut=${usdcOutAmount}`
    );

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      traceId,

      jupUsdWithdrawUnits: withdrawAmountUnits.toString(),
      usdcOutUnits: usdcOutAmount,
      slippageBps,

      payer: HAVEN_FEEPAYER.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      quote: {
        inAmount: quoteResponse?.inAmount,
        outAmount: quoteResponse?.outAmount,
        otherAmountThreshold: quoteResponse?.otherAmountThreshold,
        priceImpactPct: quoteResponse?.priceImpactPct,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[PLUS/WITHDRAW/BUILD] ${traceId} error at ${stage}:`, msg);
    return jsonError(500, {
      code: "UNHANDLED_BUILD_ERROR",
      error: msg,
      userMessage: "Couldn't prepare this withdrawal.",
      tip: "Please try again.",
      stage,
      traceId,
    });
  }
}
