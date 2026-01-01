import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CG_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_DEMO_KEY = process.env.COINGECKO_DEMO_KEY;

type HistoricalPoint = { t: number; price: number };
type MarketChartResponse = { prices?: [number, number][] };
type HistoricalApiResponse = { id: string; prices: HistoricalPoint[] };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const id = searchParams.get("id"); // e.g. "solana"
  const days = (searchParams.get("days") ?? "7").trim(); // "1", "7", "30", "365", "max"

  if (!id) {
    return NextResponse.json(
      { error: "Missing 'id' (CoinGecko coin id)" },
      { status: 400 }
    );
  }

  try {
    // ✅ Use market_chart and DO NOT pass `interval` (Enterprise-only for 5m/hourly)
    const url = new URL(
      `${CG_BASE}/coins/${encodeURIComponent(id)}/market_chart`
    );
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("days", days);

    const cgRes = await fetch(url.toString(), {
      method: "GET",
      headers: COINGECKO_DEMO_KEY
        ? { "x-cg-demo-api-key": COINGECKO_DEMO_KEY }
        : undefined,
      cache: "no-store",
    });

    if (!cgRes.ok) {
      const text = await cgRes.text().catch(() => "");
      console.error("CoinGecko market_chart error:", cgRes.status, text);
      return NextResponse.json(
        { error: "Failed to fetch market_chart from CoinGecko" },
        { status: 502 }
      );
    }

    const raw = (await cgRes.json()) as MarketChartResponse;
    const rows = Array.isArray(raw?.prices) ? raw.prices : [];

    const prices: HistoricalPoint[] = rows
      .filter(
        (r) =>
          Array.isArray(r) &&
          typeof r[0] === "number" &&
          typeof r[1] === "number"
      )
      .map(([ts, p]) => ({ t: ts, price: p }))
      .sort((a, b) => a.t - b.t);

    const payload: HistoricalApiResponse = { id, prices };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Historical API internal error:", err);
    return NextResponse.json(
      { error: "Internal error fetching historical prices" },
      { status: 500 }
    );
  }
}
