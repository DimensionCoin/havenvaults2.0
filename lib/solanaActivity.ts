// lib/solanaActivity.ts
import "server-only";

/**
 * Required env:
 *  - HELIUS_API_KEY
 *  - NEXT_PUBLIC_USDC_MINT
 *
 * Optional:
 *  - HELIUS_NETWORK = mainnet-beta | devnet | testnet (default: mainnet-beta)
 *  - HELIUS_BASE_URL (default: https://api.helius.xyz)
 *  - USDC_DECIMALS (default: 6)
 */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_API_KEY) throw new Error("Missing HELIUS_API_KEY");

const USDC_MINT_RAW = (process.env.NEXT_PUBLIC_USDC_MINT || "").trim();
if (!USDC_MINT_RAW) throw new Error("Missing NEXT_PUBLIC_USDC_MINT");

const USDC_MINT = USDC_MINT_RAW.toLowerCase();
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS ?? 6);

const HELIUS_BASE_URL = (
  process.env.HELIUS_BASE_URL || "https://api.helius.xyz"
).replace(/\/+$/, "");

const HELIUS_NETWORK = (process.env.HELIUS_NETWORK || "mainnet-beta") as
  | "mainnet-beta"
  | "devnet"
  | "testnet";

/* =========================
   TYPES
========================= */

export type ActivityKind = "transfer" | "swap";

export type ActivityItem = {
  signature: string;
  blockTime: number | null;

  /**
   * "Statement amount column" is always the USDC-side delta.
   * - direction=in  => received USDC
   * - direction=out => spent/sent USDC (includes swaps)
   */
  direction: "in" | "out";
  amountUi: number; // absolute USDC amount (ui units, e.g. 12.34)

  counterparty?: string | null;
  counterpartyLabel?: string | null;

  feeLamports?: number | null;

  kind: ActivityKind;

  // ✅ "buy" = spent USDC for token, "sell" = sold token for USDC
  // NOTE: token↔token swaps (no USDC) will leave this undefined
  swapDirection?: "buy" | "sell";

  swapSoldMint?: string;
  swapSoldAmountUi?: number;
  swapBoughtMint?: string;
  swapBoughtAmountUi?: number;

  source?: string | null;
};

/* =========================
   HELPERS
========================= */

const CACHE_TTL_MS = 10_000;
const CACHE = new Map<string, { ts: number; items: ActivityItem[] }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getErrorMessage = (e: unknown) => {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    return typeof msg === "string" ? msg : "";
  }
  return "";
};

const looksRateLimited = (e: unknown) => {
  const msg = getErrorMessage(e);
  return /429|Too Many Requests|rate limit/i.test(msg);
};

async function withBackoff<T>(fn: () => Promise<T>) {
  let last: unknown;
  const tries = 4;
  const base = 300;

  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1 && looksRateLimited(e)) {
        const wait = base * 2 ** i + Math.floor(Math.random() * 100);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  throw last ?? new Error("withBackoff failed");
}

const toNum = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const toStr = (v: unknown) => (typeof v === "string" ? v : "");

const normAddr = (v: unknown) => toStr(v).trim();
const normMint = (v: unknown) => toStr(v).trim().toLowerCase();

/**
 * ✅ Key fix: Helius sometimes gives "amount" already in UI units.
 * This function decides whether to divide by decimals.
 *
 * Rules:
 * - If value has a decimal point => treat as UI (DON'T divide)
 * - If it's a small-ish number (heuristic) => treat as UI
 * - Otherwise treat as base units => divide
 */
function toUiSmart(raw: unknown, decimals: number) {
  if (raw == null) return 0;

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return 0;
    if (s.includes(".")) {
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;

    // heuristic: if it's not huge, it's likely already UI
    // (base units for USDC are usually millions+ even for small transfers)
    if (Math.abs(n) < 1e9) return n;

    return n / Math.pow(10, decimals);
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return 0;

    // if not an integer or relatively small, assume UI
    if (!Number.isInteger(raw) || Math.abs(raw) < 1e9) return raw;

    return raw / Math.pow(10, decimals);
  }

  // fallback
  const n = toNum(raw);
  if (!n) return 0;
  if (Math.abs(n) < 1e9) return n;
  return n / Math.pow(10, decimals);
}

/**
 * Pull amount from a token transfer record robustly.
 */
