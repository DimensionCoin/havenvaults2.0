import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  prices: defineTable({
    // "BTC" | "ETH" | "SOL"
    symbol: v.string(),

    // latest
    lastPrice: v.number(), // USD
    lastConf: v.number(),
    lastPublishTime: v.number(), // unix seconds

    // previous (so UI can compute delta)
    prevPrice: v.number(),
    prevConf: v.number(),
    prevPublishTime: v.number(),

    updatedAt: v.number(), // ms
  }).index("by_symbol", ["symbol"]),
});
