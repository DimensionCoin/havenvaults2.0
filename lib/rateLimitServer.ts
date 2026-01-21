// lib/rateLimitServer.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getSessionFromCookies } from "@/lib/auth";

/* ───────── Types ───────── */

/**
 * Minimal session shape we care about.
 * Matches what Privy + your auth layer provide.
 */
type AuthSession = {
  sub?: string;
  userId?: string;
} | null;

type RateLimitServerOptions = {
  /** Stable name for the API (e.g. "jup:build", "auth:onboard") */
  api: string;

  /** Defaults to 5 */
  limit?: number;

  /** Defaults to 1000ms */
  windowMs?: number;

  /** If true, only authenticated users are allowed */
  requireAuth?: boolean;

  /** Optional extra scoping */
  scope?: string;

  /** Allow IP fallback if unauthenticated (default true unless requireAuth) */
  allowIpFallback?: boolean;
};

/* ───────── Helpers ───────── */

function getClientIp(req: NextRequest): string {
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

/* ───────── Main Entry ───────── */

/**
 * Call at the TOP of any API route.
 *
 * Returns:
 *  - NextResponse (429 / 401) → immediately return it
 *  - null → request is allowed, continue handler
 */
export async function rateLimitServer(
  req: NextRequest,
  opts: RateLimitServerOptions,
): Promise<NextResponse | null> {
  const limit = opts.limit ?? 5;
  const windowMs = opts.windowMs ?? 1000;

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
  const rlKey = `${opts.api}${scope}:${method}:${key}`;

  const client = getConvexClient();
  const result = await client.mutation(api.rateLimit.consume, {
    key: rlKey,
    limit,
    windowMs,
  });

  if (result.ok) return null;

  const retryAfterSec = Math.max(
    1,
    Math.ceil((result.resetMs - Date.now()) / 1000),
  );

  const res = NextResponse.json(
    {
      error: "Too Many Requests",
      limit,
      windowMs,
      retryAfterSec,
    },
    { status: 429 },
  );

  res.headers.set("Retry-After", String(retryAfterSec));
  res.headers.set("X-RateLimit-Limit", String(limit));
  res.headers.set("X-RateLimit-Remaining", "0");
  res.headers.set("X-RateLimit-Reset", String(result.resetMs));
  return res;
}
