// app/api/onramp/session/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONRAMP_SESSION_URL =
  "https://api.cdp.coinbase.com/platform/v2/onramp/sessions";

const API_KEY_ID = process.env.COINBASE_API_KEY_ID!;
const API_KEY_SECRET = process.env.COINBASE_API_SECRET!;

// Optional: comma-separated list of allowed web origins for browser calls
// NEXT_PUBLIC_APP_ORIGINS="https://staging.haven.com,http://localhost:3000"
const ORIGINS = (process.env.NEXT_PUBLIC_APP_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// CDP review envs (set in Vercel Staging/Preview)
const REVIEW_KEY = process.env.CDP_REVIEW_KEY || "";
const DEFAULT_REVIEW_DEST = process.env.CDP_REVIEW_DESTINATION || "";

/* ───────── helpers ───────── */

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = ORIGINS.includes(origin) ? origin : ORIGINS[0] || "";
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-CDP-Review-Key",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function json(req: NextRequest, status: number, body: unknown) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

function isProbablySolanaAddress(addr: string): boolean {
  const a = (addr || "").trim();
  if (a.length < 32 || a.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(a);
}

function toSandboxUrl(onrampUrl: string): string {
  try {
    const u = new URL(onrampUrl);
    u.host = "pay-sandbox.coinbase.com";
    return u.toString();
  } catch {
    return onrampUrl;
  }
}

function getReviewKey(req: NextRequest, url: URL): string | null {
  // Prefer header; allow Authorization: Bearer <key>; fallback query ?key=
  const header =
    req.headers.get("x-cdp-review-key") ||
    req.headers.get("X-CDP-Review-Key") ||
    null;

  const auth = req.headers.get("authorization");
  const bearer =
    auth && auth.toLowerCase().startsWith("bearer ")
      ? auth.slice("bearer ".length).trim()
      : null;

  return header || bearer || url.searchParams.get("key");
}

function wantsJson(req: NextRequest): boolean {
  const accept = req.headers.get("accept") || "";
  return accept.includes("application/json");
}

type UserIdLike = {
  _id?: { toString?: () => string } | string;
  id?: { toString?: () => string } | string;
  privyId?: string | null;
};

function toIdString(
  value: { toString?: () => string } | string | undefined,
): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return undefined;
}

interface RequestBody {
  destinationAddress?: string;
  purchaseCurrency?: string; // e.g. USDC
  destinationNetwork?: string; // solana
  paymentCurrency?: string; // USD
  paymentAmount?: string; // "5"
  redirectUrl?: string;
  sandbox?: boolean;
  country?: string;
  subdivision?: string;
}

type CoinbaseSessionish = { onrampUrl?: string; [k: string]: unknown };
type CoinbaseOnrampResponse = {
  errorMessage?: string;
  message?: string;
  session?: CoinbaseSessionish;
  onrampUrl?: string;
  url?: string;
  data?: { session?: CoinbaseSessionish; [k: string]: unknown };
  [k: string]: unknown;
};

function parseJsonObject(text: string): CoinbaseOnrampResponse | null {
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object") return v as CoinbaseOnrampResponse;
    return null;
  } catch {
    return null;
  }
}

/* ───────── main ───────── */

