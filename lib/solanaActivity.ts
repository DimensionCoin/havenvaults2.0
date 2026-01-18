// lib/solanaActivity.ts
import "server-only";

/* =========================
   ENV / CONSTANTS
========================= */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_API_KEY) throw new Error("Missing HELIUS_API_KEY");

const HELIUS_BASE_URL = (
  process.env.HELIUS_BASE_URL || "https://api.helius.xyz"
).replace(/\/+$/, "");

const HELIUS_NETWORK = (process.env.HELIUS_NETWORK || "mainnet-beta") as
  | "mainnet-beta"
  | "devnet"
  | "testnet";

const USDC_MINT_RAW = (process.env.NEXT_PUBLIC_USDC_MINT || "").trim();
if (!USDC_MINT_RAW) throw new Error("Missing NEXT_PUBLIC_USDC_MINT");
const USDC_MINT = USDC_MINT_RAW.toLowerCase();
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS ?? 6);

// Plus Savings (Jupiter Lend)
const PLUS_SAVINGS_VAULT_RAW = (
  process.env.PLUS_SAVINGS_VAULT_ADDR || ""
).trim();
const PLUS_SAVINGS_VAULT = PLUS_SAVINGS_VAULT_RAW
  ? PLUS_SAVINGS_VAULT_RAW.toLowerCase()
  : "";

/* =========================
   TYPES
========================= */

export type ActivityKind = "transfer" | "swap" | "plus" | "perp";

export type ActivityItem = {
  signature: string;
  blockTime: number | null;

  // “direction” is always from the USER POV
  direction: "in" | "out";

  // primary value we display (usually USDC value)
  amountUi: number;

  kind: ActivityKind;

  // optional metadata
  counterparty?: string | null;
  counterpartyLabel?: string | null;
  feeLamports?: number | null;

  // swaps / legs
  swapDirection?: "buy" | "sell";
  swapSoldMint?: string;
  swapSoldAmountUi?: number;
  swapBoughtMint?: string;
  swapBoughtAmountUi?: number;

  // debug / provenance
  source?: string | null;
  involvedAccounts?: string[];
};

/* =========================
   SMALL HELPERS
========================= */

const CACHE_TTL_MS = 10_000;
const CACHE = new Map<string, { ts: number; items: ActivityItem[] }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toStr = (v: unknown) => (typeof v === "string" ? v : "");
const toNum = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const normAddr = (v: unknown) => toStr(v).trim();
const normMint = (v: unknown) => toStr(v).trim().toLowerCase();

const getErrorMessage = (e: unknown) => {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "";
  }
  return "";
};

const looksRateLimited = (e: unknown) =>
  /429|rate limit/i.test(getErrorMessage(e));

async function withBackoff<T>(fn: () => Promise<T>) {
  let last: unknown;
  const tries = 5;
  const base = 350;

  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1 && looksRateLimited(e)) {
        const wait = base * 2 ** i + Math.floor(Math.random() * 120);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  throw last ?? new Error("withBackoff failed");
}

/* =========================
   Helius Enhanced shape (loose)
========================= */

type EnhancedTx = Record<string, unknown>;
type TokenTransfer = Record<string, unknown>;

function getSignature(tx: EnhancedTx): string {
  const sig = toStr(tx.signature);
  if (sig) return sig;

  const txObj = tx.transaction as Record<string, unknown> | undefined;
  const sigs = Array.isArray(txObj?.signatures)
    ? (txObj!.signatures as unknown[])
    : [];
  return toStr(sigs[0]);
}

function getBlockTime(tx: EnhancedTx): number | null {
  const t = toNum(tx.timestamp) || toNum(tx.blockTime);
  return t ? t : null;
}

function getFeeLamports(tx: EnhancedTx): number | null {
  const txObj = tx.transaction as Record<string, unknown> | undefined;
  const fee = toNum(txObj?.fee) || toNum(tx.fee);
  return fee ? fee : null;
}

function getSource(tx: EnhancedTx): string | null {
  return toStr(tx.source) || toStr(tx.type) || null;
}

/* =========================
   Token transfer extraction (Helius-first)
========================= */