function readUiAmount(rec: Record<string, unknown>, mintNorm: string) {
  const tokenAmountObj = rec.tokenAmount ?? rec.rawTokenAmount ?? rec.amount;

  const decimals = (() => {
    if (typeof rec.decimals === "number") return rec.decimals;
    if (tokenAmountObj && typeof tokenAmountObj === "object") {
      const tokenDec = (tokenAmountObj as Record<string, unknown>).decimals;
      if (typeof tokenDec === "number") return tokenDec;
    }
    return mintNorm === USDC_MINT ? USDC_DECIMALS : 0;
  })();

  // Prefer explicit ui fields when present
  if (tokenAmountObj && typeof tokenAmountObj === "object") {
    const tokenAmountRec = tokenAmountObj as Record<string, unknown>;
    const uiCandidate =
      tokenAmountRec.uiAmount ??
      tokenAmountRec.uiAmountString ??
      tokenAmountRec.ui_amount ??
      tokenAmountRec.ui_amount_string;

    if (uiCandidate != null) {
      const n = Number(uiCandidate);
      return Number.isFinite(n) ? n : 0;
    }

    const raw =
      tokenAmountRec.amount ??
      tokenAmountRec.value ??
      tokenAmountRec.rawAmount ??
      tokenAmountObj;

    return toUiSmart(raw, decimals || 0);
  }

  return toUiSmart(tokenAmountObj, decimals || 0);
}

/**
 * Helius returns token transfers in a few possible places depending on tx type.
 */
type TokenTransferRecord = Record<string, unknown>;

function extractTokenTransfers(
  tx: Record<string, unknown>
): TokenTransferRecord[] {
  const a = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];

  const ev = (tx.events ?? {}) as Record<string, unknown>;
  const b = Array.isArray(ev.tokenTransfers) ? ev.tokenTransfers : [];
  const c = Array.isArray(ev.fungibleTokenTransfers)
    ? ev.fungibleTokenTransfers
    : [];
  const d = Array.isArray(ev.splTransfers) ? ev.splTransfers : [];

  return [...a, ...b, ...c, ...d];
}

/**
 * Determine:
 * - net USDC delta for owner
 * - counterparty for transfers
 * - swap detection for:
 *   - USDC ↔ token swaps (your original)
 *   - ✅ token ↔ token swaps where NO USDC is involved (added)
 */
