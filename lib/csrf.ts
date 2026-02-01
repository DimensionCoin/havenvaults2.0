// lib/csrf.ts
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "haven_session";
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || "haven_csrf";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Validates CSRF for state-changing requests that rely on the session cookie.
 * - Requires matching double-submit token (cookie + header), OR
 * - Same-origin check on Origin/Referer as a fallback.
 * Returns a NextResponse (403) on failure, otherwise null.
 */
export function validateCsrf(req: NextRequest): NextResponse | null {
  if (SAFE_METHODS.has(req.method)) return null;

  // Only enforce if a session cookie is present (auth will still run later).
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  const csrfCookie = req.cookies.get(CSRF_COOKIE_NAME)?.value || "";
  const csrfHeader = req.headers.get("x-csrf-token") || "";

  const hasMatchingToken = csrfCookie && csrfHeader && csrfCookie === csrfHeader;

  // Same-origin fallback: allow if Origin/Referer host matches request host.
  const host = req.headers.get("host");
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  let sameOrigin = false;
  try {
    if (origin && host) {
      const originHost = new URL(origin).host;
      sameOrigin = originHost === host;
    }
  } catch {
    sameOrigin = false;
  }

  if (hasMatchingToken || sameOrigin) return null;

  return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
}

export const CSRF_COOKIE = CSRF_COOKIE_NAME;
export const CSRF_HEADER = "x-csrf-token";