/**
 * ✅ FIXED AMOUNT PARSING:
 * - Helius tokenTransfers often provide:
 *   - tokenAmount: UI number
 *   - rawTokenAmount: { tokenAmount: string, decimals: number }
 * - We should not use heuristics like "< 1e9" to guess.
 */
function readUiAmount(rec: Record<string, unknown>, mintNorm: string) {
  const decimals =
    typeof rec.decimals === "number"
      ? rec.decimals
      : rec.rawTokenAmount && typeof rec.rawTokenAmount === "object"
        ? typeof (rec.rawTokenAmount as Record<string, unknown>).decimals ===
          "number"
          ? ((rec.rawTokenAmount as Record<string, unknown>).decimals as number)
          : mintNorm === USDC_MINT
            ? USDC_DECIMALS
            : 0
        : mintNorm === USDC_MINT
          ? USDC_DECIMALS
          : 0;

  // 1) tokenAmount from Helius is UI amount
  if (typeof rec.tokenAmount === "number") return rec.tokenAmount;
  if (typeof rec.tokenAmount === "string") {
    const n = Number(rec.tokenAmount);
    return Number.isFinite(n) ? n : 0;
  }

  // 2) rawTokenAmount.tokenAmount is raw integer string
  const rawTok = rec.rawTokenAmount;
  if (rawTok && typeof rawTok === "object") {
    const o = rawTok as Record<string, unknown>;
    const rawStr = toStr(o.tokenAmount ?? o.amount);
    if (rawStr) {
      const raw = Number(rawStr);
      if (!Number.isFinite(raw)) return 0;
      return decimals > 0 ? raw / Math.pow(10, decimals) : raw;
    }
  }

  // 3) fallback: amount could be raw or UI
  const amt = rec.amount;
  if (typeof amt === "number") {
    if (decimals > 0 && Number.isInteger(amt)) {
      return amt / Math.pow(10, decimals);
    }
    return amt;
  }
  if (typeof amt === "string") {
    const n = Number(amt);
    if (!Number.isFinite(n)) return 0;
    if (decimals > 0 && /^\d+$/.test(amt)) {
      return n / Math.pow(10, decimals);
    }
    return n;
  }

  return 0;
}

function extractTokenTransfers(tx: EnhancedTx): TokenTransfer[] {
  const out: TokenTransfer[] = [];

  // 1) primary: tokenTransfers
  const tts = Array.isArray(tx.tokenTransfers)
    ? (tx.tokenTransfers as unknown[])
    : [];
  for (const t of tts)
    if (t && typeof t === "object") out.push(t as TokenTransfer);

  // 2) optional: events token transfers (rare)
  const ev = (tx.events ?? {}) as Record<string, unknown>;
  const b = Array.isArray(ev.tokenTransfers)
    ? (ev.tokenTransfers as unknown[])
    : [];
  const c = Array.isArray(ev.fungibleTokenTransfers)
    ? (ev.fungibleTokenTransfers as unknown[])
    : [];
  const d = Array.isArray(ev.splTransfers)
    ? (ev.splTransfers as unknown[])
    : [];
  for (const t of [...b, ...c, ...d])
    if (t && typeof t === "object") out.push(t as TokenTransfer);

  return out;
}

function extractInvolvedAccounts(tx: EnhancedTx): string[] {
  const keys = new Set<string>();

  const accountData = tx.accountData;
  if (Array.isArray(accountData)) {
    for (const ad of accountData) {
      if (!ad || typeof ad !== "object") continue;
      const a = toStr((ad as Record<string, unknown>).account);
      if (a) keys.add(a);
    }
  }

  const tts = extractTokenTransfers(tx);
  for (const t of tts) {
    const r = t as Record<string, unknown>;
    const a = toStr(r.fromUserAccount) || toStr(r.from) || toStr(r.source);
    const b = toStr(r.toUserAccount) || toStr(r.to) || toStr(r.destination);
    if (a) keys.add(a);
    if (b) keys.add(b);
    const fa = toStr(r.fromTokenAccount);
    const ta = toStr(r.toTokenAccount);
    if (fa) keys.add(fa);
    if (ta) keys.add(ta);
  }

  return Array.from(keys);
}

/* =========================
   Jupiter Perps (keep your detection)
========================= */

const JUP_PERPS_PROGRAM_ID = "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu";

