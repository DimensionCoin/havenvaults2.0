// convex/rateLimit.ts
import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Fixed-window rate limiter.
 *
 * - Keyed by: (key, windowStart)
 * - Allows up to `limit` hits per window (`windowMs`)
 *
 * Returns:
 *  - { ok: true, remaining, resetMs, windowStart } if allowed
 *  - { ok: false, remaining: 0, resetMs, windowStart } if blocked
 */
export const consume = mutation({
  args: {
    key: v.string(),
    limit: v.optional(v.number()), // default 5
    windowMs: v.optional(v.number()), // default 1000
  },
  handler: async (ctx, args) => {
    // ---- sanitize inputs (avoid footguns / abuse) ----
    const rawLimit = args.limit ?? 5;
    const rawWindowMs = args.windowMs ?? 1000;

    // Clamp to safe-ish ranges:
    // - limit: 1..10_000
    // - windowMs: 250ms..30 days
    const limit = Math.max(1, Math.min(10_000, Math.floor(rawLimit)));
    const windowMs = Math.max(
      250,
      Math.min(30 * 24 * 60 * 60 * 1000, Math.floor(rawWindowMs)),
    );

    const nowMs = Date.now();

    // Fixed windows aligned to windowMs
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const resetMs = windowStart + windowMs;

    // NOTE:
    // expiresAt includes a buffer window so late/parallel requests
    // can still find the doc even right after the window rolls.
    const expiresAt = resetMs + windowMs;

    // Look up the counter for this key+window
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_window", (q) =>
        q.eq("key", args.key).eq("windowStart", windowStart),
      )
      .unique();

    // First hit in this window → create doc
    if (!existing) {
      await ctx.db.insert("rateLimits", {
        key: args.key,
        windowStart,
        count: 1,
        expiresAt,
      });

      return {
        ok: true,
        remaining: Math.max(0, limit - 1),
        resetMs,
        windowStart,
      };
    }

    // Already at limit → reject
    if (existing.count >= limit) {
      return {
        ok: false,
        remaining: 0,
        resetMs,
        windowStart,
      };
    }

    // Increment count
    await ctx.db.patch(existing._id, { count: existing.count + 1 });

    return {
      ok: true,
      remaining: Math.max(0, limit - (existing.count + 1)),
      resetMs,
      windowStart,
    };
  },
});

/**
 * Cleanup job:
 * Deletes expired windows so the table doesn't grow forever.
 *
 * Call from cron (every 5–15 minutes is fine).
 */
export const cleanupExpired = internalMutation({
  args: {
    nowMs: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    // Keep per-mutation work bounded to avoid Convex timeouts.
    const hardCap =
      Number(process.env.RATE_LIMIT_MAX_DELETES ?? "5000") || 5000;
    const maxDeletes = Math.max(
      1,
      Math.min(hardCap, args.maxDeletes ?? 500),
    );

    let deleted = 0;

    // Delete in batches (Convex `take(n)` is already a batch)
    while (deleted < maxDeletes) {
      const batchSize = Math.min(1000, maxDeletes - deleted);

      const expired = await ctx.db
        .query("rateLimits")
        .withIndex("by_expiresAt", (q) => q.lt("expiresAt", nowMs))
        .take(batchSize);

      if (expired.length === 0) break;

      for (const doc of expired) {
        await ctx.db.delete(doc._id);
      }

      deleted += expired.length;

      // Safety: if we got less than requested, no more remain
      if (expired.length < batchSize) break;
    }

    return { deleted };
  },
});
