import { NextRequest, NextResponse } from "next/server";

/**
 * Centralized middleware for defense-in-depth on API routes.
 *
 * Individual route handlers still perform their own full auth, CSRF,
 * and rate limiting — this layer is a safety net that rejects obviously
 * unauthenticated mutating requests before they reach handler code.
 */

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "haven_session";

// API routes that accept POST without a session cookie
const PUBLIC_API_ROUTES = new Set([
  "/api/auth/session",  // login — no session yet
  "/api/auth/logout",   // logout — clears cookie
  "/api/auth/onboard",  // onboarding — uses session internally but may have edge cases
  "/api/rpc",           // RPC proxy — has its own CSRF + rate limiting
  "/api/user/invite/track", // public invite tracking
]);

// Prefixes that are public (read-only price feeds, etc.)
const PUBLIC_API_PREFIXES = [
  "/api/prices/",
];

function isPublicApi(pathname: string): boolean {
  if (PUBLIC_API_ROUTES.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only guard /api/* routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Only guard mutating methods (GET is read-only)
  if (!MUTATING_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  // Skip public API routes
  if (isPublicApi(pathname)) {
    return NextResponse.next();
  }

  // Defense-in-depth: reject if no session cookie is present.
  // The route handler will do full JWT verification — this just
  // catches the easy case where there's no cookie at all.
  const sessionCookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        code: "NO_SESSION",
        userMessage: "Please log in to continue.",
      },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
