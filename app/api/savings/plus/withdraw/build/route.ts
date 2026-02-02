// app/api/savings/plus/withdraw/build/route.ts
import { NextRequest, NextResponse } from "next/server";
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
import BN from "bn.js";
import { rateLimitServer } from "@/lib/rateLimitServer";
import { validateCsrf } from "@/lib/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

interface RequestBody {
  fromOwnerBase58?: string;
  amountUi?: string;
  amountUnits?: number;
  amount?: string | number;
  amountUsd?: string | number;
  amountDisplay?: string | number;
  slippageBps?: number;
  withdrawAll?: boolean;
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

interface EarnToken {
  address: string;
  asset: string;
  decimals: string | number;
  totalAssets: string;
  totalSupply: string;
  supplyRate: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENV
   ═══════════════════════════════════════════════════════════════════════════ */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const RPC = required("SOLANA_RPC");
const JUP_API_KEY = required("JUP_API_KEY");

const HAVEN_FEEPAYER_STR = required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS");
const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);

const TREASURY_OWNER_STR = required("NEXT_PUBLIC_APP_TREASURY_OWNER");
const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);

const IS_PROD = process.env.NODE_ENV === "production";

/* ═══════════════════════════════════════════════════════════════════════════
   JUPITER ENDPOINTS
   ═══════════════════════════════════════════════════════════════════════════ */

const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUP_SWAP_IXS = "https://api.jup.ag/swap/v1/swap-instructions";

const JUP_EARN_WITHDRAW_IX =
  "https://api.jup.ag/lend/v1/earn/withdraw-instructions";
const JUP_EARN_REDEEM_IX =
  "https://api.jup.ag/lend/v1/earn/redeem-instructions";

const JUP_EARN_POSITIONS = "https://api.jup.ag/lend/v1/earn/positions";
const JUP_EARN_TOKENS = "https://api.jup.ag/lend/v1/earn/tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const JUPUSD_MINT = new PublicKey(
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
);

const USDC_DECIMALS = 6;
const MAX_TX_RAW_BYTES = 1232;

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// API timeouts and retry config
const API_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 150;

/* ═══════════════════════════════════════════════════════════════════════════
   CONNECTION + CACHES
   ═══════════════════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════════════════
   FEE HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function getWithdrawFeeRate(): number {
  const raw = Number(process.env.NEXT_PUBLIC_FLEX_WITHDRAW_FEE_UI ?? "0");
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function feeFromAmountBase(amountBase: BN, feeRate: number): BN {
  if (!feeRate) return new BN(0);
  const ppm = Math.max(0, Math.round(feeRate * 1_000_000));
  if (!ppm) return new BN(0);
  return amountBase.muln(ppm).divn(1_000_000);
}

function bnToUiString(amountBn: BN, decimals: number): string {
  const raw = amountBn.toString(10);
  if (decimals === 0) return raw;

  const pad = raw.padStart(decimals + 1, "0");
  const i = pad.length - decimals;
  const whole = pad.slice(0, i);
  const frac = pad.slice(i).replace(/0+$/, "");
  return frac.length ? `${whole}.${frac}` : whole;
}

function makeTransferCheckedIx(opts: {
  tokenProgramId: PublicKey;
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amountBase: BN;
  decimals: number;
}): TransactionInstruction {
  const {
    tokenProgramId,
    source,
    mint,
    destination,
    authority,
    amountBase,
    decimals,
  } = opts;

  const data = Buffer.concat([
    Buffer.from([12]), // TransferChecked = 12
    amountBase.toArrayLike(Buffer, "le", 8),
    Buffer.from([decimals & 0xff]),
  ]);

  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   DYNAMIC SLIPPAGE
   ═══════════════════════════════════════════════════════════════════════════ */

