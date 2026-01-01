/* eslint-disable no-console */
import "dotenv/config";
import { HermesClient } from "@pythnetwork/hermes-client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

type ParsedUpdate = {
  id: string;
  price: {
    price: string; // integer as string
    conf: string; // integer as string
    expo: number; // negative means decimals
    publish_time: number; // unix seconds
  };
};

function normalizeId(id: string): string {
  return id.trim().toLowerCase().replace(/^0x/, "");
}

function toNumber(priceInt: string, expo: number): number {
  const n = Number(priceInt);
  if (!Number.isFinite(n)) return 0;
  return n * Math.pow(10, expo);
}

async function main() {
  const CONVEX_URL =
    process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  const INGEST_SECRET = process.env.PRICE_INGEST_SECRET;

  if (!CONVEX_URL)
    throw new Error("Missing CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL)");
  if (!INGEST_SECRET) throw new Error("Missing PRICE_INGEST_SECRET");

  // Canonical Pyth price feed IDs (BTC/USD, ETH/USD, SOL/USD)
  // You can also move these to env vars if you want.
  const FEEDS = {
    BTC: normalizeId(
      process.env.PYTH_BTC_FEED_ID ??
        "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"
    ),
    ETH: normalizeId(
      process.env.PYTH_ETH_FEED_ID ??
        "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
    ),
    SOL: normalizeId(
      process.env.PYTH_SOL_FEED_ID ??
        "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
    ),
  } as const;

  const idToSymbol: Record<string, "BTC" | "ETH" | "SOL"> = {
    [FEEDS.BTC]: "BTC",
    [FEEDS.ETH]: "ETH",
    [FEEDS.SOL]: "SOL",
  };

  const ids = Object.keys(idToSymbol);

  const convex = new ConvexHttpClient(CONVEX_URL);
  const hermes = new HermesClient("https://hermes.pyth.network", {
    timeout: 20_000,
  });

  console.log("[pyth-worker] using feeds:", FEEDS);

  // publish_time dedupe so we only write when Hermes gives a new update
  const lastSeenPublishTime: Partial<Record<"BTC" | "ETH" | "SOL", number>> =
    {};

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = (await hermes.getLatestPriceUpdates(ids, {
        parsed: true,
      })) as { parsed?: ParsedUpdate[] };

      const parsed = Array.isArray(res.parsed) ? res.parsed : [];

      for (const u of parsed) {
        const id = normalizeId(u.id);
        const symbol = idToSymbol[id];
        if (!symbol) continue;

        const pt = u.price.publish_time;
        if (!Number.isFinite(pt)) continue;

        const last = lastSeenPublishTime[symbol];
        if (last && pt <= last) continue;

        const price = toNumber(u.price.price, u.price.expo);
        const conf = toNumber(u.price.conf, u.price.expo);

        lastSeenPublishTime[symbol] = pt;

        await convex.mutation(api.prices.ingest, {
          secret: INGEST_SECRET,
          symbol,
          price,
          conf,
          publishTime: pt,
        });

        console.log(`[pyth-worker] ${symbol} @ ${pt}: ${price}`);
      }
    } catch (e) {
      console.error("[pyth-worker] poll error:", e);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