type JupPerpsAction =
  | "increase"
  | "decrease"
  | "close"
  | "liquidate"
  | "unknown";

function getLogMessages(tx: Record<string, unknown>): string[] {
  const top = Array.isArray(tx.logMessages)
    ? (tx.logMessages as unknown[])
    : [];
  const meta =
    tx.meta && typeof tx.meta === "object"
      ? (tx.meta as Record<string, unknown>)
      : null;
  const metaLogs = Array.isArray(meta?.logMessages)
    ? (meta!.logMessages as unknown[])
    : [];

  const out: string[] = [];
  for (const l of [...top, ...metaLogs]) {
    const s = toStr(l);
    if (s) out.push(s);
  }
  return out;
}

function detectJupPerpsAction(tx: Record<string, unknown>): JupPerpsAction {
  const logs = getLogMessages(tx).join(" | ");
  if (!logs) return "unknown";
  if (/Instruction:\s*IncreasePosition/i.test(logs)) return "increase";
  if (/Instruction:\s*DecreasePosition/i.test(logs)) return "decrease";
  if (/Instruction:\s*ClosePosition/i.test(logs)) return "close";
  if (/liquidat/i.test(logs)) return "liquidate";
  return "unknown";
}

/* =========================
   Core classification helpers
========================= */

type Leg = { mint: string; from: string; to: string; ui: number };

function buildLegs(owner58: string, tx: EnhancedTx) {
  const owner = owner58.trim();
  const transfers = extractTokenTransfers(tx);

  const legs: Leg[] = [];
  let usdcIn = 0;
  let usdcOut = 0;
  let cpIn: string | null = null;
  let cpOut: string | null = null;

  for (const t of transfers) {
    const rec = (t ?? {}) as Record<string, unknown>;

    const mint = normMint(rec.mint ?? rec.tokenAddress ?? rec.mintAddress);
    if (!mint) continue;

    const from =
      normAddr(rec.fromUserAccount) ||
      normAddr(rec.from) ||
      normAddr(rec.source);
    const to =
      normAddr(rec.toUserAccount) ||
      normAddr(rec.to) ||
      normAddr(rec.destination);

    const ui = readUiAmount(rec, mint);
    if (!Number.isFinite(ui) || ui <= 0) continue;

    legs.push({ mint, from, to, ui });

    if (mint === USDC_MINT) {
      if (to === owner) {
        usdcIn += ui;
        if (!cpIn && from) cpIn = from;
      } else if (from === owner) {
        usdcOut += ui;
        if (!cpOut && to) cpOut = to;
      }
    }
  }

  return { legs, usdcIn, usdcOut, cpIn, cpOut };
}

/**
 * ✅ FIXED Plus Savings detection:
 * - We classify Plus deposit/withdraw based on:
 *   - vault involved
 *   - net USDC movement
 * - We DO NOT require jupUSD legs (they’re not always visible in transfers)
 */
function detectPlusSavings(
  owner58: string,
  tx: EnhancedTx,
  legs: Leg[],
  involved: string[],
  usdcIn: number,
  usdcOut: number
): ActivityItem | null {
  if (!PLUS_SAVINGS_VAULT) return null;

  const vaultLower = PLUS_SAVINGS_VAULT.toLowerCase();

  const vaultInvolved =
    involved.some((a) => a.toLowerCase() === vaultLower) ||
    legs.some(
      (l) =>
        l.from.toLowerCase() === vaultLower || l.to.toLowerCase() === vaultLower
    );

  if (!vaultInvolved) return null;

  const sig = getSignature(tx);
  const blockTime = getBlockTime(tx);
  const feeLamports = getFeeLamports(tx);

  // Deposit: user sends USDC out
  if (usdcOut > 0 && usdcOut >= usdcIn) {
    return {
      signature: sig,
      blockTime,
      direction: "out",
      amountUi: usdcOut,
      kind: "plus",
      source: "jupiter-lend",
      involvedAccounts: involved,
      counterparty: PLUS_SAVINGS_VAULT_RAW || null,
      counterpartyLabel: "Plus deposit",
      feeLamports,
    };
  }

  // Withdraw: user receives USDC in
  if (usdcIn > 0) {
    return {
      signature: sig,
      blockTime,
      direction: "in",
      amountUi: usdcIn,
      kind: "plus",
      source: "jupiter-lend",
      involvedAccounts: involved,
      counterparty: PLUS_SAVINGS_VAULT_RAW || null,
      counterpartyLabel: "Plus withdrawal",
      feeLamports,
    };
  }

  return null;
}