function calculateSlippage(amountUnits: bigint, userSlippage?: number): number {
  if (userSlippage !== undefined && Number.isFinite(userSlippage)) {
    return Math.max(10, Math.min(10_000, userSlippage));
  }

  const amountUsd = Number(amountUnits) / 1e6;
  if (amountUsd < 100) return 50;
  if (amountUsd < 1_000) return 75;
  if (amountUsd < 10_000) return 100;
  if (amountUsd < 100_000) return 150;
  return 200;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ERROR HELPER
   ═══════════════════════════════════════════════════════════════════════════ */

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
  },
) {
  console.error(
    "[/api/savings/plus/withdraw/build]",
    status,
    payload.code,
    payload.error,
    !IS_PROD && payload.debug ? { debug: payload.debug } : "",
  );

  const responsePayload = IS_PROD ? { ...payload, debug: undefined } : payload;
  return NextResponse.json(responsePayload, { status });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOKEN HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

async function getTokenProgramId(
  conn: Connection,
  mint: PublicKey,
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

/* ═══════════════════════════════════════════════════════════════════════════
   ALT HELPER
   ═══════════════════════════════════════════════════════════════════════════ */

async function getAltCached(
  conn: Connection,
  key: string,
): Promise<AddressLookupTableAccount | null> {
  const now = Date.now();
  const cached = altCache.get(key);
  if (cached && cached.expires > now) return cached.account;

  const { value } = await conn.getAddressLookupTable(new PublicKey(key));
  if (value)
    altCache.set(key, { account: value, expires: now + ALT_CACHE_TTL });
  return value;
}

/* ═══════════════════════════════════════════════════════════════════════════
   JUPITER FETCH WITH TIMEOUT AND RETRY
   ═══════════════════════════════════════════════════════════════════════════ */

async function jupFetchWithRetry(
  url: string,
  init?: RequestInit,
  maxRetries = MAX_RETRIES,
  timeoutMs = API_TIMEOUT_MS,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        cache: "no-store",
        ...init,
        signal: controller.signal,
        headers: {
          ...(init?.headers || {}),
          "x-api-key": JUP_API_KEY,
        },
      });

      clearTimeout(timeout);

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt === maxRetries) return res;

        const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[jupFetch] ${res.status} on attempt ${attempt}/${maxRetries}, retrying in ${backoff}ms...`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      return res;
    } catch (e) {
      clearTimeout(timeout);
      lastError = e as Error;

      if ((e as Error).name === "AbortError") {
        throw new Error(`Jupiter API timeout after ${timeoutMs}ms`);
      }

      if (attempt === maxRetries) throw lastError;

      const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[jupFetch] Error on attempt ${attempt}/${maxRetries}: ${(e as Error).message}, retrying in ${backoff}ms...`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new Error("Jupiter fetch failed");
}

/* ═══════════════════════════════════════════════════════════════════════════
   AMOUNT PARSING
   ═══════════════════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════════════════
   INSTRUCTION DECODING
   ═══════════════════════════════════════════════════════════════════════════ */