export async function POST(req: NextRequest) {
  if (!API_KEY_ID || !API_KEY_SECRET) {
    return json(req, 500, { error: "Missing Coinbase API credentials" });
  }

  const url = new URL(req.url);

  // Browser-origin enforcement: ONLY enforce when Origin header exists.
  // (curl/server-to-server typically has no Origin)
  const origin = req.headers.get("origin") || "";
  if (ORIGINS.length && origin && !ORIGINS.includes(origin)) {
    return json(req, 403, { error: "Forbidden origin" });
  }

  // Parse JSON body (both app + review use POST JSON)
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json(req, 400, { error: "Invalid JSON body" });
  }

  // Try normal app auth first
  let user: UserIdLike | null = null;
  try {
    user = (await requireServerUser()) as UserIdLike;
  } catch {
    user = null;
  }

  // If no app user, allow CDP review key to authorize
  const reviewKey = getReviewKey(req, url);
  const isReview =
    !user &&
    Boolean(REVIEW_KEY) &&
    Boolean(reviewKey) &&
    reviewKey === REVIEW_KEY;

  if (!user && !isReview) {
    return json(req, 401, { error: "Unauthorized" });
  }

  // Inputs
  const sandbox = Boolean(body.sandbox);

  // In review mode, default destination to env var and do NOT require client to pass it.
  // In app mode, require destinationAddress in body.
  const destinationAddress = (
    (body.destinationAddress || "").trim() ||
    (isReview ? DEFAULT_REVIEW_DEST : "")
  ).trim();

  const purchaseCurrency = (body.purchaseCurrency || "USDC").trim();
  const destinationNetwork = (body.destinationNetwork || "solana").trim();
  const paymentCurrency = (body.paymentCurrency || "USD").trim();
  const paymentAmount = (body.paymentAmount || (isReview ? "5" : "")).trim();
  const redirectUrl = (body.redirectUrl || "").trim();

  const country = (body.country || "").toUpperCase() || undefined;
  const subdivision = body.subdivision?.toUpperCase();

  if (!destinationAddress) {
    return json(req, 400, { error: "Missing destinationAddress" });
  }

  if (
    destinationNetwork.toLowerCase() === "solana" &&
    !isProbablySolanaAddress(destinationAddress)
  ) {
    return json(req, 400, { error: "Invalid Solana address format" });
  }

  // partnerUserRef:
  // - app: derived from authenticated user (anti-spoof)
  // - review: fixed reviewer tag
  const baseRef = user
    ? toIdString(user._id) || toIdString(user.id) || user.privyId || "unknown"
    : "cdp-review";

  const partnerUserRef = isReview
    ? sandbox
      ? "sandbox-cdp-review"
      : "cdp-review"
    : sandbox
      ? `sandbox-user-${baseRef}`
      : `user-${baseRef}`;

  const sessionPayload: Record<string, string> = {
    destinationAddress,
    purchaseCurrency,
    destinationNetwork,
    partnerUserRef,
    paymentCurrency,
  };

  // Only include paymentAmount if valid positive number
  if (paymentAmount && Number.parseFloat(paymentAmount) > 0) {
    sessionPayload.paymentAmount = paymentAmount;
  }

  if (redirectUrl) sessionPayload.redirectUrl = redirectUrl;
  if (country && /^[A-Z]{2}$/.test(country)) sessionPayload.country = country;
  if (country === "US" && subdivision) sessionPayload.subdivision = subdivision;

  try {
    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_KEY_SECRET,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/onramp/sessions",
      expiresIn: 120,
    });

    const response = await fetch(ONRAMP_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionPayload),
      cache: "no-store",
    });

    const responseText = await response.text();
    const data = parseJsonObject(responseText);

    if (!data) {
      return json(req, 502, { error: "Invalid response from Coinbase" });
    }

    if (!response.ok) {
      return json(req, response.status >= 500 ? 502 : 400, {
        error: data.errorMessage || data.message || "Coinbase API error",
        coinbaseError: data,
      });
    }

    let onrampUrl: string | undefined;
    if (data.session?.onrampUrl) onrampUrl = data.session.onrampUrl;
    if (!onrampUrl && typeof data.onrampUrl === "string")
      onrampUrl = data.onrampUrl;
    if (!onrampUrl && typeof data.url === "string") onrampUrl = data.url;
    if (!onrampUrl && data.data?.session?.onrampUrl)
      onrampUrl = data.data.session.onrampUrl;

    if (!onrampUrl) {
      return json(req, 502, { error: "No onramp URL in Coinbase response" });
    }

    const finalUrl = sandbox ? toSandboxUrl(onrampUrl) : onrampUrl;

    // In app flows you probably want JSON anyway.
    // For review flows, returning JSON is best for curl ("Copy as cURL").
    // If you ever want redirect, you can add ?redirect=1.
    const redirect = url.searchParams.get("redirect") === "1";

    if (redirect && !wantsJson(req)) {
      const res = NextResponse.redirect(finalUrl, { status: 302 });
      res.headers.set("Cache-Control", "no-store");
      return res;
    }

    return json(req, 200, {
      onrampUrl: finalUrl,
      sandbox,
      reviewMode: isReview,
      destinationAddress,
      purchaseCurrency,
      destinationNetwork,
      paymentCurrency,
      paymentAmount,
    });
  } catch (error) {
    return json(req, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
