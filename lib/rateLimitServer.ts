// lib/rateLimitServer.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getSessionFromCookies } from "@/lib/auth";

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

  /** ✅ NEW: global tiers across all users */
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

async function consumeTier(params: {
  client: ConvexHttpClient;
  rlKey: string;
  tier: RateLimitTier;
  failMode: "closed" | "open";
}): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const { client, rlKey, tier, failMode } = params;

  try {
    const result = await client.mutation(api.rateLimit.consume, {
      key: rlKey,
      limit: tier.limit,
      windowMs: tier.windowMs,
    });

    if (result.ok) return { ok: true };

    return {
      ok: false,
      res: tooManyRequestsResponse({
        limit: tier.limit,
        windowMs: tier.windowMs,
        resetMs: result.resetMs,
      }),
    };
  } catch (err) {
    if (failMode === "open") return { ok: true };

    console.error("[rateLimitServer] Convex consume failed:", err);
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Temporarily unavailable" },
        { status: 503 },
      ),
    };
  }
}

/**
 * ✅ Call at the TOP of any API route.
 */
export async function rateLimitServer(
  req: NextRequest,
  opts: RateLimitServerOptions,
): Promise<NextResponse | null> {
  const { key, kind } = await buildRateLimitKey(req, opts);

  if (opts.requireAuth && kind !== "user") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!key) {
    return NextResponse.json(
      { error: "Rate limit key unavailable" },
      { status: 429 },
    );
  }

  const method = req.method || "UNKNOWN";
  const scope = opts.scope ? `:${opts.scope}` : "";
  const failMode = opts.failMode ?? "closed";
  const client = getConvexClient();

  // ✅ 1) GLOBAL TIERS (protect infra even if attackers have many accounts)
  const globalTiers = opts.globalTiers ?? [];
  for (const tier of globalTiers) {
    const globalKey = `${opts.api}${scope}:${method}:global:${tier.suffix}`;
    const r = await consumeTier({ client, rlKey: globalKey, tier, failMode });
    if (!r.ok) {
      // Add a hint so you can tell it was global in logs/UI if you want
      r.res.headers.set("X-RateLimit-Scope", "global");
      return r.res;
    }
  }

  // ✅ 2) PER-USER / PER-IP TIERS
  const tiers = resolveTiers(opts);
  for (const tier of tiers) {
    const rlKey = `${opts.api}${scope}:${method}:${key}:${tier.suffix}`;
    const r = await consumeTier({ client, rlKey, tier, failMode });
    if (!r.ok) {
      r.res.headers.set("X-RateLimit-Scope", "user");
      return r.res;
    }
  }

  return null;
}