/**
 * ✅ Perps detection:
 * If perps program involved, emit a perp row (amount based on USDC delta).
 */
function detectPerps(
  owner58: string,
  tx: EnhancedTx,
  involved: string[],
  usdcIn: number,
  usdcOut: number
): ActivityItem | null {
  const sig = getSignature(tx);
  const blockTime = getBlockTime(tx);
  const feeLamports = getFeeLamports(tx);

  const logs = getLogMessages(tx);
  const isPerp =
    involved.some((a) => a === JUP_PERPS_PROGRAM_ID) ||
    logs.some((l) =>
      /Jupiter Perps Program|IncreasePosition|DecreasePosition|ClosePosition/i.test(
        l
      )
    );

  if (!isPerp) return null;

  const action = detectJupPerpsAction(tx);
  const usdcDelta = usdcIn - usdcOut;
  const direction: "in" | "out" = usdcDelta >= 0 ? "in" : "out";
  const amountUi = Math.abs(usdcDelta);

  return {
    signature: sig,
    blockTime,
    direction,
    amountUi,
    kind: "perp",
    source: "jupiter-perps",
    involvedAccounts: involved,
    counterparty: null,
    feeLamports,
    counterpartyLabel:
      action === "increase"
        ? "Add collateral"
        : action === "decrease"
          ? "Remove collateral"
          : action === "close"
            ? "Close position"
            : action === "liquidate"
              ? "Liquidation"
              : "Multiplier position update",
  };
}

/**
 * ✅ Swap detection:
 * If there’s a USDC leg + a non-USDC leg (and not Plus Savings), treat as swap.
 * Also: if the Plus vault is involved, skip swap classification so Plus owns it.
 */
function detectSwap(
  owner58: string,
  tx: EnhancedTx,
  legs: Leg[],
  usdcIn: number,
  usdcOut: number
): ActivityItem | null {
  const owner = owner58.trim();
  const sig = getSignature(tx);
  const blockTime = getBlockTime(tx);
  const feeLamports = getFeeLamports(tx);

  if (PLUS_SAVINGS_VAULT) {
    const vaultLower = PLUS_SAVINGS_VAULT.toLowerCase();
    const involved = extractInvolvedAccounts(tx);
    if (involved.some((a) => a.toLowerCase() === vaultLower)) return null;
  }

  // Buy: user sends USDC out, receives some token in
  if (usdcOut > 0) {
    let bestIn: Leg | null = null;
    for (const l of legs) {
      if (l.mint === USDC_MINT) continue;
      if (l.to === owner) {
        if (!bestIn || l.ui > bestIn.ui) bestIn = l;
      }
    }
    if (bestIn) {
      return {
        signature: sig,
        blockTime,
        direction: "out",
        amountUi: usdcOut,
        kind: "swap",
        source: getSource(tx),
        involvedAccounts: extractInvolvedAccounts(tx),
        feeLamports,
        counterparty: null,
        swapDirection: "buy",
        swapSoldMint: USDC_MINT_RAW,
        swapSoldAmountUi: usdcOut,
        swapBoughtMint: bestIn.mint,
        swapBoughtAmountUi: bestIn.ui,
      };
    }
  }

  // Sell: user receives USDC in, sends some token out
  if (usdcIn > 0) {
    let bestOut: Leg | null = null;
    for (const l of legs) {
      if (l.mint === USDC_MINT) continue;
      if (l.from === owner) {
        if (!bestOut || l.ui > bestOut.ui) bestOut = l;
      }
    }
    if (bestOut) {
      return {
        signature: sig,
        blockTime,
        direction: "in",
        amountUi: usdcIn,
        kind: "swap",
        source: getSource(tx),
        involvedAccounts: extractInvolvedAccounts(tx),
        feeLamports,
        counterparty: null,
        swapDirection: "sell",
        swapSoldMint: bestOut.mint,
        swapSoldAmountUi: bestOut.ui,
        swapBoughtMint: USDC_MINT_RAW,
        swapBoughtAmountUi: usdcIn,
      };
    }
  }

  return null;
}

