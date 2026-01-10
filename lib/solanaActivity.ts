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

  direction: "in" | "out";
  amountUi: number; // absolute USDC amount (UI)

  counterparty?: string | null; // wallet address if possible
  counterpartyLabel?: string | null;

  feeLamports?: number | null;

  kind: ActivityKind;

  swapSoldMint?: string;
  swapSoldAmountUi?: number;
  swapBoughtMint?: string;
  swapBoughtAmountUi?: number;

  source?: string | null;

  /**
   * ✅ NEW (optional) – does NOT break existing pages
   * - accounts: top-level account keys for the tx (wallets, programs, vaults, etc.)
   * - tokenAccounts: token accounts owned by owner involved in this tx (best-effort)
   */
  accounts?: string[];
  tokenAccounts?: string[];
};

type Json = Record<string, unknown>;

/** Parsed inner instruction shapes we care about */
type InnerParsedTransferInfo = {
  source?: unknown;
  destination?: unknown;
  amount?: unknown; // transfer
  tokenAmount?: {
    amount?: unknown;
    decimals?: unknown;
    uiAmount?: unknown;
    uiAmountString?: unknown;
  };
};

type InnerParsed = {
  type?: unknown; // "transfer" | "transferChecked"
  info?: InnerParsedTransferInfo;
};

type InnerInstruction = {
  program?: unknown; // "spl-token"
  programId?: unknown; // Tokenkeg...
  parsed?: InnerParsed;
};

type InnerInstructionGroup = {
  instructions?: unknown; // InnerInstruction[]
};

type TokenBalance = {
  accountIndex?: unknown; // number
  mint?: unknown; // string
  owner?: unknown; // string
  uiTokenAmount?: {
    decimals?: unknown; // number
  };
};

type TxMeta = {
  innerInstructions?: unknown; // InnerInstructionGroup[]
  preTokenBalances?: unknown; // TokenBalance[]
  postTokenBalances?: unknown; // TokenBalance[]
};

type TxMessageAccountKey =
  | string
  | {
      pubkey?: unknown;
      writable?: unknown;
      signer?: unknown;
      source?: unknown;
    };

type TxMessage = {
  accountKeys?: unknown; // TxMessageAccountKey[]
};

type TxTransaction = {
  signatures?: unknown; // string[]
  message?: unknown; // TxMessage
  fee?: unknown; // number
};

type HeliusTx = {
  signature?: unknown;
  timestamp?: unknown;
  blockTime?: unknown;
  source?: unknown;
  type?: unknown;
  fee?: unknown;

  transaction?: unknown; // TxTransaction
  meta?: unknown; // TxMeta

  tokenTransfers?: unknown;
  events?: unknown;
};

/** Normalized transfer record we parse downstream */
type TokenTransferRecord = {
  mint?: unknown;
  tokenAddress?: unknown;
  mintAddress?: unknown;
  token?: unknown;

  fromUserAccount?: unknown;
  toUserAccount?: unknown;
  from?: unknown;
  to?: unknown;
  source?: unknown;
  destination?: unknown;

  // inner
  fromTokenAccount?: unknown;
  toTokenAccount?: unknown;
  sourceTokenAccount?: unknown;
  destinationTokenAccount?: unknown;

  tokenAmount?: unknown;
  rawTokenAmount?: unknown;
  amount?: unknown;
  decimals?: unknown;
};

/* =========================
   HELPERS
========================= */

