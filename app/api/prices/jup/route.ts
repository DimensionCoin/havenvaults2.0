import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JupPriceRequest = {
  mints: string[];
};

type JupToken = {
  id: string; // mint
  usdPrice: number | null;
  mcap?: number | null;
  fdv?: number | null;
  liquidity?: number | null;
  volume24h?: number | null;
  marketCapRank?: number | null;
  stats24h?: {
    // already a PERCENT value, e.g. 4.25 == +4.25%
    priceChange: number | null;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

type NormalizedToken = {
  price: number;
  priceChange24hPct: number | null;
  mcap: number | null;
  fdv: number | null;
  liquidity: number | null;
  volume24h: number | null;
  marketCapRank: number | null;
};

const JUP_API_KEY = process.env.JUP_API_KEY;

if (!JUP_API_KEY) {
  console.warn(
    "[JUP PRICE] Missing JUP_API_KEY env var – price API will not work.",
  );
}

/* ----------------------------- Safe parse ---------------------------- */

function safeJsonParse<T>(
  raw: string,
): { ok: true; value: T } | { ok: false; error: string } {
  if (!raw || !raw.trim()) return { ok: false, error: "Empty body" };
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

/* ----------------------------- Helpers ------------------------------ */

const MAX_PER_CALL = 100;

// TTL cache so pages don't hammer JUP if user navigates around
const TTL_MS = 45 * 1000; // tune: 30–60s is usually ideal for browse pages

type CacheEntry = { v: NormalizedToken; ts: number };

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as {
    __havenJupPriceCache?: Map<string, CacheEntry>;
  };
  if (!g.__havenJupPriceCache) g.__havenJupPriceCache = new Map();
  return g.__havenJupPriceCache;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeEntry(entry: JupToken): NormalizedToken {
  const price = typeof entry.usdPrice === "number" ? entry.usdPrice : 0;
  const pct =
    typeof entry.stats24h?.priceChange === "number"
      ? entry.stats24h.priceChange
      : null;

  return {
    price,
    priceChange24hPct: pct,
    mcap:
      typeof entry.mcap === "number" && Number.isFinite(entry.mcap)
        ? entry.mcap
        : null,
    fdv:
      typeof entry.fdv === "number" && Number.isFinite(entry.fdv)
        ? entry.fdv
        : null,
    liquidity:
      typeof entry.liquidity === "number" && Number.isFinite(entry.liquidity)
        ? entry.liquidity
        : null,
    volume24h:
      typeof entry.volume24h === "number" && Number.isFinite(entry.volume24h)
        ? entry.volume24h
        : null,
    marketCapRank:
      typeof entry.marketCapRank === "number" &&
      Number.isFinite(entry.marketCapRank)
        ? entry.marketCapRank
        : null,
  };
}

async function fetchBatch(
  uniqueMints: string[],
): Promise<Record<string, NormalizedToken>> {
  const params = new URLSearchParams({
    query: uniqueMints.join(","),
  });

  const url = `https://api.jup.ag/tokens/v2/search?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": JUP_API_KEY! },
    next: { revalidate: 15 }, // keep your existing light cache hint
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      "[JUP PRICE] Upstream error:",
      res.status,
      text.slice(0, 500),
    );
    throw new Error("Failed to fetch token data from Jupiter");
  }

  const tokens = (await res.json()) as JupToken[];

  const byMint = new Map<string, JupToken>();
  for (const t of tokens) {
    if (!t?.id) continue;
    byMint.set(t.id, t);
  }

  const out: Record<string, NormalizedToken> = {};
  for (const mint of uniqueMints) {
    const entry = byMint.get(mint);
    if (!entry) continue;
    out[mint] = normalizeEntry(entry);
  }

  return out;
}

/* ------------------------------ Route ------------------------------- */

export async function POST(req: NextRequest) {
  try {
    // ✅ Avoid req.json() crashing when client aborts mid-stream (truncated JSON)
    const raw = await req.text();
    const parsed = safeJsonParse<Partial<JupPriceRequest>>(raw);
    const body = parsed.ok ? parsed.value : {};

    if (!body?.mints || !Array.isArray(body.mints) || body.mints.length === 0) {
      return NextResponse.json(
        { error: "mints array is required" },
        { status: 400 },
      );
    }

    // ✅ sanitize + dedupe (NO slice here — we now support >100 by chunking)
    const requestedMints = Array.from(
      new Set(
        body.mints.filter(
          (m): m is string => typeof m === "string" && m.trim().length > 0,
        ),
      ),
    ).map((m) => m.trim());

    if (requestedMints.length === 0) {
      return NextResponse.json(
        { error: "mints array is required" },
        { status: 400 },
      );
    }

    if (!JUP_API_KEY) {
      return NextResponse.json(
        { error: "JUP_API_KEY env var is not set on the server" },
        { status: 500 },
      );
    }

    const cache = getCache();
    const now = Date.now();

    const prices: Record<string, NormalizedToken> = {};
    const missing: string[] = [];

    // 1) Serve from cache first (fresh only)
    for (const mint of requestedMints) {
      const hit = cache.get(mint);
      if (hit && now - hit.ts < TTL_MS) {
        prices[mint] = hit.v;
      } else {
        missing.push(mint);
      }
    }

    // 2) Fetch missing in batches of 100
    if (missing.length) {
      const batches = chunk(missing, MAX_PER_CALL);

      for (const batch of batches) {
        const got = await fetchBatch(batch);

        // write-through cache + merge
        for (const [mint, value] of Object.entries(got)) {
          cache.set(mint, { v: value, ts: now });
          prices[mint] = value;
        }
      }
    }

    return NextResponse.json({ prices });
  } catch (error) {
    console.error("[POST /api/prices/jup] Error:", error);

    // Preserve your existing error shape/status behavior
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
