// convex/rateLimit.ts
import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/* ───────── Helpers ───────── */

function clampLimit(raw: number): number {
  return Math.max(1, Math.min(10_000, Math.floor(raw)));
}

function clampWindowMs(raw: number): number {
  return Math.max(250, Math.min(30 * 24 * 60 * 60 * 1000, Math.floor(raw)));
}

/* ───────── consumeMulti (preferred) ───────── */

/**
 * Batched fixed-window rate limiter.
 *
 * Checks ALL tiers in a single atomic transaction:
 *   1. Read all counters
 *   2. If any tier is at its limit → reject (no counters incremented)
 *   3. If all pass → increment all counters
 *
 * This is both faster (1 round-trip instead of N) and more correct
 * (no over-counting on partial failures).
 */
export const consumeMulti = mutation({
  args: {
    tiers: v.array(
      v.object({
        key: v.string(),
        limit: v.number(),
        windowMs: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { tiers } = args;

    if (tiers.length === 0) return { ok: true, blocked: false };

    // Cap tier count to prevent abuse via huge arrays
    if (tiers.length > 20) {
      return {
        ok: false,
        blocked: true,
        limit: 0,
        windowMs: 0,
        resetMs: Date.now() + 1000,
        key: "_overflow",
      };
    }

    const nowMs = Date.now();

    // Phase 1: Read all existing counters
    const checks: Array<{
      key: string;
      limit: number;
      windowMs: number;
      windowStart: number;
      resetMs: number;
      expiresAt: number;
      existingId: string | null;
      existingCount: number;
    }> = [];

    for (const tier of tiers) {
      const limit = clampLimit(tier.limit);
      const windowMs = clampWindowMs(tier.windowMs);
      const windowStart = Math.floor(nowMs / windowMs) * windowMs;
      const resetMs = windowStart + windowMs;
      const expiresAt = resetMs + windowMs;

      const existing = await ctx.db
        .query("rateLimits")
        .withIndex("by_key_window", (q) =>
          q.eq("key", tier.key).eq("windowStart", windowStart),
        )
        .unique();

      checks.push({
        key: tier.key,
        limit,
        windowMs,
        windowStart,
        resetMs,
        expiresAt,
        existingId: existing?._id ?? null,
        existingCount: existing?.count ?? 0,
      });
    }

    // Phase 2: Check if ANY tier would be blocked
    for (const c of checks) {
      if (c.existingCount >= c.limit) {
        return {
          ok: false,
          blocked: true,
          limit: c.limit,
          windowMs: c.windowMs,
          resetMs: c.resetMs,
          key: c.key,
        };
      }
    }

    // Phase 3: All passed — increment all counters atomically
    for (const c of checks) {
      if (c.existingId) {
        await ctx.db.patch(c.existingId as any, {
          count: c.existingCount + 1,
        });
      } else {
        await ctx.db.insert("rateLimits", {
          key: c.key,
          windowStart: c.windowStart,
          count: 1,
          expiresAt: c.expiresAt,
        });
      }
    }

    return { ok: true, blocked: false };
  },
});

/* ───────── consume (single-tier, kept for backward compat) ───────── */

/**
 * Single-tier fixed-window rate limiter.
 * Prefer `consumeMulti` for routes with multiple tiers.
 */
export const consume = mutation({
  args: {
    key: v.string(),
    limit: v.optional(v.number()),
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampLimit(args.limit ?? 5);
    const windowMs = clampWindowMs(args.windowMs ?? 1000);

    const nowMs = Date.now();
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const resetMs = windowStart + windowMs;
    const expiresAt = resetMs + windowMs;

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_window", (q) =>
        q.eq("key", args.key).eq("windowStart", windowStart),
      )
      .unique();

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

    if (existing.count >= limit) {
      return {
        ok: false,
        remaining: 0,
        resetMs,
        windowStart,
      };
    }

    await ctx.db.patch(existing._id, { count: existing.count + 1 });

    return {
      ok: true,
      remaining: Math.max(0, limit - (existing.count + 1)),
      resetMs,
      windowStart,
    };
  },
});

/* ───────── Cleanup ───────── */

/**
 * Deletes expired windows so the table doesn't grow forever.
 * Called from cron every 5 minutes.
 */
export const cleanupExpired = internalMutation({
  args: {
    nowMs: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const nowMs = args.nowMs ?? Date.now();
    const hardCap =
      Number(process.env.RATE_LIMIT_MAX_DELETES ?? "5000") || 5000;
    const maxDeletes = Math.max(
      1,
      Math.min(hardCap, args.maxDeletes ?? 500),
    );

    let deleted = 0;

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

      if (expired.length < batchSize) break;
    }

    return { deleted };
  },
});
