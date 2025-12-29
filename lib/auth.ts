// lib/auth.ts
import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

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
 * Set the HttpOnly session cookie.
 */
export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const cookieStore = await cookies();
  const token = await signSessionToken(payload);

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
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
}