function safePreview(v: unknown) {
  try {
    const s = JSON.stringify(
      v,
      (_key, val) => {
        if (typeof val === "string" && val.length > 180)
          return val.slice(0, 180) + "…";
        return val;
      },
      2,
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
    rec.keys,
  )
    ? rec.keys
    : Array.isArray(rec.accounts)
      ? rec.accounts
      : Array.isArray(rec.accountMetas)
        ? rec.accountMetas
        : null;

  if (!programId || data === null || !accountsRaw) {
    throw new Error(
      "Invalid instruction object (missing programId/data/accounts)",
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

    if (!pubkey) {
      throw new Error("Invalid instruction object (account missing pubkey)");
    }

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
  traceId: string,
): TransactionInstruction {
  try {
    return toIx(obj);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[PLUS/WITHDRAW/BUILD] ${traceId} bad ix in ${label}[${index}]: ${msg}`,
    );
    if (!IS_PROD) {
      console.error(
        `[PLUS/WITHDRAW/BUILD] ${traceId} ${label}[${index}] preview:`,
        safePreview(obj),
      );
    }
    throw e;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPONSORED ATA REWRITE
   ═══════════════════════════════════════════════════════════════════════════ */

function collectAndSponsorAtas(
  allIxs: TransactionInstruction[],
  traceId: string,
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
    if (seenAtas.has(dedupeKey)) continue;
    seenAtas.add(dedupeKey);

    sponsored.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        ata,
        owner,
        mint,
        tokenProgram,
      ),
    );
  }

  console.log(
    `[PLUS/WITHDRAW/BUILD] ${traceId} ATA summary: ${sponsored.length} sponsored, ${other.length} other`,
  );

  return { sponsoredAtaIxs: sponsored, otherIxs: other };
}

/* ═══════════════════════════════════════════════════════════════════════════
   QUOTE WITH FALLBACK
   ═══════════════════════════════════════════════════════════════════════════ */

function buildQuoteUrl(opts: {
  amount: string;
  slippageBps: number;
  maxAccounts?: number;
  onlyDirectRoutes?: boolean;
}) {
  const params = new URLSearchParams({
    inputMint: JUPUSD_MINT.toBase58(),
    outputMint: USDC_MINT.toBase58(),
    amount: opts.amount,
    slippageBps: String(opts.slippageBps),
  });

  // Only set when provided (avoids brittle 400s if API changes)
  if (typeof opts.maxAccounts === "number") {
    params.set("maxAccounts", String(opts.maxAccounts));
  }
  if (typeof opts.onlyDirectRoutes === "boolean") {
    params.set("onlyDirectRoutes", String(opts.onlyDirectRoutes));
  }

  return `${JUP_QUOTE}?${params.toString()}`;
}

async function getQuoteWithFallback(opts: {
  traceId: string;
  amount: string;
  slippageBps: number;
}) {
  const { traceId, amount, slippageBps } = opts;

  const attempts = [
    { maxAccounts: 8, onlyDirectRoutes: true },
    { maxAccounts: 12, onlyDirectRoutes: true },
    { maxAccounts: 16, onlyDirectRoutes: false },
    { maxAccounts: 24, onlyDirectRoutes: false },
  ] as const;

  let lastStatus = 0;
  let lastBody = "";

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const url = buildQuoteUrl({
      amount,
      slippageBps,
      maxAccounts: a.maxAccounts,
      onlyDirectRoutes: a.onlyDirectRoutes,
    });

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} quote attempt ${i + 1}/${attempts.length}: maxAccounts=${a.maxAccounts} onlyDirectRoutes=${a.onlyDirectRoutes}`,
    );

    const res = await jupFetchWithRetry(url);

    if (res.ok) return res;

    lastStatus = res.status;
    lastBody = await res.text().catch(() => "");

    // If it's not a route/param type failure, stop falling back.
    if (res.status !== 400 && res.status !== 404) {
      return res;
    }

    console.warn(
      `[PLUS/WITHDRAW/BUILD] ${traceId} quote attempt ${i + 1} failed: ${res.status} body=${lastBody.slice(0, 200)}`,
    );
  }

  // Throw so caller can respond with a useful error.
  const err = new Error(
    `Jupiter quote failed after fallbacks (lastStatus=${lastStatus})`,
  ) as Error & { status?: number; body?: string };
  err.status = lastStatus || 400;
  err.body = lastBody;
  throw err;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTE HANDLER
   ═══════════════════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();
  let stage = "init";

  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  // Rate limit
  const blocked = await rateLimitServer(req, {
    api: "savings:plus:withdraw:build",
    requireAuth: true,
    allowIpFallback: false,
    failMode: "closed",
    tiers: [
      { limit: 2, windowMs: 10_000, suffix: "burst" },
      { limit: 8, windowMs: 60_000, suffix: "minute" },
      { limit: 60, windowMs: 3_600_000, suffix: "hour" },
    ],
  });
  if (blocked) return blocked;

  const metrics = {
    parseMs: 0,
    positionCheckMs: 0,
    withdrawIxMs: 0,
    quoteMs: 0,
    swapIxMs: 0,
    compileMs: 0,
    totalMs: 0,
  };

  try {
    /* ───────── Parse body ───────── */
    stage = "parseBody";
    const parseStart = Date.now();

    const body = (await req.json().catch(() => null)) as RequestBody | null;

    const fromOwnerBase58 = body?.fromOwnerBase58?.trim() ?? "";
    const withdrawAll = body?.withdrawAll === true;

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

    metrics.parseMs = Date.now() - parseStart;

    /* ───────── Token info ───────── */
    stage = "tokenInfo";
    const jupUsdDecimals = await getDecimals(conn, JUPUSD_MINT);
    const usdcProgId = await getTokenProgramId(conn, USDC_MINT);

    /* ───────── Parse amount ───────── */
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

    if (!withdrawAll && withdrawAmountUnits <= BigInt(0)) {
      return jsonError(400, {
        code: "INVALID_AMOUNT",
        error: "Amount must be > 0",
        userMessage: "Please enter an amount.",
        tip: "Try again.",
        stage,
        traceId,
      });
    }

    /* ───────── Phase 1: positions + tokens + blockhash ───────── */
    stage = "parallelFetch1";
    const fetch1Start = Date.now();

    const positionsUrl =
      `${JUP_EARN_POSITIONS}?` +
      new URLSearchParams({ users: userOwner.toBase58() });

    const [posRes, tokensRes, blockhashData] = await Promise.all([
      jupFetchWithRetry(positionsUrl),
      jupFetchWithRetry(JUP_EARN_TOKENS),
      conn.getLatestBlockhash("confirmed"),
    ]);

    metrics.positionCheckMs = Date.now() - fetch1Start;

    /* ───────── Validate position ───────── */
    stage = "positionCheck";

    if (!posRes.ok) {
      return jsonError(posRes.status, {
        code: "POSITION_CHECK_FAILED",
        error: `Failed to fetch positions: ${posRes.status}`,
        userMessage: "Couldn't verify your vault balance.",
        tip:
          posRes.status === 429
            ? "Too many requests. Wait a moment."
            : "Try again in a moment.",
        stage,
        traceId,
      });
    }

    const positions = (await posRes.json()) as EarnPosition[];
    const jupUsdPosition = positions.find(
      (p) => p.token?.assetAddress === JUPUSD_MINT.toBase58(),
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
    const userShares = jupUsdPosition.shares;

    const availableWithBuffer = availableUnits + availableUnits / BigInt(10000);

    if (withdrawAll) {
      withdrawAmountUnits = availableUnits;
    }

    console.log(`[PLUS/WITHDRAW/BUILD] ${traceId} position:`, {
      available: availableUnits.toString(),
      availableWithBuffer: availableWithBuffer.toString(),
      shares: userShares,
      requested: withdrawAmountUnits.toString(),
      withdrawAll,
    });

    if (availableWithBuffer < withdrawAmountUnits) {
      const availableUsd = (Number(availableUnits) / 1e6).toFixed(2);
      return jsonError(400, {
        code: "INSUFFICIENT_BALANCE",
        error: `need=${withdrawAmountUnits.toString()}, have≈${availableUnits.toString()}`,
        userMessage: `You only have ~$${availableUsd} in the vault.`,
        tip: "Try a smaller amount or withdraw all.",
        stage,
        traceId,
      });
    }

    const safeWithdrawAmount =
      withdrawAmountUnits > availableUnits
        ? availableUnits
        : withdrawAmountUnits;

    /* ───────── Liquidity check (best-effort) ───────── */
    stage = "liquidityCheck";

    if (tokensRes.ok) {
      try {
        const tokens = (await tokensRes.json()) as EarnToken[];
        const jupUsdVault = tokens.find(
          (t) => t.asset === JUPUSD_MINT.toBase58(),
        );
        if (jupUsdVault) {
          const totalAssets = BigInt(jupUsdVault.totalAssets || "0");

          if (safeWithdrawAmount > totalAssets / BigInt(2)) {
            console.warn(
              `[PLUS/WITHDRAW/BUILD] ${traceId} Large withdrawal: ${safeWithdrawAmount} vs total ${totalAssets}`,
            );
          }

          if (safeWithdrawAmount > totalAssets) {
            const availableLiqUsd = (Number(totalAssets) / 1e6).toFixed(2);
            return jsonError(400, {
              code: "INSUFFICIENT_LIQUIDITY",
              error: `Requested ${safeWithdrawAmount}, total vault has ${totalAssets}`,
              userMessage: `Only $${availableLiqUsd} is available for withdrawal right now.`,
              tip: "Liquidity fluctuates based on borrowing demand. Try a smaller amount.",
              stage,
              traceId,
            });
          }
        }
      } catch (e) {
        console.warn(
          `[PLUS/WITHDRAW/BUILD] ${traceId} liquidity check failed:`,
          e,
        );
      }
    }

    /* ───────── Fee + slippage ───────── */
    stage = "feeCalculation";
    const feeRate = getWithdrawFeeRate();
    console.log(`[PLUS/WITHDRAW/BUILD] ${traceId} fee: rate=${feeRate}`);

    const slippageBps = calculateSlippage(
      safeWithdrawAmount,
      body?.slippageBps,
    );

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} slippage: ${slippageBps} bps for ${safeWithdrawAmount.toString()} units`,
    );

    /* ───────── Phase 2: withdraw ix + quote (with fallback) ───────── */
    stage = "parallelFetch2";
    const fetch2Start = Date.now();

    const isFullWithdraw = withdrawAll || safeWithdrawAmount >= availableUnits;
    const withdrawEndpoint = isFullWithdraw
      ? JUP_EARN_REDEEM_IX
      : JUP_EARN_WITHDRAW_IX;

    const withdrawPayload = isFullWithdraw
      ? {
          asset: JUPUSD_MINT.toBase58(),
          signer: userOwner.toBase58(),
          shares: userShares,
        }
      : {
          asset: JUPUSD_MINT.toBase58(),
          signer: userOwner.toBase58(),
          amount: safeWithdrawAmount.toString(),
        };

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} using ${isFullWithdraw ? "redeem" : "withdraw"} endpoint`,
    );

    let quoteRes: Response;
    const [withdrawIxRes] = await Promise.all([
      jupFetchWithRetry(withdrawEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withdrawPayload),
      }),
      (async () => {
        const qs = Date.now();
        try {
          quoteRes = await getQuoteWithFallback({
            traceId,
            amount: safeWithdrawAmount.toString(),
            slippageBps,
          });
        } finally {
          metrics.quoteMs = Date.now() - qs;
        }
      })(),
    ]);

    metrics.withdrawIxMs = Date.now() - fetch2Start;

    /* ───────── Validate withdraw ix ───────── */
    stage = "withdrawInstruction";

    if (!withdrawIxRes.ok) {
      const t = await withdrawIxRes.text().catch(() => "");
      return jsonError(withdrawIxRes.status, {
        code: "WITHDRAW_IX_FAILED",
        error: `withdraw-instructions failed: ${withdrawIxRes.status}`,
        userMessage: "Couldn't prepare the vault withdrawal.",
        tip:
          withdrawIxRes.status === 429
            ? "Too many requests. Wait a moment."
            : "Try again in a moment.",
        stage,
        traceId,
        debug: IS_PROD ? undefined : { body: t.slice(0, 500) },
      });
    }

    const withdrawJson =
      (await withdrawIxRes.json()) as JupiterEarnResponse | null;
    const withdrawList: unknown[] = Array.isArray(withdrawJson?.instructions)
      ? withdrawJson!.instructions!
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
      });
    }

    /* ───────── Validate quote ───────── */
    stage = "quote";

    if (!quoteRes!.ok) {
      const t = await quoteRes!.text().catch(() => "");
      return jsonError(quoteRes!.status, {
        code: "JUP_QUOTE_FAILED",
        error: `Quote failed: ${quoteRes!.status}`,
        userMessage: "Couldn't price this withdrawal right now.",
        tip:
          quoteRes!.status === 429
            ? "Too many requests. Wait a moment."
            : "Try again in a moment.",
        stage,
        traceId,
        debug: IS_PROD ? undefined : { body: t.slice(0, 500) },
      });
    }

    const quoteResponse =
      (await quoteRes!.json()) as JupiterQuoteResponse | null;
    const usdcOutAmount = String(quoteResponse?.outAmount ?? "");

    if (!usdcOutAmount || !/^\d+$/.test(usdcOutAmount)) {
      return jsonError(500, {
        code: "BAD_QUOTE",
        error: "Quote missing outAmount",
        userMessage: "Couldn't prepare this withdrawal route.",
        tip: "Try again in a moment.",
        stage,
        traceId,
      });
    }

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} quote: ${safeWithdrawAmount.toString()} JupUSD -> ${usdcOutAmount} USDC`,
    );

    /* ───────── Fee based on quote ───────── */
    const actualUsdcOutBn = new BN(usdcOutAmount);
    const actualFeeBase = feeFromAmountBase(actualUsdcOutBn, feeRate);
    const netBase = BN.max(new BN(0), actualUsdcOutBn.sub(actualFeeBase));
    const actualHasFee = !actualFeeBase.isZero();

    console.log(
      `[PLUS/WITHDRAW/BUILD] ${traceId} final: gross=${bnToUiString(
        actualUsdcOutBn,
        USDC_DECIMALS,
      )}, fee=${bnToUiString(actualFeeBase, USDC_DECIMALS)}, net=${bnToUiString(
        netBase,
        USDC_DECIMALS,
      )}`,
    );

    /* ───────── Swap instructions ───────── */
    stage = "swapInstructions";
    const swapStart = Date.now();

    const swapIxRes = await jupFetchWithRetry(JUP_SWAP_IXS, {
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

    metrics.swapIxMs = Date.now() - swapStart;

    if (!swapIxRes.ok) {
      const t = await swapIxRes.text().catch(() => "");
      return jsonError(swapIxRes.status, {
        code: "JUP_SWAP_IX_FAILED",
        error: `swap-instructions failed: ${swapIxRes.status}`,
        userMessage: "Couldn't prepare this withdrawal.",
        tip:
          swapIxRes.status === 429
            ? "Too many requests. Wait a moment."
            : "Try again in a moment.",
        stage,
        traceId,
        debug: IS_PROD ? undefined : { body: t.slice(0, 500) },
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
      });
    }

    /* ───────── Load ALTs ───────── */
    stage = "loadALTs";
    const altKeys = (swapData.addressLookupTableAddresses ?? []).slice(0, 16);
    const altAccounts = (
      await Promise.all(altKeys.map((k: string) => getAltCached(conn, k)))
    ).filter((a): a is AddressLookupTableAccount => a !== null);

    /* ───────── Build instructions ───────── */
    stage = "buildInstructions";
    const compileStart = Date.now();

    const withdrawIxs = withdrawList.map((x, i) =>
      safeToIx(x, "withdraw", i, traceId),
    );

    const swapSetupIxs = (swapData.setupInstructions ?? []).map((x, i) =>
      safeToIx(x, "swapSetup", i, traceId),
    );
    const swapIx = safeToIx(swapData.swapInstruction, "swap", 0, traceId);
    const swapCleanupIxs = (swapData.cleanupInstructions ?? []).map((x, i) =>
      safeToIx(x, "swapCleanup", i, traceId),
    );

    const allInstructionsInOrder: TransactionInstruction[] = [
      ...withdrawIxs,
      ...swapSetupIxs,
      swapIx,
      ...swapCleanupIxs,
    ];

    const { sponsoredAtaIxs, otherIxs } = collectAndSponsorAtas(
      allInstructionsInOrder,
      traceId,
    );

    /* ───────── Fee instruction ───────── */
    stage = "feeInstruction";

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      userOwner,
      false,
      usdcProgId,
    );
    const treasuryUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      TREASURY_OWNER,
      false,
      usdcProgId,
    );

    const ixs: TransactionInstruction[] = [];

    // Compute budget
    const baseComputeUnits = 300_000;
    const extraForFee = actualHasFee ? 50_000 : 0;
    const extraForAtas = sponsoredAtaIxs.length * 20_000;
    const computeUnits = Math.min(
      1_400_000,
      baseComputeUnits + extraForFee + extraForAtas,
    );

    ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    );

    // Sponsored ATA creates
    ixs.push(...sponsoredAtaIxs);

    // Treasury ATA (if fee)
    if (actualHasFee) {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_FEEPAYER,
          treasuryUsdcAta,
          TREASURY_OWNER,
          USDC_MINT,
          usdcProgId,
        ),
      );
    }

    // Main ixs (withdraw -> swap)
    ixs.push(...otherIxs);

    // Fee transfer after swap
    if (actualHasFee) {
      ixs.push(
        makeTransferCheckedIx({
          tokenProgramId: usdcProgId,
          source: userUsdcAta,
          mint: USDC_MINT,
          destination: treasuryUsdcAta,
          authority: userOwner,
          amountBase: actualFeeBase,
          decimals: USDC_DECIMALS,
        }),
      );
    }

    /* ───────── Estimate tx size ───────── */
    const estimatedAccounts = new Set<string>();
    for (const ix of ixs) {
      estimatedAccounts.add(ix.programId.toBase58());
      for (const key of ix.keys) estimatedAccounts.add(key.pubkey.toBase58());
    }
    const estimatedSize = 200 + estimatedAccounts.size * 32 + ixs.length * 50;
    if (estimatedSize > 1100) {
      console.warn(
        `[PLUS/WITHDRAW/BUILD] ${traceId} tx may be large: ~${estimatedSize} bytes estimated`,
      );
    }

    /* ───────── Compile transaction ───────── */
    stage = "compile";
    const { blockhash, lastValidBlockHeight } = blockhashData;

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: HAVEN_FEEPAYER,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message(altAccounts),
    );

    const rawLen = tx.serialize().length;
    metrics.compileMs = Date.now() - compileStart;

    if (rawLen > MAX_TX_RAW_BYTES) {
      console.error(`[PLUS/WITHDRAW/BUILD] ${traceId} TX TOO LARGE`, {
        rawLen,
        estimatedSize,
        ixCount: ixs.length,
        altCount: altAccounts.length,
        altKeys,
      });

      return jsonError(413, {
        code: "TX_TOO_LARGE",
        error: `Raw size ${rawLen} > ${MAX_TX_RAW_BYTES}`,
        userMessage:
          "This withdrawal route is too complex. Please try a smaller amount or contact support.",
        tip: "Splitting into smaller withdrawals may help.",
        stage,
        traceId,
        debug: IS_PROD
          ? undefined
          : {
              rawLen,
              estimatedSize,
              ixCount: ixs.length,
              altCount: altAccounts.length,
            },
      });
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    metrics.totalMs = Date.now() - startTime;

    console.log(`[PLUS/WITHDRAW/BUILD] ${traceId} SUCCESS`, {
      buildTimeMs: metrics.totalMs,
      jupUsdWithdraw: safeWithdrawAmount.toString(),
      usdcOut: usdcOutAmount,
      fee: bnToUiString(actualFeeBase, USDC_DECIMALS),
      net: bnToUiString(netBase, USDC_DECIMALS),
      txSize: rawLen,
      slippageBps,
      isFullWithdraw,
      metrics,
    });

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      traceId,

      jupUsdWithdrawUnits: safeWithdrawAmount.toString(),
      usdcOutUnits: usdcOutAmount,
      slippageBps,
      isFullWithdraw,

      decimals: USDC_DECIMALS,
      amountUi: bnToUiString(actualUsdcOutBn, USDC_DECIMALS),
      feeUi: bnToUiString(actualFeeBase, USDC_DECIMALS),
      netUi: bnToUiString(netBase, USDC_DECIMALS),
      feeRate,

      payer: HAVEN_FEEPAYER.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      treasuryUsdcAta: treasuryUsdcAta.toBase58(),
      treasuryOwner: TREASURY_OWNER.toBase58(),

      quote: {
        inAmount: quoteResponse?.inAmount,
        outAmount: quoteResponse?.outAmount,
        otherAmountThreshold: quoteResponse?.otherAmountThreshold,
        priceImpactPct: quoteResponse?.priceImpactPct,
      },

      computeUnits,
      txSize: rawLen,
      buildTimeMs: metrics.totalMs,
      metrics: IS_PROD ? undefined : metrics,
    });
  } catch (e) {
    const err = e as Error & { status?: number; body?: unknown };
    const msg = err instanceof Error ? err.message : String(e);

    // If quote fallback threw, return a nice 400/500 with body in dev
    if (err?.body !== undefined) {
      const status = Number(err.status ?? 400);
      return jsonError(status, {
        code: "JUP_QUOTE_FAILED",
        error: msg,
        userMessage: "Couldn't price this withdrawal right now.",
        tip: "Try again in a moment.",
        stage: "quote",
        traceId,
        debug: IS_PROD
          ? undefined
          : { body: String(err.body).slice(0, 500) },
      });
    }

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
