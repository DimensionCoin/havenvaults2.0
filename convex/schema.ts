import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /* ───────────────────────── Prices ───────────────────────── */

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

  /* ─────────────────────── Rate Limiting ─────────────────────── */

  /**
   * Fixed-window per-user rate limiting.
   *
   * Example key:
   *   "jup:build:POST:sub:abc123"
   *
   * This allows:
   *   - per-user
   *   - per-API
   *   - per-method
   * limits like "5 requests / second".
   */
  rateLimits: defineTable({
    // unique key for this limiter bucket
    key: v.string(),

    // start of the fixed window (ms since epoch)
    windowStart: v.number(),

    // number of hits in this window
    count: v.number(),

    // when this record can be safely deleted (ms since epoch)
    expiresAt: v.number(),
  })
    // fast lookup for "does this user already have a window open?"
    .index("by_key_window", ["key", "windowStart"])
    // used by cleanup job
    .index("by_expiresAt", ["expiresAt"]),
});
