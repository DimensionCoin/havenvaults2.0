import {
  query,
  mutation,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { HermesClient } from "@pythnetwork/hermes-client";

const SYMBOLS = new Set(["BTC", "ETH", "SOL"] as const);
type Symbol = "BTC" | "ETH" | "SOL";

// ✅ Stable feed IDs you confirmed (strip 0x for Hermes request)
const FEEDS: Record<Symbol, string> = {
  BTC: "0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33",
  ETH: "0x9d4294bbcd1174d6f2003ec365831e64cc31d9f6f15a2b85399db8d5000960f6",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

const FEED_IDS: Record<Symbol, string> = {
  BTC: FEEDS.BTC.replace(/^0x/i, ""),
  ETH: FEEDS.ETH.replace(/^0x/i, ""),
  SOL: FEEDS.SOL.replace(/^0x/i, ""),
};

type ParsedUpdate = {
  id: string;
  price: {
    price: string; // int as string
    conf: string; // int as string
    expo: number; // negative means decimals
    publish_time: number; // unix seconds
  };
};

function toNumber(priceInt: string, expo: number): number {
  const n = Number(priceInt);
  if (!Number.isFinite(n)) return 0;
  return n * Math.pow(10, expo);
}

/**
 * Public query: frontend can subscribe to all rows
 */
export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("prices").collect();
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return rows;
  },
});

/**
 * ✅ Public query: frontend can subscribe to ONE symbol (BTC/ETH/SOL)
 * This is what your hook wants.
 */
export const getLatestOne = query({
  args: {
    symbol: v.union(v.literal("BTC"), v.literal("ETH"), v.literal("SOL")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("prices")
      .withIndex("by_symbol", (q) => q.eq("symbol", args.symbol))
      .unique();
  },
});

/**
 * Optional: external-worker ingest endpoint (secret protected).
 * If you fully move to cron polling, you can stop calling this from Node scripts.
 */
export const ingest = mutation({
  args: {
    secret: v.string(),
    symbol: v.string(),
    price: v.number(), // USD
    conf: v.number(),
    publishTime: v.number(), // unix seconds
  },
  handler: async (ctx, args) => {
    if (args.secret !== process.env.PRICE_INGEST_SECRET) {
      throw new Error("Unauthorized");
    }
    if (!SYMBOLS.has(args.symbol as Symbol)) {
      throw new Error("Unsupported symbol");
    }

    await ctx.runMutation(internal.prices.ingestInternal, {
      symbol: args.symbol as Symbol,
      price: args.price,
      conf: args.conf,
      publishTime: args.publishTime,
    });
  },
});

/**
 * Internal write (no secret). Used by poller/cron.
 */
export const ingestInternal = internalMutation({
  args: {
    symbol: v.union(v.literal("BTC"), v.literal("ETH"), v.literal("SOL")),
    price: v.number(),
    conf: v.number(),
    publishTime: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("prices")
      .withIndex("by_symbol", (q) => q.eq("symbol", args.symbol))
      .unique();

    if (!existing) {
      await ctx.db.insert("prices", {
        symbol: args.symbol,
        lastPrice: args.price,
        lastConf: args.conf,
        lastPublishTime: args.publishTime,
        prevPrice: args.price,
        prevConf: args.conf,
        prevPublishTime: args.publishTime,
        updatedAt: now,
      });
      return;
    }

    // ignore duplicates / stale
    if (args.publishTime <= existing.lastPublishTime) return;

    await ctx.db.patch(existing._id, {
      prevPrice: existing.lastPrice,
      prevConf: existing.lastConf,
      prevPublishTime: existing.lastPublishTime,

      lastPrice: args.price,
      lastConf: args.conf,
      lastPublishTime: args.publishTime,

      updatedAt: now,
    });
  },
});

/**
 * Internal action: poll Hermes once and write latest prices.
 * Cron will call this every ~3 seconds in production.
 */
export const pollPyth = internalAction({
  args: {},
  handler: async (ctx) => {
    const hermes = new HermesClient("https://hermes.pyth.network", {
      timeout: 20_000,
    });

    const idToSymbol: Record<string, Symbol> = {
      [FEED_IDS.BTC]: "BTC",
      [FEED_IDS.ETH]: "ETH",
      [FEED_IDS.SOL]: "SOL",
    };

    const ids = Object.keys(idToSymbol);

    const res = (await hermes.getLatestPriceUpdates(ids, { parsed: true })) as {
      parsed?: ParsedUpdate[];
    };

    const parsed = Array.isArray(res.parsed) ? res.parsed : [];

    for (const u of parsed) {
      const symbol = idToSymbol[u.id];
      if (!symbol) continue;

      const pt = u.price.publish_time;
      if (!Number.isFinite(pt)) continue;

      const price = toNumber(u.price.price, u.price.expo);
      const conf = toNumber(u.price.conf, u.price.expo);

      await ctx.runMutation(internal.prices.ingestInternal, {
        symbol,
        price,
        conf,
        publishTime: pt,
      });
    }
  },
});
