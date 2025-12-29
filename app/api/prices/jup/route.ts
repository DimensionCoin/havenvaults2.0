// app/api/prices/jup/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JupPriceRequest = {
  mints: string[];
};

const JUP_API_KEY = process.env.JUP_API_KEY;

if (!JUP_API_KEY) {
  console.warn(
    "[JUP PRICE] Missing JUP_API_KEY env var – price API will not work."
  );
}

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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as JupPriceRequest;

    if (!body?.mints || !Array.isArray(body.mints) || body.mints.length === 0) {
      return NextResponse.json(
        { error: "mints array is required" },
        { status: 400 }
      );
    }

    // dedupe + respect Jupiter docs (limit 100 mint addresses)
    const uniqueMints = Array.from(new Set(body.mints)).slice(0, 100);

    if (!JUP_API_KEY) {
      return NextResponse.json(
        { error: "JUP_API_KEY env var is not set on the server" },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      // https://api.jup.ag/tokens/v2/search?query=<mint1,mint2,...>
      query: uniqueMints.join(","),
    });

    const url = `https://api.jup.ag/tokens/v2/search?${params.toString()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": JUP_API_KEY,
      },
      next: { revalidate: 15 }, // light cache
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "[JUP PRICE] Upstream error:",
        res.status,
        text.slice(0, 500)
      );
      return NextResponse.json(
        { error: "Failed to fetch token data from Jupiter" },
        { status: 502 }
      );
    }

    const tokens = (await res.json()) as JupToken[];

    // Map mint -> raw token
    const byMint = new Map<string, JupToken>();
    for (const t of tokens) {
      if (!t?.id) continue;
      byMint.set(t.id, t);
    }

    /**
     * Normalize into:
     *   mint -> { price, priceChange24hPct, mcap, fdv, liquidity, volume24h, marketCapRank }
     */
    const prices: Record<string, NormalizedToken> = {};

    for (const mint of uniqueMints) {
      const entry = byMint.get(mint);
      if (!entry) continue;

      const price = entry.usdPrice ?? 0;
      const pct =
        typeof entry.stats24h?.priceChange === "number"
          ? entry.stats24h.priceChange
          : null;

      prices[mint] = {
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
          typeof entry.liquidity === "number" &&
          Number.isFinite(entry.liquidity)
            ? entry.liquidity
            : null,
        volume24h:
          typeof entry.volume24h === "number" &&
          Number.isFinite(entry.volume24h)
            ? entry.volume24h
            : null,
        marketCapRank:
          typeof entry.marketCapRank === "number" &&
          Number.isFinite(entry.marketCapRank)
            ? entry.marketCapRank
            : null,
      };
    }

    return NextResponse.json({ prices });
  } catch (error) {
    console.error("[POST /api/prices/jup] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