const CACHE_TTL_MS = 10_000;
const CACHE = new Map<string, { ts: number; items: ActivityItem[] }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRecord(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function getProp(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  return obj[key];
}

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
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

const toStr = (v: unknown) => (typeof v === "string" ? v : "");

const normAddr = (v: unknown) => toStr(v).trim();
const normMint = (v: unknown) => toStr(v).trim().toLowerCase();

/**
 * Smart UI unit conversion:
 * - if string has '.' => UI
 * - if small-ish => UI
 * - else base / 10^decimals
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
    if (Math.abs(n) < 1e9) return n;
    return n / Math.pow(10, decimals);
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return 0;
    if (!Number.isInteger(raw) || Math.abs(raw) < 1e9) return raw;
    return raw / Math.pow(10, decimals);
  }

  const n = toNum(raw);
  if (!n) return 0;
  if (Math.abs(n) < 1e9) return n;
  return n / Math.pow(10, decimals);
}

/**
 * Pull amount from a token transfer record robustly.
 */
function readUiAmount(rec: Record<string, unknown>, mintNormStr: string) {
  const tokenAmountObj = rec.tokenAmount ?? rec.rawTokenAmount ?? rec.amount;

  const decimals = (() => {
    if (typeof rec.decimals === "number") return rec.decimals;

    if (isRecord(tokenAmountObj)) {
      const tokenDec = tokenAmountObj.decimals;
      if (typeof tokenDec === "number") return tokenDec;
    }

    return mintNormStr === USDC_MINT ? USDC_DECIMALS : 0;
  })();

  if (isRecord(tokenAmountObj)) {
    const uiCandidate =
      tokenAmountObj.uiAmount ??
      tokenAmountObj.uiAmountString ??
      tokenAmountObj.ui_amount ??
      tokenAmountObj.ui_amount_string;

    if (uiCandidate != null) {
      const n = Number(uiCandidate);
      return Number.isFinite(n) ? n : 0;
    }

    const raw =
      tokenAmountObj.amount ??
      tokenAmountObj.value ??
      tokenAmountObj.rawAmount ??
      tokenAmountObj;

    return toUiSmart(raw, decimals || 0);
  }

  return toUiSmart(tokenAmountObj, decimals || 0);
}

/* =========================
   EXTRACTION (enhanced + inner)
========================= */

function extractEnhancedTokenTransfers(tx: HeliusTx): TokenTransferRecord[] {
  const out: TokenTransferRecord[] = [];

  for (const t of asArray<TokenTransferRecord>(tx.tokenTransfers)) out.push(t);

  const ev = isRecord(tx.events) ? tx.events : null;
  if (ev) {
    out.push(...asArray<TokenTransferRecord>(getProp(ev, "tokenTransfers")));
    out.push(
      ...asArray<TokenTransferRecord>(getProp(ev, "fungibleTokenTransfers"))
    );
    out.push(...asArray<TokenTransferRecord>(getProp(ev, "splTransfers")));
  }

  return out;
}

/**
 * Extract top-level account keys from the message.
 * ✅ Used for "does this tx involve a specific vault/program" checks.
 */
function extractAccountKeys(tx: HeliusTx): string[] {
  const transaction = isRecord(tx.transaction)
    ? (tx.transaction as TxTransaction)
    : null;
  const message =
    transaction && isRecord(transaction.message)
      ? (transaction.message as TxMessage)
      : null;

  const keys = asArray<TxMessageAccountKey>(message?.accountKeys);

  const out: string[] = [];
  for (const k of keys) {
    if (typeof k === "string") {
      if (k) out.push(k);
    } else if (isRecord(k)) {
      const pk = toStr(k.pubkey);
      if (pk) out.push(pk);
    }
  }
  return out;
}

function buildTokenAccountMaps(tx: HeliusTx) {
  const meta = isRecord(tx.meta) ? (tx.meta as TxMeta) : null;

  const transaction = isRecord(tx.transaction)
    ? (tx.transaction as TxTransaction)
    : null;

  const message =
    transaction && isRecord(transaction.message)
      ? (transaction.message as TxMessage)
      : null;

  const accountKeys = asArray<TxMessageAccountKey>(message?.accountKeys);

  const idxToPubkey = new Map<number, string>();
  for (let i = 0; i < accountKeys.length; i++) {
    const k = accountKeys[i];
    if (typeof k === "string") {
      if (k) idxToPubkey.set(i, k);
    } else if (isRecord(k)) {
      const pk = toStr(k.pubkey);
      if (pk) idxToPubkey.set(i, pk);
    }
  }

  const tokMeta = new Map<
    string,
    { mint: string; mintNorm: string; decimals: number; owner?: string | null }
  >();

  const ingest = (arr: TokenBalance[]) => {
    for (const b of arr) {
      const accountIndex =
        typeof b.accountIndex === "number" ? b.accountIndex : null;
      if (accountIndex == null) continue;

      const pubkey = idxToPubkey.get(accountIndex);
      if (!pubkey) continue;

      const mint = toStr(b.mint).trim();
      if (!mint) continue;

      const decRaw = b.uiTokenAmount?.decimals;
      const decimals = typeof decRaw === "number" ? decRaw : 0;

      const owner = toStr(b.owner).trim() || null;

      tokMeta.set(pubkey, {
        mint,
        mintNorm: mint.toLowerCase(),
        decimals,
        owner,
      });
    }
  };

  const preTB = asArray<TokenBalance>(meta?.preTokenBalances);
  const postTB = asArray<TokenBalance>(meta?.postTokenBalances);

  ingest(preTB);
  ingest(postTB);

  return { tokMeta };
}

function extractInnerSplTokenTransfers(tx: HeliusTx): TokenTransferRecord[] {
  const meta = isRecord(tx.meta) ? (tx.meta as TxMeta) : null;
  const innerGroups = asArray<InnerInstructionGroup>(meta?.innerInstructions);
  if (!innerGroups.length) return [];

  const { tokMeta } = buildTokenAccountMaps(tx);
  const out: TokenTransferRecord[] = [];

  for (const group of innerGroups) {
    const insts = asArray<InnerInstruction>(getProp(group, "instructions"));

    for (const ix of insts) {
      const programId = toStr(getProp(ix, "programId"));
      const program = toStr(getProp(ix, "program"));

      const isTokenProgram =
        program === "spl-token" ||
        programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

      if (!isTokenProgram) continue;

      const parsedRaw = getProp(ix, "parsed");
      if (!isRecord(parsedRaw)) continue;

      const type = toStr(getProp(parsedRaw, "type"));
      if (type !== "transfer" && type !== "transferChecked") continue;

      const infoRaw = getProp(parsedRaw, "info");
      const info = isRecord(infoRaw)
        ? (infoRaw as InnerParsedTransferInfo)
        : null;
      if (!info) continue;

      const sourceTA = toStr(info.source).trim();
      const destTA = toStr(info.destination).trim();
      if (!sourceTA || !destTA) continue;

      const metaTok = tokMeta.get(sourceTA) || tokMeta.get(destTA);
      if (!metaTok?.mint) continue;

      const decimals = metaTok.decimals ?? 0;

      const tokAmtRaw = info.tokenAmount;
      const tokAmt = isRecord(tokAmtRaw) ? tokAmtRaw : null;

      const rawAmount =
        (tokAmt &&
          (tokAmt.uiAmountString ?? tokAmt.uiAmount ?? tokAmt.amount)) ??
        info.amount ??
        null;

      out.push({
        mint: metaTok.mint,
        decimals,
        fromTokenAccount: sourceTA,
        toTokenAccount: destTA,
        tokenAmount: {
          amount:
            typeof rawAmount === "string" ? rawAmount : String(rawAmount ?? ""),
          decimals,
          uiAmountString: tokAmt ? toStr(tokAmt.uiAmountString) : undefined,
          uiAmount:
            tokAmt && typeof tokAmt.uiAmount === "number"
              ? tokAmt.uiAmount
              : undefined,
        },
      });
    }
  }

  return out;
}

function extractTokenTransfers(tx: HeliusTx): TokenTransferRecord[] {
  return [
    ...extractEnhancedTokenTransfers(tx),
    ...extractInnerSplTokenTransfers(tx),
  ];
}

/* =========================
   NORMALIZE
========================= */

function normalizeToActivity(
  owner58: string,
  raw: unknown
): ActivityItem | null {
  const tx = isRecord(raw) ? (raw as HeliusTx) : null;
  if (!tx) return null;

  const owner = owner58.trim();

  const transaction = isRecord(tx.transaction)
    ? (tx.transaction as TxTransaction)
    : null;

  const sig =
    toStr(tx.signature) ||
    (transaction ? toStr(asArray<string>(transaction.signatures)[0]) : "");

  if (!sig) return null;

  const blockTime: number | null =
    toNum(tx.timestamp) ||
    (typeof tx.blockTime === "number" ? tx.blockTime : null);

  const feeLamports: number | null = (() => {
    const feeFromTx = transaction ? toNum(transaction.fee) : 0;
    const feeFromTop = toNum(tx.fee);
    const fee = feeFromTx || feeFromTop;
    return fee ? fee : null;
  })();

  const source: string | null = toStr(tx.source) || toStr(tx.type) || null;

  const accounts = extractAccountKeys(tx);

  const { tokMeta } = buildTokenAccountMaps(tx);

  // token accounts owned by `owner`
  const ownerTokenAccounts = new Set<string>();
  for (const [tokenAcc, m] of tokMeta.entries()) {
    if ((m.owner || "").trim() === owner) ownerTokenAccounts.add(tokenAcc);
  }

  const isOwnerAddress = (addr: string) =>
    addr === owner || ownerTokenAccounts.has(addr);

  // Resolve token-account -> owner wallet if known
  const tokenAccountOwner = (addr: string): string | null => {
    const m = tokMeta.get(addr);
    const o = (m?.owner || "").trim();
    return o || null;
  };

  const resolveCounterparty = (addr: string): string =>
    tokenAccountOwner(addr) || addr;

  const transfers = extractTokenTransfers(tx);

  type ParsedXfer = {
    mintNorm: string;
    mintRaw: string;
    from: string;
    to: string;
    ui: number;
  };
  const parsed: ParsedXfer[] = [];

  let usdcOutTotal = 0;

  // primary leg (prevents tiny extra transfers from breaking savings)
  let maxIn = { ui: 0, cp: "" };
  let maxOut = { ui: 0, cp: "" };

  for (const t of transfers) {
    const rec = isRecord(t) ? (t as Record<string, unknown>) : null;
    if (!rec) continue;

    const tokenObjRaw = rec.token;
    const tokenObj = isRecord(tokenObjRaw)
      ? (tokenObjRaw as Record<string, unknown>)
      : null;

    const mintRaw =
      toStr(rec.mint) ||
      toStr(rec.tokenAddress) ||
      toStr(rec.mintAddress) ||
      (tokenObj ? toStr(tokenObj.mint) : "");

    const mintNormStr = normMint(mintRaw);
    if (!mintNormStr) continue;

    const fromUser =
      normAddr(rec.fromUserAccount) ||
      normAddr(rec.from) ||
      normAddr(rec.source);
    const toUser =
      normAddr(rec.toUserAccount) ||
      normAddr(rec.to) ||
      normAddr(rec.destination);

    const fromTok =
      normAddr(rec.fromTokenAccount) || normAddr(rec.sourceTokenAccount);
    const toTok =
      normAddr(rec.toTokenAccount) || normAddr(rec.destinationTokenAccount);

    const from = fromUser || fromTok;
    const to = toUser || toTok;
    if (!from || !to) continue;

    const ui = readUiAmount(rec, mintNormStr);
    if (!Number.isFinite(ui) || ui <= 0) continue;

    parsed.push({
      mintNorm: mintNormStr,
      mintRaw: mintRaw.trim(),
      from,
      to,
      ui,
    });

    if (mintNormStr === USDC_MINT) {
      const toOwner = isOwnerAddress(to);
      const fromOwner = isOwnerAddress(from);

      // inbound to owner
      if (toOwner && !fromOwner) {
        if (ui > maxIn.ui) maxIn = { ui, cp: resolveCounterparty(from) };
      }
      // outbound from owner
      else if (fromOwner && !toOwner) {
        usdcOutTotal += ui;
        if (ui > maxOut.ui) maxOut = { ui, cp: resolveCounterparty(to) };
      }
    }
  }

  if (maxIn.ui === 0 && maxOut.ui === 0) return null;

  const direction: "in" | "out" = maxIn.ui >= maxOut.ui ? "in" : "out";
  const amountUiAbs = Math.max(maxIn.ui, maxOut.ui);

  // swap detection: owner spent USDC and received some non-USDC token
  let kind: ActivityKind = "transfer";
  let swapBoughtMint: string | undefined;
  let swapBoughtAmountUi: number | undefined;

  if (direction === "out") {
    let best: ParsedXfer | null = null;

    for (const x of parsed) {
      if (x.mintNorm === USDC_MINT) continue;
      if (isOwnerAddress(x.to)) {
        if (!best || x.ui > best.ui) best = x;
      }
    }

    if (best) {
      kind = "swap";
      swapBoughtMint = best.mintRaw || best.mintNorm;
      swapBoughtAmountUi = best.ui;
    }
  }

  const counterparty =
    kind === "transfer"
      ? direction === "in"
        ? maxIn.cp || null
        : maxOut.cp || null
      : null;

  const tokenAccounts = Array.from(ownerTokenAccounts);

  const item: ActivityItem = {
    signature: sig,
    blockTime,
    direction,
    amountUi: amountUiAbs,
    counterparty,
    feeLamports,
    kind,
    source,
    accounts,
    tokenAccounts,
  };

  if (kind === "swap") {
    const sold = usdcOutTotal || amountUiAbs;

    item.swapSoldMint = USDC_MINT_RAW;
    item.swapSoldAmountUi = sold;
    item.amountUi = sold;

    item.swapBoughtMint = swapBoughtMint;
    item.swapBoughtAmountUi = swapBoughtAmountUi;

    item.counterparty = null;
  }

  return item;
}

/* =========================
   PUBLIC EXPORT (existing)
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

/* =========================
   NEW HELPERS (for savings)
========================= */

/**
 * ✅ True if the tx's top-level account keys include `addr`.
 */
export function isTxInvolvingAccount(item: ActivityItem, addr: string) {
  const a = addr.trim();
  if (!a) return false;
  return Array.isArray(item.accounts) && item.accounts.includes(a);
}

/**
 * ✅ Server-side paging + filtering: returns *only* txs involving `involveAddr`.
 */
export async function getUsdcActivityForOwnerInvolving(
  owner58: string,
  involveAddr: string,
  opts?: {
    want?: number;
    maxPages?: number;
    before?: string;
    pageSize?: number;
  }
): Promise<{ items: ActivityItem[]; nextBefore: string | null }> {
  const want = Math.min(Math.max(opts?.want ?? 30, 1), 200);
  const pageSize = Math.min(Math.max(opts?.pageSize ?? 100, 10), 100);
  const maxPages = Math.min(Math.max(opts?.maxPages ?? 40, 1), 80);

  let cursor = opts?.before;
  let pages = 0;

  const matched: ActivityItem[] = [];
  let lastCursor: string | null = null;

  while (pages < maxPages && matched.length < want) {
    pages += 1;

    const page = await getUsdcActivityForOwner(owner58, {
      limit: pageSize,
      before: cursor,
    });

    if (!page.length) break;

    for (const it of page) {
      if (isTxInvolvingAccount(it, involveAddr)) matched.push(it);
      if (matched.length >= want) break;
    }

    cursor = page[page.length - 1]?.signature || cursor;
    lastCursor = cursor || null;

    if (page.length < pageSize) break;
  }

  return { items: matched.slice(0, want), nextBefore: lastCursor };
}

/**
 * ✅ Convenience for Flex:
 * Returns ONLY transfer rows involving the flex addr.
 */
export async function getFlexSavingsActivity(
  owner58: string,
  flexAddr: string,
  opts?: { want?: number; before?: string; maxPages?: number }
) {
  const { items, nextBefore } = await getUsdcActivityForOwnerInvolving(
    owner58,
    flexAddr,
    {
      want: opts?.want ?? 30,
      before: opts?.before,
      maxPages: opts?.maxPages ?? 60,
      pageSize: 100,
    }
  );

  const transfers = items.filter(
    (i) => i.kind === "transfer" && i.amountUi > 0
  );

  // newest first
  transfers.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

  return { items: transfers, nextBefore };
}