function normalizeToActivity(
  owner58: string,
  raw: unknown
): ActivityItem | null {
  const tx = (raw ?? {}) as Record<string, unknown>;
  const owner = owner58.trim();

  const txTransaction =
    tx.transaction && typeof tx.transaction === "object"
      ? (tx.transaction as Record<string, unknown>)
      : null;

  const sig =
    toStr(tx.signature) ||
    (Array.isArray(txTransaction?.signatures)
      ? toStr(txTransaction.signatures[0])
      : "");

  const blockTime: number | null =
    toNum(tx.timestamp) ||
    (typeof tx.blockTime === "number" ? tx.blockTime : null);

  const feeLamports: number | null = (() => {
    const fee = toNum(txTransaction?.fee) || toNum(tx.fee);
    return fee ? fee : null;
  })();

  const source: string | null = toStr(tx.source) || toStr(tx.type) || null;

  const transfers = extractTokenTransfers(tx);

  type Xfer = { mint: string; from: string; to: string; ui: number };
  const parsed: Xfer[] = [];

  let usdcIn = 0;
  let usdcOut = 0;
  let cpIn: string | null = null;
  let cpOut: string | null = null;

  for (const t of transfers) {
    const rec = (t ?? {}) as Record<string, unknown>;

    const tokenObj =
      rec.token && typeof rec.token === "object"
        ? (rec.token as Record<string, unknown>)
        : null;

    const mint =
      toStr(rec.mint) ||
      toStr(rec.tokenAddress) ||
      toStr(rec.mintAddress) ||
      toStr(tokenObj?.mint);

    const mintNorm = normMint(mint);
    if (!mintNorm) continue;

    const from =
      normAddr(rec.fromUserAccount) ||
      normAddr(rec.from) ||
      normAddr(rec.source);

    const to =
      normAddr(rec.toUserAccount) ||
      normAddr(rec.to) ||
      normAddr(rec.destination);

    const ui = readUiAmount(rec, mintNorm);
    if (!Number.isFinite(ui) || ui <= 0) continue;

    parsed.push({ mint: mintNorm, from, to, ui });

    if (mintNorm === USDC_MINT) {
      if (to === owner) {
        usdcIn += ui;
        if (!cpIn && from) cpIn = from;
      } else if (from === owner) {
        usdcOut += ui;
        if (!cpOut && to) cpOut = to;
      }
    }
  }

  const usdcDelta = usdcIn - usdcOut;

  // ✅ ADD-ON: token↔token swap detection when NO USDC moved
  // We only return a swap if:
  //  - owner sent some non-USDC token out
  //  - owner received some non-USDC token in
  //  - (and mints differ)
  if (!usdcDelta) {
    let bestIn: Xfer | null = null; // non-USDC received by owner
    let bestOut: Xfer | null = null; // non-USDC sent by owner

    for (const x of parsed) {
      if (x.mint === USDC_MINT) continue;

      if (x.to === owner) {
        if (!bestIn || x.ui > bestIn.ui) bestIn = x;
      } else if (x.from === owner) {
        if (!bestOut || x.ui > bestOut.ui) bestOut = x;
      }
    }

    // require both legs and different mints
    if (bestIn && bestOut && bestIn.mint !== bestOut.mint) {
      const item: ActivityItem = {
        signature: sig,
        blockTime,
        // no USDC delta; pick a stable direction convention:
        // treat as "out" because we "sold" bestOut.mint to buy bestIn.mint
        direction: "out",
        amountUi: 0, // no USDC amount
        counterparty: null,
        feeLamports,
        kind: "swap",
        source,

        // no buy/sell because USDC isn’t involved
        swapSoldMint: bestOut.mint,
        swapSoldAmountUi: bestOut.ui,
        swapBoughtMint: bestIn.mint,
        swapBoughtAmountUi: bestIn.ui,
      };

      return item;
    }

    // otherwise: not a USDC activity and not a token↔token swap we can confidently label
    return null;
  }

  const direction: "in" | "out" = usdcDelta > 0 ? "in" : "out";
  const amountUiAbs = Math.abs(usdcDelta);

  // ✅ Swap detection:
  // - BUY:  USDC out + non-USDC token in  (direction = "out")
  // - SELL: non-USDC token out + USDC in  (direction = "in")
  let kind: ActivityKind = "transfer";
  let swapBoughtMint: string | undefined;
  let swapBoughtAmountUi: number | undefined;
  let swapSoldMint: string | undefined;
  let swapSoldAmountUi: number | undefined;
  let swapDirection: "buy" | "sell" | undefined;

  if (direction === "out") {
    // BUY case: spent USDC, received a token
    let best: Xfer | null = null;
    for (const x of parsed) {
      if (x.mint === USDC_MINT) continue;
      if (x.to === owner) {
        if (!best || x.ui > best.ui) best = x;
      }
    }
    if (best) {
      kind = "swap";
      swapDirection = "buy";
      swapSoldMint = USDC_MINT_RAW;
      swapSoldAmountUi = usdcOut || amountUiAbs;
      swapBoughtMint = best.mint;
      swapBoughtAmountUi = best.ui;
    }
  } else {
    // SELL case: sent a token, received USDC
    let best: Xfer | null = null;
    for (const x of parsed) {
      if (x.mint === USDC_MINT) continue;
      if (x.from === owner) {
        if (!best || x.ui > best.ui) best = x;
      }
    }
    if (best) {
      kind = "swap";
      swapDirection = "sell";
      swapSoldMint = best.mint;
      swapSoldAmountUi = best.ui;
      swapBoughtMint = USDC_MINT_RAW;
      swapBoughtAmountUi = usdcIn || amountUiAbs;
    }
  }

  const counterparty = direction === "in" ? cpIn : cpOut;

  const item: ActivityItem = {
    signature: sig,
    blockTime,
    direction,
    amountUi: amountUiAbs,
    counterparty: kind === "transfer" ? counterparty : null,
    feeLamports,
    kind,
    source,
  };

  if (kind === "swap") {
    item.swapDirection = swapDirection;
    item.swapSoldMint = swapSoldMint;
    item.swapSoldAmountUi = swapSoldAmountUi;
    item.swapBoughtMint = swapBoughtMint;
    item.swapBoughtAmountUi = swapBoughtAmountUi;

    // For display: amountUi = USDC amount (what you spent for buy, what you received for sell)
    item.amountUi = amountUiAbs;
    item.counterparty = null;
  }

  return item;
}

/* =========================
   PUBLIC EXPORT
========================= */

export async function getUsdcActivityForOwner(
  owner58: string,
  opts?: { limit?: number; before?: string }
): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
  const before = opts?.before;

  const cacheKey = `${owner58}|${before || ""}|${limit}|${HELIUS_NETWORK}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items;

  const base = `${HELIUS_BASE_URL}/v0/addresses/${encodeURIComponent(
    owner58
  )}/transactions`;

  const qs = new URLSearchParams({
    "api-key": HELIUS_API_KEY!,
    network: HELIUS_NETWORK,
    limit: String(limit),
  });

  if (before) qs.set("before", before);

  const url = `${base}?${qs.toString()}`;

  const raw = await withBackoff(async () => {
    const r = await fetch(url, { method: "GET", next: { revalidate: 0 } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Helius ${r.status}: ${text || r.statusText}`);
    }
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? (j as unknown[]) : [];
  });

  const items: ActivityItem[] = [];
  for (const tx of raw) {
    const row = normalizeToActivity(owner58, tx);
    if (row) items.push(row);
  }

  CACHE.set(cacheKey, { ts: Date.now(), items });
  return items;
}
