// lib/auth.ts
import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ENV + constants
 */
const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) {
  throw new Error("Missing JWT_SECRET env var");
}

export const JWT_SECRET_BYTES = new TextEncoder().encode(rawSecret);

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME || "haven_session";
export const CSRF_COOKIE_NAME =
  process.env.CSRF_COOKIE_NAME || "haven_csrf";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_TTL_SECONDS = Number(
  process.env.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS
);

/**
 * What we store in the session JWT.
 *
 * sub    -> Privy user id (privyId)
 * userId -> optional Mongo User._id
 * email  -> optional email
 */
export interface SessionPayload extends JWTPayload {
  sub: string; // privyId (required)
  userId?: string; // optional
  email?: string; // optional
}

/**
 * Sign a session token.
 */
export async function signSessionToken(
  payload: SessionPayload
): Promise<string> {
  if (!payload.sub) {
    throw new Error("Cannot sign session token without sub (privyId)");
  }

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(JWT_SECRET_BYTES);
}

/**
 * Verify a session token and return the decoded payload.
 */
export async function verifySessionToken(
  token?: string | null
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_BYTES, {
      algorithms: ["HS256"],
    });

    if (typeof payload.sub !== "string") return null;

    return payload as SessionPayload;
  } catch (err) {
    console.error("Invalid session token:", err);
    return null;
  }
}

/**
 * Read the session from the request cookies.
 */
export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  // 👈 in your Next version, cookies() is async
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

/**
 * Compute an HMAC binding a CSRF nonce to a session subject.
 * This ensures the CSRF cookie cannot be forged without the server secret
 * and is bound to the specific user session.
 */
function computeCsrfHmac(nonce: string, sessionSub: string): string {
  return createHmac("sha256", JWT_SECRET_BYTES)
    .update(`csrf:${nonce}:${sessionSub}`)
    .digest("hex");
}

/**
 * Set the HttpOnly session cookie.
 */
export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const cookieStore = await cookies();
  const token = await signSessionToken(payload);

  const nonce = crypto.randomUUID();
  const sig = computeCsrfHmac(nonce, payload.sub);
  const csrfToken = `${nonce}.${sig}`;

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  // Double-submit token for CSRF protection (readable by client JS)
  // Value is HMAC-bound to the session subject so it cannot be forged.
  cookieStore.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Clear the session cookie (logout).
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  cookieStore.set(CSRF_COOKIE_NAME, "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Verify CSRF double-submit token on state-changing requests.
 *
 * Reads the CSRF cookie and compares it to the client-sent header
 * (X-CSRF-Token). The cookie value is `nonce.hmac` where the HMAC
 * is bound to the authenticated session's `sub`, so a stolen cookie
 * value from a different session cannot pass verification.
 *
 * Returns `true` when valid, `false` when the check fails.
 */
export async function verifyCsrfToken(
  headerToken: string | null | undefined,
): Promise<boolean> {
  if (!headerToken) return false;

  const cookieStore = await cookies();
  const csrfCookie = cookieStore.get(CSRF_COOKIE_NAME)?.value;

  // Double-submit: header must match cookie
  if (!csrfCookie || csrfCookie !== headerToken) return false;

  // Split nonce.hmac
  const dotIdx = csrfCookie.indexOf(".");
  if (dotIdx < 1) return false;

  const nonce = csrfCookie.slice(0, dotIdx);
  const sig = csrfCookie.slice(dotIdx + 1);
  if (!sig) return false;

  // Read session to get the bound subject
  const session = await getSessionFromCookies();
  if (!session?.sub) return false;

  // Recompute and compare with timing-safe equality
  const expected = computeCsrfHmac(nonce, session.sub);

  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(sigBuf, expectedBuf);
}
