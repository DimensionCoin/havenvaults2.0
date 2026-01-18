// app/api/savings/plus/activity/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================
   ENV
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

const PLUS_SAVINGS_VAULT_ADDR = (
  process.env.PLUS_SAVINGS_VAULT_ADDR || ""
).trim();
if (!PLUS_SAVINGS_VAULT_ADDR)
  throw new Error("Missing PLUS_SAVINGS_VAULT_ADDR");

const VAULT_LOWER = PLUS_SAVINGS_VAULT_ADDR.toLowerCase();

/* =========================
   HELPERS
========================= */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toInt(v: string | null, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function is429(msg: string) {
  return /429|rate limit/i.test(msg);
}

async function fetchWithBackoff(url: string, traceId: string) {
  let lastErr: unknown = null;

  // keep it modest — we’ll do paging anyway
  const tries = 6;
  const base = 450;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const msg = `Helius ${res.status}: ${text || res.statusText}`;

        if (res.status === 429 && i < tries - 1) {
          const waitMs = base * 2 ** i + Math.floor(Math.random() * 140);
          console.log(
            `[savings/plus/activity][${traceId}] Helius 429 -> backoff`,
            {
              attempt: i + 1,
              waitMs,
            },
          );
          await sleep(waitMs);
          continue;
        }

        throw new Error(msg);
      }

      const json = (await res.json().catch(() => null)) as unknown;
      return json;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);

      if (i < tries - 1 && is429(msg)) {
        const waitMs = base * 2 ** i + Math.floor(Math.random() * 140);
        console.log(
          `[savings/plus/activity][${traceId}] Helius 429 -> backoff`,
          {
            attempt: i + 1,
            waitMs,
          },
        );
        await sleep(waitMs);
        continue;
      }

      break;
    }
  }

  throw lastErr ?? new Error("Helius request failed");
}

/* =========================
   TYPES (minimal)
========================= */

type HeliusAccountDataEntry = {
  account?: string | null;
};

type HeliusTokenTransfer = {
  fromUserAccount?: string | null;
  from?: string | null;
  source?: string | null;
  toUserAccount?: string | null;
  to?: string | null;
  destination?: string | null;
  fromTokenAccount?: string | null;
  toTokenAccount?: string | null;
};

type HeliusTx = {
  signature?: string | null;
  timestamp?: number | string | null;
  blockTime?: number | string | null;
  accountData?: HeliusAccountDataEntry[];
  tokenTransfers?: HeliusTokenTransfer[];
  type?: string | null;
  source?: string | null;
  fee?: number | string | null;
};

type ApiTx = {
  signature: string;
  timestamp: number | null;

  // for fast client parsing
  tokenTransfers?: HeliusTokenTransfer[];
  accountData?: HeliusAccountDataEntry[];

  // debug/labeling
  type?: string | null;
  source?: string | null;
  fee?: number | null;
  involvedAccounts?: string[];
};

function getSig(tx: HeliusTx) {
  return String(tx?.signature || "");
}

function getTimestamp(tx: HeliusTx) {
  const t = Number(tx?.timestamp ?? tx?.blockTime ?? 0);
  return Number.isFinite(t) && t > 0 ? t : null;
}

function extractInvolvedAccounts(tx: HeliusTx): string[] {
  const keys = new Set<string>();

  const accountData = Array.isArray(tx?.accountData) ? tx.accountData : [];
  for (const ad of accountData) {
    const a = typeof ad?.account === "string" ? ad.account : "";
    if (a) keys.add(a);
  }

  const tts = Array.isArray(tx?.tokenTransfers) ? tx.tokenTransfers : [];
  for (const t of tts) {
    const from =
      (typeof t?.fromUserAccount === "string" && t.fromUserAccount) ||
      (typeof t?.from === "string" && t.from) ||
      (typeof t?.source === "string" && t.source) ||
      "";
    const to =
      (typeof t?.toUserAccount === "string" && t.toUserAccount) ||
      (typeof t?.to === "string" && t.to) ||
      (typeof t?.destination === "string" && t.destination) ||
      "";
    if (from) keys.add(from);
    if (to) keys.add(to);

    const fta =
      typeof t?.fromTokenAccount === "string" ? t.fromTokenAccount : "";
    const tta = typeof t?.toTokenAccount === "string" ? t.toTokenAccount : "";
    if (fta) keys.add(fta);
    if (tta) keys.add(tta);
  }

  return Array.from(keys);
}

function txInvolvesVault(tx: HeliusTx): boolean {
  const involved = extractInvolvedAccounts(tx);
  return involved.some((a) => a.toLowerCase() === VAULT_LOWER);
}

function toApiTx(tx: HeliusTx): ApiTx {
  const involvedAccounts = extractInvolvedAccounts(tx);

  return {
    signature: getSig(tx),
    timestamp: getTimestamp(tx),
    tokenTransfers: Array.isArray(tx?.tokenTransfers) ? tx.tokenTransfers : [],
    accountData: Array.isArray(tx?.accountData) ? tx.accountData : [],
    type: typeof tx?.type === "string" ? tx.type : null,
    source: typeof tx?.source === "string" ? tx.source : null,
    fee: Number.isFinite(Number(tx?.fee)) ? Number(tx.fee) : null,
    involvedAccounts,
  };
}

/* =========================
   ROUTE
========================= */

export async function GET(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);

  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session?.sub) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const user = await User.findOne({ privyId: session.sub })
      .select("walletAddress")
      .lean();

    const owner = String(user?.walletAddress || "").trim();
    if (!owner) {
      return NextResponse.json(
        { ok: false, error: "Missing wallet address" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(req.url);

    const limit = Math.min(
      Math.max(toInt(searchParams.get("limit"), 25), 1),
      50,
    );
    const before = searchParams.get("before")?.trim() || "";

    // We fetch 100-per-page from Helius and filter down to vault-related
    const RAW_LIMIT = 100;
    const MAX_PAGES = 6;

    const out: ApiTx[] = [];
    let cursor = before || "";

    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        "api-key": HELIUS_API_KEY!,
        network: HELIUS_NETWORK,
        limit: String(RAW_LIMIT),
      });

      if (cursor) qs.set("before", cursor);

      const url = `${HELIUS_BASE_URL}/v0/addresses/${encodeURIComponent(owner)}/transactions?${qs.toString()}`;

      const raw = await fetchWithBackoff(url, traceId);
      const list = Array.isArray(raw) ? (raw as HeliusTx[]) : [];

      if (list.length === 0) break;

      // update cursor to last signature in this raw page
      const lastSig = getSig(list[list.length - 1]);
      if (lastSig) cursor = lastSig;

      for (const tx of list) {
        if (!txInvolvesVault(tx)) continue;

        const apiTx = toApiTx(tx);
        if (!apiTx.signature) continue;

        out.push(apiTx);
        if (out.length >= limit) break;
      }

      if (out.length >= limit) break;
      if (!lastSig) break;
    }

    const nextBefore = out.length ? out[out.length - 1].signature : null;

    return NextResponse.json({
      ok: true,
      vault: PLUS_SAVINGS_VAULT_ADDR,
      txs: out,
      nextBefore,
      exhausted: out.length < limit,
      traceId,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
