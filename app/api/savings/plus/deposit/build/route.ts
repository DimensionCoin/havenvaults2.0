// app/api/savings/plus/deposit/build/route.ts
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

import { rateLimitServer } from "@/lib/rateLimitServer";
import { requireServerUser, getUserWalletPubkey } from "@/lib/getServerUser";

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
  otherAmountThreshold?: string; // <-- IMPORTANT: minOut after slippage
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

/**
 * Minimal structural type for getUserWalletPubkey().
 * Keep in sync with lib/getServerUser.ts
 */
type UserWithWalletLike = {
  walletAddress?: string | null;
  depositWallet?: string | { address?: string | null } | null;
  embeddedWallet?: string | { address?: string | null } | null;
};

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

const IS_PROD = process.env.NODE_ENV === "production";

/* ───────── Jupiter endpoints ───────── */

const JUP_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUP_SWAP_IXS = "https://api.jup.ag/swap/v1/swap-instructions";
const JUP_EARN_DEPOSIT_IX =
  "https://api.jup.ag/lend/v1/earn/deposit-instructions";

/* ───────── Constants ───────── */

// Mainnet USDC
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
// JupUSD mint
const JUPUSD_MINT = new PublicKey(
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
);

const MAX_TX_RAW_BYTES = 1232;

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// Reliability knobs
const API_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 150;

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
  },
) {
  console.error(
    "[/api/savings/plus/deposit/build]",
    status,
    payload.code,
    payload.error,
    !IS_PROD && payload.debug ? { debug: payload.debug } : "",
  );
  const responsePayload = IS_PROD ? { ...payload, debug: undefined } : payload;
  return NextResponse.json(responsePayload, { status });
}

/* ───────── Token helpers ───────── */

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

/* ───────── ALT helper ───────── */

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

/* ───────── Jupiter fetch with retry + timeout ───────── */

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

      // Retry on rate limit / transient
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt === maxRetries) return res;
        const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
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
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new Error("Jupiter fetch failed");
}

