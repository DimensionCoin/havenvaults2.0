import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { ids: string[] };

type CoingeckoSimplePriceResponse = Record<
  string,
  { usd?: number; usd_24h_change?: number }
>;

const CG_BASE = "https://api.coingecko.com/api/v3";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];

    if (!ids.length) {
      return NextResponse.json({ prices: {} });
    }

    const url = new URL(`${CG_BASE}/simple/price`);
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("include_24hr_change", "true");

    const headers: Record<string, string> = {};
    const demoKey = process.env.COINGECKO_DEMO_KEY;
    if (demoKey) headers["x-cg-demo-api-key"] = demoKey;

    const res = await fetch(url.toString(), {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "CoinGecko request failed", status: res.status, text },
        { status: 500 }
      );
    }

    const json = (await res.json()) as CoingeckoSimplePriceResponse;

    const prices: Record<
      string,
      { priceUsd: number; priceChange24hPct: number | null }
    > = {};

    for (const id of ids) {
      const entry = json?.[id];
      const p = typeof entry?.usd === "number" ? entry.usd : null;
      const ch =
        typeof entry?.usd_24h_change === "number" ? entry.usd_24h_change : null;

      if (p !== null) {
        prices[id] = {
          priceUsd: p,
          priceChange24hPct: ch,
        };
      }
    }

    return NextResponse.json({ prices });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
