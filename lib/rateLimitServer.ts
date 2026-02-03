// lib/rateLimitServer.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getSessionFromCookies } from "@/lib/auth";
import { logErrorEvent, shouldLogStatus } from "@/lib/logErrorEvent";

type AuthSession = { sub?: string; userId?: string } | null;

export type RateLimitTier = {
  limit: number;
  windowMs: number;
  suffix: string;
};

export type RateLimitServerOptions = {
  api: string;
  scope?: string;

  requireAuth?: boolean;
  allowIpFallback?: boolean;

  tiers?: RateLimitTier[];

  perSecond?: number;
  limit?: number;
  windowMs?: number;

  failMode?: "closed" | "open";

  globalTiers?: RateLimitTier[];
};

function getClientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";

  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();

  return "unknown";
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

let convexClient: ConvexHttpClient | null = null;

function getConvexClient(): ConvexHttpClient {
  if (convexClient) return convexClient;

  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error(
      "Missing CONVEX_URL (preferred) or NEXT_PUBLIC_CONVEX_URL env var",
    );
  }

  convexClient = new ConvexHttpClient(url);
  return convexClient;
}

async function buildRateLimitKey(
  req: NextRequest,
  opts: RateLimitServerOptions,
): Promise<{ key: string | null; kind: "user" | "ip" | "none" }> {
  const session = (await getSessionFromCookies()) as AuthSession;

  const userId = safeString(session?.userId);
  if (userId) return { key: `uid:${userId}`, kind: "user" };

  const sub = safeString(session?.sub);
  if (sub) return { key: `sub:${sub}`, kind: "user" };

  const allowIpFallback = opts.allowIpFallback ?? true;
  if (!opts.requireAuth && allowIpFallback) {
    const ip = getClientIp(req);
    if (ip && ip !== "unknown") return { key: `ip:${ip}`, kind: "ip" };
  }

  return { key: null, kind: "none" };
}

function resolveTiers(opts: RateLimitServerOptions): RateLimitTier[] {
  if (opts.tiers && opts.tiers.length > 0) return opts.tiers;

  const perSecond = opts.perSecond;
  const limit = perSecond ?? opts.limit ?? 5;
  const windowMs = perSecond ? 1000 : (opts.windowMs ?? 1000);

  return [{ limit, windowMs, suffix: "default" }];
}

function tooManyRequestsResponse(params: {
  limit: number;
  windowMs: number;
  resetMs: number;
  scopeLabel?: string;
}): NextResponse {
  const { limit, windowMs, resetMs, scopeLabel } = params;

  const retryAfterSec = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));

  const res = NextResponse.json(
    {
      error: "Too Many Requests",
      limit,
      windowMs,
      retryAfterSec,
      ...(scopeLabel ? { scope: scopeLabel } : {}),
    },
    { status: 429 },
  );

  res.headers.set("Retry-After", String(retryAfterSec));
  res.headers.set("X-RateLimit-Limit", String(limit));
  res.headers.set("X-RateLimit-Remaining", "0");
  res.headers.set("X-RateLimit-Reset", String(Math.floor(resetMs / 1000)));
  return res;
}

/**
 * Call at the TOP of any API route.
 *
 * Uses `consumeMulti` to batch ALL tier checks (global + user) into a
 * single Convex transaction. This:
 *   - Reduces latency (1 round-trip instead of N)
 *   - Is atomic (no over-counting if a later tier blocks)
 */
export async function rateLimitServer(
  req: NextRequest,
  opts: RateLimitServerOptions,
): Promise<NextResponse | null> {
  const { key, kind } = await buildRateLimitKey(req, opts);

  if (opts.requireAuth && kind !== "user") {
    const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (shouldLogStatus(401)) {
      await logErrorEvent({
        req,
        error: "Unauthorized",
        route: opts.api,
        status: 401,
        meta: { scope: opts.scope, method: req.method },
      });
      res.headers.set("X-Haven-Error-Logged", "1");
    }
    return res;
  }

  if (!key) {
    const res = NextResponse.json(
      { error: "Rate limit key unavailable" },
      { status: 429 },
    );
    if (shouldLogStatus(429)) {
      await logErrorEvent({
        req,
        error: "Rate limit key unavailable",
        route: opts.api,
        status: 429,
        meta: { scope: opts.scope, method: req.method },
      });
      res.headers.set("X-Haven-Error-Logged", "1");
    }
    return res;
  }

  const method = req.method || "UNKNOWN";
  const scope = opts.scope ? `:${opts.scope}` : "";
  const failMode = opts.failMode ?? "closed";
  const client = getConvexClient();

  // Build all tier keys into a single array for one Convex call
  const allTiers: Array<{ key: string; limit: number; windowMs: number }> = [];

  // Global tiers first (checked first = fail-fast for infra protection)
  for (const tier of opts.globalTiers ?? []) {
    allTiers.push({
      key: `${opts.api}${scope}:${method}:global:${tier.suffix}`,
      limit: tier.limit,
      windowMs: tier.windowMs,
    });
  }

  // Per-user / per-IP tiers
  for (const tier of resolveTiers(opts)) {
    allTiers.push({
      key: `${opts.api}${scope}:${method}:${key}:${tier.suffix}`,
      limit: tier.limit,
      windowMs: tier.windowMs,
    });
  }

  try {
    const result = await client.mutation(api.rateLimit.consumeMulti, {
      tiers: allTiers,
    });

    if (!result.ok) {
      const blocked = result as {
        ok: false;
        blocked: true;
        limit: number;
        windowMs: number;
        resetMs: number;
        key: string;
      };
      const isGlobal = blocked.key?.includes(":global:");
      const res = tooManyRequestsResponse({
        limit: blocked.limit,
        windowMs: blocked.windowMs,
        resetMs: blocked.resetMs,
        scopeLabel: isGlobal ? "global" : "user",
      });
      res.headers.set("X-Haven-Error-Logged", "1");
      if (shouldLogStatus(429)) {
        await logErrorEvent({
          req,
          error: "Rate limit exceeded",
          route: opts.api,
          status: 429,
          meta: {
            scope: opts.scope,
            method: req.method,
            limit: blocked.limit,
            windowMs: blocked.windowMs,
            resetMs: blocked.resetMs,
            scopeLabel: isGlobal ? "global" : "user",
          },
        });
      }
      if (isGlobal) res.headers.set("X-RateLimit-Scope", "global");
      return res;
    }

    return null;
  } catch (err) {
    if (failMode === "open") return null;

    console.error("[rateLimitServer] Convex consumeMulti failed:", err);
    const res = NextResponse.json(
      { error: "Temporarily unavailable" },
      { status: 503 },
    );
    if (shouldLogStatus(503)) {
      try {
        await logErrorEvent({
          req,
          error: err,
          route: opts.api,
          status: 503,
          meta: { scope: opts.scope, method: req.method },
        });
        res.headers.set("X-Haven-Error-Logged", "1");
      } catch (logErr) {
        console.error("[rateLimitServer] logErrorEvent failed:", logErr);
      }
    }
    return res;
  }
}