/**
 * ✅ USDC Transfer detection:
 * If there is net USDC movement and it’s not a swap/perp/plus, classify as transfer.
 */
function detectUsdcTransfer(
  owner58: string,
  tx: EnhancedTx,
  usdcIn: number,
  usdcOut: number,
  cpIn: string | null,
  cpOut: string | null,
  involved: string[]
): ActivityItem | null {
  const sig = getSignature(tx);
  const blockTime = getBlockTime(tx);
  const feeLamports = getFeeLamports(tx);

  const delta = usdcIn - usdcOut;
  if (!delta) return null;

  const direction: "in" | "out" = delta > 0 ? "in" : "out";
  const amountUi = Math.abs(delta);
  const counterparty = direction === "in" ? cpIn : cpOut;

  return {
    signature: sig,
    blockTime,
    direction,
    amountUi,
    kind: "transfer",
    source: getSource(tx),
    involvedAccounts: involved,
    feeLamports,
    counterparty: counterparty || null,
  };
}

/* =========================
   Single TX → ActivityItem
========================= */

function parseEnhancedTxToActivity(
  owner58: string,
  raw: unknown
): ActivityItem | null {
  const tx = (raw ?? {}) as EnhancedTx;

  const involved = extractInvolvedAccounts(tx);
  const { legs, usdcIn, usdcOut, cpIn, cpOut } = buildLegs(owner58, tx);

  // 1) Perps first
  const perps = detectPerps(owner58, tx, involved, usdcIn, usdcOut);
  if (perps) return perps;

  // 2) Plus Savings (Jup Lend)
  const plus = detectPlusSavings(owner58, tx, legs, involved, usdcIn, usdcOut);
  if (plus) return plus;

  // 3) Swaps
  const swap = detectSwap(owner58, tx, legs, usdcIn, usdcOut);
  if (swap) return swap;

  // 4) Transfers (USDC only)
  const transfer = detectUsdcTransfer(
    owner58,
    tx,
    usdcIn,
    usdcOut,
    cpIn,
    cpOut,
    involved
  );
  if (transfer) return transfer;

  // otherwise irrelevant
  return null;
}

/* =========================
   Helius fetch
========================= */

async function heliusFetchAddressTxs(
  owner58: string,
  opts: { limit: number; before?: string }
) {
  const base = `${HELIUS_BASE_URL}/v0/addresses/${encodeURIComponent(
    owner58
  )}/transactions`;

  const qs = new URLSearchParams({
    "api-key": HELIUS_API_KEY!,
    network: HELIUS_NETWORK,
    limit: String(opts.limit),
  });

  if (opts.before) qs.set("before", opts.before);

  const url = `${base}?${qs.toString()}`;

  return withBackoff(async () => {
    const r = await fetch(url, { method: "GET", next: { revalidate: 0 } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Helius ${r.status}: ${text || r.statusText}`);
    }
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? (j as unknown[]) : [];
  });
}

/* =========================
   PUBLIC: get activity for owner
========================= */

export async function getUsdcActivityForOwner(
  owner58: string,
  opts?: { limit?: number; before?: string }
): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);

  const cacheKey = `${owner58}|${opts?.before || ""}|${limit}|${HELIUS_NETWORK}|v3`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items;

  // We fetch more than needed because we filter out irrelevant txs.
  const RAW_PAGE_LIMIT = 100;
  const MAX_PAGES = 5;

  let before = opts?.before;
  const out: ActivityItem[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const raw = await heliusFetchAddressTxs(owner58, {
      limit: RAW_PAGE_LIMIT,
      before,
    });

    if (!raw.length) break;

    // update cursor
    const last = raw[raw.length - 1] as EnhancedTx;
    const lastSig = getSignature(last);
    before = lastSig || before;

    for (const tx of raw) {
      const row = parseEnhancedTxToActivity(owner58, tx);
      if (row) out.push(row);
      if (out.length >= limit) break;
    }

    if (out.length >= limit) break;
    if (!lastSig) break;
  }

  const items = out.slice(0, limit);
  CACHE.set(cacheKey, { ts: Date.now(), items });
  return items;
}
