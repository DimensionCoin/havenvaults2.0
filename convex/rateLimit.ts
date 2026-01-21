// convex/rateLimit.ts
import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Fixed window rate limit.
 * Example: limit=5, windowMs=1000 means "5 calls per second".
 *
 * Returns:
 *  - { ok: true, remaining, resetMs } if allowed
 *  - { ok: false, remaining: 0, resetMs } if blocked
 */
export const consume = mutation({
  args: {
    key: v.string(),
    limit: v.optional(v.number()), // default 5
    windowMs: v.optional(v.number()), // default 1000
    nowMs: v.optional(v.number()), // default Date.now()
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const windowMs = args.windowMs ?? 1000;
    const nowMs = args.nowMs ?? Date.now();

    // Fixed windows aligned to windowMs.
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const resetMs = windowStart + windowMs;

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_window", (q) =>
        q.eq("key", args.key).eq("windowStart", windowStart),
      )
      .unique();

    if (!existing) {
      // First hit in this window
      await ctx.db.insert("rateLimits", {
        key: args.key,
        windowStart,
        count: 1,
        // Keep a small buffer so late requests can still find the doc.
        expiresAt: resetMs + windowMs,
      });

      return { ok: true, remaining: Math.max(0, limit - 1), resetMs };
    }

    if (existing.count >= limit) {
      return { ok: false, remaining: 0, resetMs };
    }

    await ctx.db.patch(existing._id, { count: existing.count + 1 });

    return {
      ok: true,
      remaining: Math.max(0, limit - (existing.count + 1)),
      resetMs,
    };
  },
});

/**
 * Optional cleanup you can run periodically (daily/hourly/minutely) via a scheduled job.
 * Deletes expired windows so storage doesn't grow over time.
 */
export const cleanupExpired = internalMutation({
  args: { nowMs: v.optional(v.number()), maxDeletes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const maxDeletes = args.maxDeletes ?? 500;

    const expired = await ctx.db
      .query("rateLimits")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", nowMs))
      .take(maxDeletes);

    for (const doc of expired) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: expired.length };
  },
});