/* ───────── Amount parsing (BIGINT-safe) ───────── */

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
  traceId: string,
): TransactionInstruction {
  try {
    return toIx(obj);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[PLUS/DEPOSIT/BUILD] ${traceId} bad ix in ${label}[${index}]: ${msg}`,
    );
    if (!IS_PROD) {
      console.error(
        `[PLUS/DEPOSIT/BUILD] ${traceId} ${label}[${index}] preview:`,
        safePreview(obj),
      );
    }
    throw e;
  }
}

/* ───────── Sponsored ATA rewrite ───────── */

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
    `[PLUS/DEPOSIT/BUILD] ${traceId} ATA summary: ${sponsored.length} sponsored, ${other.length} other`,
  );

  return { sponsoredAtaIxs: sponsored, otherIxs: other };
}

/* ───────── Quote helper with fallbacks ───────── */

async function fetchQuoteWithFallbacks(opts: {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint;
  slippageBps: number;
  traceId: string;
}): Promise<{ quote: JupiterQuoteResponse; urlUsed: string }> {
  const { inputMint, outputMint, amount, slippageBps, traceId } = opts;

  const attempts: Array<{
    maxAccounts: number;
    onlyDirect: boolean;
    restrict: boolean;
  }> = [
    { maxAccounts: 8, onlyDirect: true, restrict: true },
    { maxAccounts: 20, onlyDirect: false, restrict: true },
    { maxAccounts: 40, onlyDirect: false, restrict: false },
  ];

  let lastBody = "";
  for (const a of attempts) {
    const url =
      `${JUP_QUOTE}?` +
      new URLSearchParams({
        inputMint: inputMint.toBase58(),
        outputMint: outputMint.toBase58(),
        amount: amount.toString(),
        slippageBps: String(slippageBps),
        maxAccounts: String(a.maxAccounts),
        onlyDirectRoutes: String(a.onlyDirect),
        restrictIntermediateTokens: String(a.restrict),
      });

    const res = await jupFetchWithRetry(url);

    if (res.ok) {
      const quote = (await res.json()) as JupiterQuoteResponse;
      return { quote, urlUsed: url };
    }

    lastBody = await res.text().catch(() => "");
    console.warn(
      `[PLUS/DEPOSIT/BUILD] ${traceId} quote failed (${res.status}) with maxAccounts=${a.maxAccounts}, onlyDirect=${a.onlyDirect}, restrict=${a.restrict}. body=${lastBody.slice(0, 240)}`,
    );
  }

  throw new Error(
    `Quote failed for all attempts. Last body: ${lastBody.slice(0, 500)}`,
  );
}

/* ───────── ROUTE ───────── */

export async function POST(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();
  let stage = "init";

  try {
    // ─────────── Auth (cookie session) ───────────
    let authedUserPk: PublicKey;
    try {
      const user = (await requireServerUser()) as unknown as UserWithWalletLike;
      authedUserPk = getUserWalletPubkey(user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unauthorized";
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: msg,
        userMessage: "Please log in again.",
        tip: "Refresh the app and try again.",
        stage,
        traceId,
      });
    }

    // ─────────── Rate limit (AFTER auth, BEFORE heavy work) ───────────
    const blocked = await rateLimitServer(req, {
      api: "plus:deposit:build",
      requireAuth: true,
      allowIpFallback: false,
      failMode: "closed",
      // double-click + normal usage + abuse cap
      tiers: [
        { limit: 2, windowMs: 2000, suffix: "burst" },
        { limit: 8, windowMs: 60_000, suffix: "minute" },
        { limit: 60, windowMs: 60 * 60_000, suffix: "hour" },
      ],
      // protect infra even if attacker rotates accounts
      globalTiers: [
        { limit: 50, windowMs: 2000, suffix: "burst" },
        { limit: 400, windowMs: 60_000, suffix: "minute" },
      ],
    });
    if (blocked) return blocked;

    // ─────────── Parse Body ───────────
    stage = "parseBody";
    const body = (await req.json().catch(() => null)) as RequestBody | null;

    const fromOwnerBase58 = body?.fromOwnerBase58?.trim() ?? "";
    const slippageBps = Number.isFinite(body?.slippageBps)
      ? Math.max(10, Math.min(10_000, Number(body?.slippageBps)))
      : 50;

    if (!fromOwnerBase58) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Missing fromOwnerBase58",
        userMessage: "Something went wrong preparing this deposit.",
        tip: "Please refresh and try again.",
        stage,
        traceId,
      });
    }

    // ─────────── Bind request wallet to authenticated user ───────────
    stage = "authWalletCheck";
    let userOwner: PublicKey;
    try {
      userOwner = new PublicKey(fromOwnerBase58);
    } catch {
      return jsonError(400, {
        code: "INVALID_WALLET",
        error: "Invalid fromOwnerBase58",
        userMessage: "Something went wrong. Please try again.",
        tip: "Refresh the app and try again.",
        stage,
        traceId,
      });
    }

    if (!userOwner.equals(authedUserPk)) {
      return jsonError(403, {
        code: "WALLET_MISMATCH",
        error: "fromOwnerBase58 does not match authenticated user wallet",
        userMessage: "This request doesn't match your account.",
        tip: "Log out and back in, then try again.",
        stage,
        traceId,
        debug: IS_PROD
          ? undefined
          : {
              authed: authedUserPk.toBase58(),
              provided: userOwner.toBase58(),
            },
      });
    }

    // ─────────── Continue original logic ───────────
    const conn = getConnection();

    stage = "tokenInfo";
    const usdcProgId = await getTokenProgramId(conn, USDC_MINT);
    const usdcDecimals = await getDecimals(conn, USDC_MINT);

    stage = "amount";
    const amountUiRaw = readAmountUi(body);
    let amountUnits = BigInt(0);

    if (amountUiRaw) {
      amountUnits = parseUiAmountToUnits(amountUiRaw, usdcDecimals);
    } else {
      const n = Number(body?.amountUnits ?? 0);
      amountUnits =
        Number.isFinite(n) && n > 0 ? BigInt(Math.floor(n)) : BigInt(0);
    }

    console.log("[PLUS/DEPOSIT/BUILD] payload", {
      traceId,
      fromOwnerBase58,
      amountUiRaw,
      amountUnits: amountUnits.toString(),
      slippageBps,
    });

    if (amountUnits <= BigInt(0)) {
      return jsonError(400, {
        code: "INVALID_AMOUNT",
        error: "Amount must be > 0",
        userMessage: "Please enter an amount.",
        tip: "Try again.",
        stage,
        traceId,
        debug: {
          amountUiRaw,
          amountUnits: amountUnits.toString(),
          keysPresent: body ? Object.keys(body) : [],
        },
      });
    }

    stage = "balanceCheck";
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      userOwner,
      false,
      usdcProgId,
    );

    const balResp = await conn
      .getTokenAccountBalance(userUsdcAta, "confirmed")
      .catch(() => null);
    const available = BigInt(balResp?.value?.amount || "0");

    if (available < amountUnits) {
      return jsonError(400, {
        code: "INSUFFICIENT_BALANCE",
        error: `need=${amountUnits.toString()}, have=${available.toString()}`,
        userMessage: "You don't have enough USDC.",
        tip: "Try a smaller amount.",
        stage,
        traceId,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 1: Quote USDC → JupUSD
    // ─────────────────────────────────────────────────────────────
    stage = "quote";
    const [blockhashData, quotePack] = await Promise.all([
      conn.getLatestBlockhash("confirmed"),
      fetchQuoteWithFallbacks({
        inputMint: USDC_MINT,
        outputMint: JUPUSD_MINT,
        amount: amountUnits,
        slippageBps,
        traceId,
      }),
    ]);

    const quoteResponse = quotePack.quote;

    const outAmount = String(quoteResponse?.outAmount ?? "");
    const minOut = String(quoteResponse?.otherAmountThreshold ?? "");

    if (
      !outAmount ||
      !/^\d+$/.test(outAmount) ||
      !minOut ||
      !/^\d+$/.test(minOut)
    ) {
      return jsonError(500, {
        code: "BAD_QUOTE",
        error: "Quote missing outAmount/otherAmountThreshold",
        userMessage: "Couldn't prepare this deposit route.",
        tip: "Try again in a moment.",
        stage,
        traceId,
        debug: { quoteResponse, urlUsed: quotePack.urlUsed },
      });
    }

    const jupUsdDepositAmount = minOut;

    // ─────────────────────────────────────────────────────────────
    // STEP 2: Swap instructions (USDC → JupUSD)
    // ─────────────────────────────────────────────────────────────
    stage = "swapInstructions";
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

    if (!swapIxRes.ok) {
      const t = await swapIxRes.text().catch(() => "");
      return jsonError(swapIxRes.status, {
        code: "JUP_SWAP_IX_FAILED",
        error: `swap-instructions failed: ${swapIxRes.status}`,
        userMessage: "Couldn't prepare this deposit.",
        tip:
          swapIxRes.status === 429
            ? "Too many requests. Wait a moment."
            : "Try again in a moment.",
        stage,
        traceId,
        debug: { body: t.slice(0, 800) },
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

    // ─────────────────────────────────────────────────────────────
    // STEP 3: Earn deposit instructions (JupUSD → JupUSD Vault)
    // ─────────────────────────────────────────────────────────────
    stage = "earnDepositInstruction";
    const earnIxRes = await jupFetchWithRetry(JUP_EARN_DEPOSIT_IX, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: JUPUSD_MINT.toBase58(),
        signer: userOwner.toBase58(),
        amount: jupUsdDepositAmount,
      }),
    });

    if (!earnIxRes.ok) {
      const t = await earnIxRes.text().catch(() => "");
      return jsonError(earnIxRes.status, {
        code: "EARN_DEPOSIT_IX_FAILED",
        error: `deposit-instructions failed: ${earnIxRes.status}`,
        userMessage: "Couldn't prepare the vault deposit.",
        tip:
          earnIxRes.status === 429
            ? "Too many requests. Wait a moment."
            : "Try again in a moment.",
        stage,
        traceId,
        debug: { body: t.slice(0, 800) },
      });
    }

    const earnJson = (await earnIxRes.json()) as JupiterEarnResponse | null;
    const earnList: unknown[] = Array.isArray(earnJson?.instructions)
      ? earnJson.instructions
      : earnJson
        ? [earnJson]
        : [];

    if (!earnList.length) {
      return jsonError(500, {
        code: "NO_EARN_IX",
        error: "Earn deposit endpoint returned no instructions",
        userMessage: "Couldn't prepare the vault deposit.",
        tip: "Try again in a moment.",
        stage,
        traceId,
        debug: { earnJsonKeys: earnJson ? Object.keys(earnJson) : [] },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 4: Load ALTs
    // ─────────────────────────────────────────────────────────────
    stage = "loadALTs";
    const altKeys = (swapData.addressLookupTableAddresses ?? []).slice(0, 16);
    const altAccounts = (
      await Promise.all(altKeys.map((k: string) => getAltCached(conn, k)))
    ).filter((a): a is AddressLookupTableAccount => a !== null);

    // ─────────────────────────────────────────────────────────────
    // STEP 5: Decode instructions
    // ─────────────────────────────────────────────────────────────
    stage = "buildInstructions";

    const swapSetupIxs = (swapData.setupInstructions ?? []).map(
      (x: InstructionJson, i: number) => safeToIx(x, "swapSetup", i, traceId),
    );
    const swapIx = safeToIx(swapData.swapInstruction, "swap", 0, traceId);
    const swapCleanupIxs = (swapData.cleanupInstructions ?? []).map(
      (x: InstructionJson, i: number) => safeToIx(x, "swapCleanup", i, traceId),
    );
    const earnIxs = earnList.map((x, i) => safeToIx(x, "earn", i, traceId));

    const allInstructionsInOrder: TransactionInstruction[] = [
      ...swapSetupIxs,
      swapIx,
      ...swapCleanupIxs,
      ...earnIxs,
    ];

    const { sponsoredAtaIxs, otherIxs } = collectAndSponsorAtas(
      allInstructionsInOrder,
      traceId,
    );

    // ─────────────────────────────────────────────────────────────
    // STEP 6: Add compute budget + final ordering
    // ─────────────────────────────────────────────────────────────
    stage = "finalizeInstructions";

    const ixs: TransactionInstruction[] = [];

    ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 }));
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
    );

    ixs.push(...sponsoredAtaIxs);
    ixs.push(...otherIxs);

    // ─────────────────────────────────────────────────────────────
    // STEP 7: Compile transaction
    // ─────────────────────────────────────────────────────────────
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
    if (rawLen > MAX_TX_RAW_BYTES) {
      return jsonError(413, {
        code: "TX_TOO_LARGE",
        error: `Raw size ${rawLen} > ${MAX_TX_RAW_BYTES}`,
        userMessage: "This route is too large. Try a smaller amount.",
        tip: "If this happens often, we can tighten quote params further.",
        stage,
        traceId,
        debug: {
          rawLen,
          ixCount: ixs.length,
          altCount: altAccounts.length,
        },
      });
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    const buildTime = Date.now() - startTime;

    console.log(
      `[PLUS/DEPOSIT/BUILD] ${traceId} SUCCESS ${buildTime}ms usdcIn=${amountUnits.toString()} jupUsdOut=${outAmount} jupUsdDeposit(minOut)=${jupUsdDepositAmount} txSize=${rawLen}`,
    );

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      traceId,

      usdcInUnits: amountUnits.toString(),
      jupUsdQuotedOutUnits: outAmount,
      jupUsdDepositUnits: jupUsdDepositAmount,
      slippageBps,

      payer: HAVEN_FEEPAYER.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),

      quote: {
        inAmount: quoteResponse?.inAmount,
        outAmount: quoteResponse?.outAmount,
        otherAmountThreshold: quoteResponse?.otherAmountThreshold,
        priceImpactPct: quoteResponse?.priceImpactPct,
      },

      debug: IS_PROD
        ? undefined
        : {
            quoteUrlUsed: quotePack.urlUsed,
            altKeys,
            txSize: rawLen,
            ixCount: ixs.length,
          },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[PLUS/DEPOSIT/BUILD] ${traceId} error at ${stage}:`, msg);

    return jsonError(500, {
      code: "UNHANDLED_BUILD_ERROR",
      error: msg,
      userMessage: "Couldn't prepare this deposit.",
      tip: "Please try again.",
      stage,
      traceId,
    });
  }
}
