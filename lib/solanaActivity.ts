// lib/solanaActivity.ts
import "server-only";

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

// ✅ Added "perp" kind for Jupiter Perpetuals
export type ActivityKind = "transfer" | "swap" | "perp";

export type ActivityItem = {
  signature: string;
  blockTime: number | null;
  direction: "in" | "out";
  amountUi: number;
  counterparty?: string | null;
  counterpartyLabel?: string | null;
  feeLamports?: number | null;
  kind: ActivityKind;
  swapDirection?: "buy" | "sell";
  swapSoldMint?: string;
  swapSoldAmountUi?: number;
  swapBoughtMint?: string;
  swapBoughtAmountUi?: number;
  source?: string | null;
  involvedAccounts?: string[];
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

/* =========================
   ✅ Jupiter Perps detection helpers
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

type TokenTransferRecord = Record<string, unknown>;

function extractTokenTransfers(
  tx: Record<string, unknown>
): TokenTransferRecord[] {
  const results: TokenTransferRecord[] = [];

  // Track which mints we've seen transfers for (to avoid duplicates from accountData)
  const seenMintUserPairs = new Set<string>();

  // 1) Helius enhanced: tx.tokenTransfers (primary source)
  const tokenTransfers = Array.isArray(tx.tokenTransfers)
    ? tx.tokenTransfers
    : [];
  for (const tt of tokenTransfers) {
    results.push(tt as TokenTransferRecord);
    // Track this transfer to avoid duplicating from accountData
    const rec = tt as Record<string, unknown>;
    const mint = toStr(rec.mint);
    const fromUser = toStr(rec.fromUserAccount);
    const toUser = toStr(rec.toUserAccount);
    if (mint && fromUser) seenMintUserPairs.add(`${mint}:${fromUser}:out`);
    if (mint && toUser) seenMintUserPairs.add(`${mint}:${toUser}:in`);
  }

  // 2) Helius events
  const ev = (tx.events ?? {}) as Record<string, unknown>;
  const b = Array.isArray(ev.tokenTransfers) ? ev.tokenTransfers : [];
  const c = Array.isArray(ev.fungibleTokenTransfers)
    ? ev.fungibleTokenTransfers
    : [];
  const d = Array.isArray(ev.splTransfers) ? ev.splTransfers : [];
  results.push(...b, ...c, ...d);

  // 3) Parse accountData[].tokenBalanceChanges[] for transfers NOT in tokenTransfers
  // This catches Token-2022 transfers that Helius doesn't include in tokenTransfers
  const accountData = tx.accountData;
  if (Array.isArray(accountData)) {
    for (const ad of accountData) {
      if (!ad || typeof ad !== "object") continue;
      const adRec = ad as Record<string, unknown>;

      const tokenBalanceChanges = adRec.tokenBalanceChanges;
      if (!Array.isArray(tokenBalanceChanges)) continue;

      for (const change of tokenBalanceChanges) {
        if (!change || typeof change !== "object") continue;
        const ch = change as Record<string, unknown>;

        const userAccount = toStr(ch.userAccount);
        const tokenAccount = toStr(ch.tokenAccount);
        const mint = toStr(ch.mint);

        const rawTokenAmount = ch.rawTokenAmount as
          | Record<string, unknown>
          | undefined;
        if (!rawTokenAmount) continue;

        const tokenAmountStr = toStr(rawTokenAmount.tokenAmount);
        const decimals =
          typeof rawTokenAmount.decimals === "number"
            ? rawTokenAmount.decimals
            : 6;

        if (!mint || !userAccount || !tokenAmountStr) continue;

        const rawAmount = Number(tokenAmountStr);
        if (!Number.isFinite(rawAmount) || rawAmount === 0) continue;

        // Positive = received (IN), Negative = sent (OUT)
        const isIncoming = rawAmount > 0;
        const direction = isIncoming ? "in" : "out";
        const pairKey = `${mint}:${userAccount}:${direction}`;

        // Skip if we already have this transfer from tokenTransfers
        if (seenMintUserPairs.has(pairKey)) continue;
        seenMintUserPairs.add(pairKey);

        const absAmount = Math.abs(rawAmount);
        const uiAmount = absAmount / Math.pow(10, decimals);

        // Create a synthetic transfer record
        // For incoming: from is unknown (use empty), to is userAccount
        // For outgoing: from is userAccount, to is unknown
        if (isIncoming) {
          results.push({
            mint,
            from: "", // unknown source
            fromUserAccount: "",
            to: tokenAccount,
            toUserAccount: userAccount,
            tokenAmount: uiAmount,
            rawTokenAmount,
            decimals,
          });
        } else {
          results.push({
            mint,
            from: tokenAccount,
            fromUserAccount: userAccount,
            to: "", // unknown destination
            toUserAccount: "",
            tokenAmount: uiAmount,
            rawTokenAmount,
            decimals,
          });
        }
      }
    }
  }

  // 4) Parse innerInstructions for spl-token transferChecked (fallback)
  const innerInstructionSources: Array<Record<string, unknown>[]> = [];

  if (Array.isArray(tx.innerInstructions)) {
    innerInstructionSources.push(
      tx.innerInstructions as Array<Record<string, unknown>>
    );
  }

  const meta = tx.meta as Record<string, unknown> | undefined;
  if (meta && Array.isArray(meta.innerInstructions)) {
    innerInstructionSources.push(
      meta.innerInstructions as Array<Record<string, unknown>>
    );
  }

  for (const innerInstructions of innerInstructionSources) {
    for (const inner of innerInstructions) {
      const ixs = inner.instructions as
        | Array<Record<string, unknown>>
        | undefined;
      if (!Array.isArray(ixs)) continue;

      for (const ix of ixs) {
        const parsed = ix.parsed as Record<string, unknown> | undefined;
        if (!parsed) continue;

        const ixType = toStr(parsed.type);
        if (ixType !== "transfer" && ixType !== "transferChecked") continue;

        const info = parsed.info as Record<string, unknown> | undefined;
        if (!info) continue;

        const mint = toStr(info.mint);
        const source = toStr(info.source);
        const destination = toStr(info.destination);
        const authority = toStr(info.authority);
        const tokenAmount = info.tokenAmount as
          | Record<string, unknown>
          | undefined;

        if (mint && source && destination) {
          results.push({
            mint,
            from: source,
            fromUserAccount: authority || source,
            to: destination,
            toUserAccount: destination,
            tokenAmount: tokenAmount,
            amount: tokenAmount?.amount ?? info.amount,
            ...info,
          });
        }
      }
    }
  }

  // 5) Also check top-level instructions for parsed transfers
  const instructions = tx.instructions as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(instructions)) {
    for (const ix of instructions) {
      const parsed = ix.parsed as Record<string, unknown> | undefined;
      if (!parsed) continue;

      const ixType = toStr(parsed.type);
      if (ixType !== "transfer" && ixType !== "transferChecked") continue;

      const info = parsed.info as Record<string, unknown> | undefined;
      if (!info) continue;

      const mint = toStr(info.mint);
      const source = toStr(info.source);
      const destination = toStr(info.destination);
      const authority = toStr(info.authority);
      const tokenAmount = info.tokenAmount as
        | Record<string, unknown>
        | undefined;

      if (mint && source && destination) {
        results.push({
          mint,
          from: source,
          fromUserAccount: authority || source,
          to: destination,
          toUserAccount: destination,
          tokenAmount: tokenAmount,
          amount: tokenAmount?.amount ?? info.amount,
          ...info,
        });
      }
    }
  }

  return results;
}

/**
 * Build a map of token account address -> owner wallet address
 * Handles BOTH:
 * - Helius Enhanced format (accountData[].tokenBalanceChanges[])
 * - RPC format (meta.preTokenBalances/postTokenBalances)
 */
function buildTokenAccountOwnerMap(
  tx: Record<string, unknown>
): Map<string, string> {
  const map = new Map<string, string>();

  // ---- 1) Helius Enhanced: accountData[].tokenBalanceChanges[] ----
  const accountData = tx.accountData;
  if (Array.isArray(accountData)) {
    for (const ad of accountData) {
      if (!ad || typeof ad !== "object") continue;
      const adRec = ad as Record<string, unknown>;

      // The account address itself
      const account = toStr(adRec.account);

      // Check tokenBalanceChanges array
      const tbc = adRec.tokenBalanceChanges;
      if (Array.isArray(tbc)) {
        for (const ch of tbc) {
          if (!ch || typeof ch !== "object") continue;
          const chRec = ch as Record<string, unknown>;

          // userAccount is the wallet owner
          const userAccount = toStr(chRec.userAccount);
          if (account && userAccount) {
            map.set(account, userAccount);
          }
        }
      }
    }
  }

  // ---- 2) RPC format: meta.preTokenBalances/postTokenBalances ----
  const meta = tx.meta as Record<string, unknown> | undefined;
  if (meta) {
    const txObj = tx.transaction as Record<string, unknown> | undefined;
    const message = txObj?.message as Record<string, unknown> | undefined;
    const accountKeys = message?.accountKeys as Array<unknown> | undefined;

    // Helper to get address from account key
    const getAddr = (index: number): string | null => {
      if (!accountKeys) return null;
      const key = accountKeys[index];
      if (!key) return null;
      if (typeof key === "string") return key;
      if (key && typeof key === "object") {
        return toStr((key as Record<string, unknown>).pubkey);
      }
      return null;
    };

    // Process both pre and post token balances
    const preBalances = meta.preTokenBalances as
      | Array<Record<string, unknown>>
      | undefined;
    const postBalances = meta.postTokenBalances as
      | Array<Record<string, unknown>>
      | undefined;

    for (const balances of [preBalances, postBalances]) {
      if (!Array.isArray(balances)) continue;

      for (const bal of balances) {
        const accountIndex = bal.accountIndex;
        const owner = toStr(bal.owner);

        if (typeof accountIndex === "number" && owner) {
          const tokenAccount = getAddr(accountIndex);
          if (tokenAccount) {
            map.set(tokenAccount, owner);
          }
        }
      }
    }
  }

  // ---- 3) Helius tokenTransfers often include fromUserAccount/toUserAccount ----
  // Build map from these as well
  const tokenTransfers = tx.tokenTransfers;
  if (Array.isArray(tokenTransfers)) {
    for (const tt of tokenTransfers) {
      if (!tt || typeof tt !== "object") continue;
      const rec = tt as Record<string, unknown>;

      const fromAcc = toStr(rec.fromTokenAccount);
      const fromUser = toStr(rec.fromUserAccount);
      if (fromAcc && fromUser) map.set(fromAcc, fromUser);

      const toAcc = toStr(rec.toTokenAccount);
      const toUser = toStr(rec.toUserAccount);
      if (toAcc && toUser) map.set(toAcc, toUser);
    }
  }

  return map;
}

function extractAccountKeys(tx: Record<string, unknown>): string[] {
  const keys = new Set<string>();

  const accountData = tx.accountData;
  if (Array.isArray(accountData)) {
    for (const acc of accountData) {
      if (acc && typeof acc === "object") {
        const accRec = acc as Record<string, unknown>;
        const account = toStr(accRec.account);
        if (account) keys.add(account);
      }
    }
  }

  const txTransaction = tx.transaction;
  if (txTransaction && typeof txTransaction === "object") {
    const txRec = txTransaction as Record<string, unknown>;
    const message = txRec.message;
    if (message && typeof message === "object") {
      const msgRec = message as Record<string, unknown>;
      const accountKeys = msgRec.accountKeys;
      if (Array.isArray(accountKeys)) {
        for (const key of accountKeys) {
          if (typeof key === "string") {
            keys.add(key);
          } else if (key && typeof key === "object") {
            const keyRec = key as Record<string, unknown>;
            const pubkey = toStr(keyRec.pubkey);
            if (pubkey) keys.add(pubkey);
          }
        }
      }
    }
  }

  const instructions = tx.instructions;
  if (Array.isArray(instructions)) {
    for (const ix of instructions) {
      if (ix && typeof ix === "object") {
        const ixRec = ix as Record<string, unknown>;
        const programId = toStr(ixRec.programId);
        if (programId) keys.add(programId);
        const accounts = ixRec.accounts;
        if (Array.isArray(accounts)) {
          for (const acc of accounts) {
            if (typeof acc === "string") keys.add(acc);
          }
        }
      }
    }
  }

  const nativeTransfers = tx.nativeTransfers;
  if (Array.isArray(nativeTransfers)) {
    for (const nt of nativeTransfers) {
      if (nt && typeof nt === "object") {
        const ntRec = nt as Record<string, unknown>;
        const from = toStr(ntRec.fromUserAccount) || toStr(ntRec.from);
        const to = toStr(ntRec.toUserAccount) || toStr(ntRec.to);
        if (from) keys.add(from);
        if (to) keys.add(to);
      }
    }
  }

  const tokenTransfers = extractTokenTransfers(tx);
  for (const tt of tokenTransfers) {
    const from =
      toStr(tt.fromUserAccount) || toStr(tt.from) || toStr(tt.source);
    const to = toStr(tt.toUserAccount) || toStr(tt.to) || toStr(tt.destination);
    if (from) keys.add(from);
    if (to) keys.add(to);
  }

  return Array.from(keys);
}

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

  const involvedAccounts = extractAccountKeys(tx);
  const transfers = extractTokenTransfers(tx);

  // Build token account -> owner map for resolving ownership
  const tokenAcctOwnerMap = buildTokenAccountOwnerMap(tx);

  // Helper to resolve an address to its owner (if it's a token account)
  const resolveOwner = (addr: string): string => {
    return tokenAcctOwnerMap.get(addr) || addr;
  };

  // ✅ Detect Jupiter Perps EARLY - before any other parsing
  const logs = getLogMessages(tx);
  const isJupPerpsTx =
    involvedAccounts.includes(JUP_PERPS_PROGRAM_ID) ||
    logs.some((l) =>
      /Jupiter Perps Program|IncreasePosition|DecreasePosition|ClosePosition/i.test(
        l
      )
    );

  const jupPerpsAction: JupPerpsAction = isJupPerpsTx
    ? detectJupPerpsAction(tx)
    : "unknown";

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

    const fromRaw =
      normAddr(rec.fromUserAccount) ||
      normAddr(rec.from) ||
      normAddr(rec.source);

    const toRaw =
      normAddr(rec.toUserAccount) ||
      normAddr(rec.to) ||
      normAddr(rec.destination);

    // Resolve token accounts to their owners
    const from = resolveOwner(fromRaw);
    const to = resolveOwner(toRaw);

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

  // ✅ Handle Jupiter Perps transactions FIRST
  if (isJupPerpsTx) {
    const direction: "in" | "out" = usdcDelta > 0 ? "in" : "out";
    const amountUiAbs = Math.abs(usdcDelta);

    const item: ActivityItem = {
      signature: sig,
      blockTime,
      direction,
      amountUi: amountUiAbs,
      counterparty: null,
      feeLamports,
      kind: "perp",
      source: "jupiter-perps",
      involvedAccounts,
      counterpartyLabel:
        jupPerpsAction === "increase"
          ? "Add collateral"
          : jupPerpsAction === "decrease"
            ? "Remove collateral"
            : jupPerpsAction === "close"
              ? "Close position"
              : jupPerpsAction === "liquidate"
                ? "Liquidation"
                : "Position update",
    };

    return item;
  }

  // Handle non-perp transactions (existing logic)
  if (!usdcDelta) {
    let bestIn: Xfer | null = null;
    let bestOut: Xfer | null = null;

    for (const x of parsed) {
      if (x.mint === USDC_MINT) continue;
      if (x.to === owner) {
        if (!bestIn || x.ui > bestIn.ui) bestIn = x;
      } else if (x.from === owner) {
        if (!bestOut || x.ui > bestOut.ui) bestOut = x;
      }
    }

    if (bestIn && bestOut && bestIn.mint !== bestOut.mint) {
      const item: ActivityItem = {
        signature: sig,
        blockTime,
        direction: "out",
        amountUi: 0,
        counterparty: null,
        feeLamports,
        kind: "swap",
        source,
        involvedAccounts,
        swapSoldMint: bestOut.mint,
        swapSoldAmountUi: bestOut.ui,
        swapBoughtMint: bestIn.mint,
        swapBoughtAmountUi: bestIn.ui,
      };
      return item;
    }

    return null;
  }

  const direction: "in" | "out" = usdcDelta > 0 ? "in" : "out";
  const amountUiAbs = Math.abs(usdcDelta);

  let kind: ActivityKind = "transfer";
  let swapBoughtMint: string | undefined;
  let swapBoughtAmountUi: number | undefined;
  let swapSoldMint: string | undefined;
  let swapSoldAmountUi: number | undefined;
  let swapDirection: "buy" | "sell" | undefined;

  if (direction === "out") {
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
    involvedAccounts,
  };

  if (kind === "swap") {
    item.swapDirection = swapDirection;
    item.swapSoldMint = swapSoldMint;
    item.swapSoldAmountUi = swapSoldAmountUi;
    item.swapBoughtMint = swapBoughtMint;
    item.swapBoughtAmountUi = swapBoughtAmountUi;
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

  // We will page Helius in batches because your normalizeToActivity filters a lot.
  // Keep cursor local so the external API route doesn't need to change yet.
  let before = opts?.before;

  // How many RAW pages we will try (1 initial + 3 extra = 4 total)
  const MAX_PAGES = 4;

  // Fetch bigger raw pages to compensate for filtering.
  const RAW_PAGE_LIMIT = 100;

  const cacheKey = `${owner58}|${before || ""}|${limit}|${HELIUS_NETWORK}|paged4`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items;

  const all: ActivityItem[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const base = `${HELIUS_BASE_URL}/v0/addresses/${encodeURIComponent(
      owner58
    )}/transactions`;

    const qs = new URLSearchParams({
      "api-key": HELIUS_API_KEY!,
      network: HELIUS_NETWORK,
      limit: String(RAW_PAGE_LIMIT),
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

    // No more history
    if (!raw.length) break;

    // Advance the cursor using the LAST RAW tx signature (not filtered items)
    const last = raw[raw.length - 1] as Record<string, unknown>;
    const lastTx =
      last.transaction && typeof last.transaction === "object"
        ? (last.transaction as Record<string, unknown>)
        : null;
    const lastSig =
      toStr(last.signature) ||
      (Array.isArray(lastTx?.signatures) ? toStr(lastTx.signatures[0]) : "");

    before = lastSig || before;

    // Normalize + collect
    for (const tx of raw) {
      const row = normalizeToActivity(owner58, tx);
      if (row) all.push(row);
      if (all.length >= limit) break;
    }

    if (all.length >= limit) break;

    // If we couldn't extract a cursor, stop to avoid looping forever
    if (!lastSig) break;
  }

  const items = all.slice(0, limit);
  CACHE.set(cacheKey, { ts: Date.now(), items });
  return items;
}
