// app/api/prices/historical/route.ts
import { NextRequest, NextResponse } from "next/server";

const CG_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_DEMO_KEY = process.env.COINGECKO_DEMO_KEY;

type HistoricalPoint = {
  t: number;
  price: number;
};

type HistoricalApiResponse = {
  id: string;
  prices: HistoricalPoint[];
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const id = searchParams.get("id"); // e.g. "bitcoin"
  const days = searchParams.get("days") ?? "7";

  if (!id) {
    return NextResponse.json(
      { error: "Missing 'id' (CoinGecko coin id)" },
      { status: 400 }
    );
  }

  try {
    // This matches the curl you posted:
    // /coins/{id}/ohlc?vs_currency=usd&days=...
    const url = `${CG_BASE}/coins/${encodeURIComponent(
      id
    )}/ohlc?vs_currency=usd&days=${encodeURIComponent(days)}`;

    const cgRes = await fetch(url, {
      method: "GET",
      headers: COINGECKO_DEMO_KEY
        ? { "x-cg-demo-api-key": COINGECKO_DEMO_KEY }
        : undefined,
      cache: "no-store",
    });

    if (!cgRes.ok) {
      const text = await cgRes.text().catch(() => "");
      console.error("CoinGecko OHLC error:", cgRes.status, text);
      return NextResponse.json(
        { error: "Failed to fetch OHLC from CoinGecko" },
        { status: 502 }
      );
    }

    // Coingecko OHLC: [timestamp, open, high, low, close][]
    const raw = (await cgRes.json()) as [
      number,
      number,
      number,
      number,
      number
    ][];

    const prices: HistoricalPoint[] = raw.map(([ts, , , , close]) => ({
      t: ts, // ms since epoch
      price: close, // closing price
    }));

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
