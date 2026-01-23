import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { ids: string[] };

type CoinGeckoCoin = {
  market_data?: {
    current_price?: { usd?: number };
    price_change_percentage_24h?: number;
  };
  description?: Record<string, unknown>;
};

const CG_BASE = "https://api.coingecko.com/api/v3";

function pickEnDescription(desc: unknown): string | null {
  if (!desc || typeof desc !== "object") return null;
  const d = desc as Record<string, unknown>;
  const en = d["en"];
  return typeof en === "string" && en.trim().length ? en : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];

    // No CoinGecko id → let the page fall back to Jupiter
    if (ids.length !== 1) {
      return NextResponse.json({ prices: {} });
    }

    const id = ids[0];

    const url = new URL(`${CG_BASE}/coins/${encodeURIComponent(id)}`);
    url.searchParams.set("localization", "false");
    url.searchParams.set("tickers", "false");
    url.searchParams.set("community_data", "false");
    url.searchParams.set("developer_data", "false");
    url.searchParams.set("sparkline", "false");

    const headers: Record<string, string> = {};
    const demoKey = process.env.COINGECKO_DEMO_KEY;
    if (demoKey) headers["x-cg-demo-api-key"] = demoKey;

    const res = await fetch(url.toString(), {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      // Fail soft → page will use Jupiter
      return NextResponse.json({ prices: {} });
    }

    const json = (await res.json()) as CoinGeckoCoin;

    const priceUsd =
      typeof json?.market_data?.current_price?.usd === "number"
        ? json.market_data.current_price.usd
        : null;

    if (priceUsd === null) {
      return NextResponse.json({ prices: {} });
    }

    const priceChange24hPct =
      typeof json?.market_data?.price_change_percentage_24h === "number"
        ? json.market_data.price_change_percentage_24h
        : null;

    const description = pickEnDescription(json?.description);

    return NextResponse.json({
      prices: {
        [id]: {
          priceUsd,
          priceChange24hPct,
          description, 
        },
      },
    });
  } catch {
    // Fail soft → page will use Jupiter
    return NextResponse.json({ prices: {} });
  }
}
