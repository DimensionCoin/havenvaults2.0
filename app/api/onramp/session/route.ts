// app/api/onramp/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONRAMP_SESSION_URL =
  "https://api.cdp.coinbase.com/platform/v2/onramp/sessions";

const API_KEY_ID = process.env.COINBASE_API_KEY_ID!;
const API_KEY_SECRET = process.env.COINBASE_API_SECRET!;

// Comma-separated list, e.g.
// NEXT_PUBLIC_APP_ORIGINS="https://haven.com,https://www.haven.com,http://localhost:3000"
const ORIGINS = (process.env.NEXT_PUBLIC_APP_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = ORIGINS.includes(origin) ? origin : ORIGINS[0] || ""; // strict allowlist

  // If you don't have cross-origin needs, keeping this strict is good.
  // For same-origin calls, browsers still send Origin, so this works.
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    // Only set this if you truly need cookies cross-origin.
    // If your frontend calls same-origin (/api/...), cookies work without cross-origin CORS anyway.
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
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  // CORS preflight
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

interface RequestBody {
  destinationAddress: string;
  purchaseCurrency?: string;
  destinationNetwork?: string;
  paymentCurrency?: string;
  paymentAmount?: string;
  redirectUrl?: string;
  // partnerUserRef?: string; // ❌ don't trust this from client
  sandbox?: boolean;
  country?: string;
  subdivision?: string;
}

type UserIdLike = {
  _id?: { toString?: () => string } | string;
  id?: { toString?: () => string } | string;
  privyId?: string | null;
};

function toIdString(
  value: { toString?: () => string } | string | undefined
): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return undefined;
}

export async function POST(req: NextRequest) {
  const timings: Record<string, number> = {};
  const start = Date.now();

  if (!API_KEY_ID || !API_KEY_SECRET) {
    return json(req, 500, { error: "Missing Coinbase API credentials" });
  }

  // ✅ Auth (uses your Haven session cookie)
  let user: UserIdLike;
  try {
    user = (await requireServerUser()) as UserIdLike;
  } catch {
    return json(req, 401, { error: "Unauthorized" });
  }

  // ✅ Basic origin enforcement (recommended when you claim CORS/auth)
  const origin = req.headers.get("origin") || "";
  if (ORIGINS.length && !ORIGINS.includes(origin)) {
    return json(req, 403, { error: "Forbidden origin" });
  }

  let body: Partial<RequestBody>;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Invalid JSON body" });
  }

  timings.parse = Date.now() - start;

  const destinationAddress = (body.destinationAddress || "").trim();
  const purchaseCurrency = (body.purchaseCurrency || "USDC").trim();
  const destinationNetwork = (body.destinationNetwork || "solana").trim();
  const paymentCurrency = (body.paymentCurrency || "USD").trim();
  const paymentAmount = body.paymentAmount?.trim();
  const redirectUrl = body.redirectUrl?.trim();
  const sandbox = Boolean(body.sandbox);

  // ✅ Build partnerUserRef on server from authenticated user (no spoofing)
  const baseRef =
    toIdString(user?._id) ||
    toIdString(user?.id) ||
    user?.privyId ||
    "unknown";

  const partnerUserRef = sandbox
    ? `sandbox-user-${baseRef}`
    : `user-${baseRef}`;

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

  // Build Coinbase payload
  const sessionPayload: Record<string, string> = {
    destinationAddress,
    purchaseCurrency,
    destinationNetwork,
    partnerUserRef,
  };

  if (paymentCurrency) sessionPayload.paymentCurrency = paymentCurrency;
  if (paymentAmount && parseFloat(paymentAmount) > 0) {
    sessionPayload.paymentAmount = paymentAmount;
  }
  if (redirectUrl) sessionPayload.redirectUrl = redirectUrl;
  if (country && /^[A-Z]{2}$/.test(country)) sessionPayload.country = country;
  if (country === "US" && subdivision) sessionPayload.subdivision = subdivision;

  try {
    const jwtStart = Date.now();
    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_KEY_SECRET,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/onramp/sessions",
      expiresIn: 120,
    });
    timings.jwt = Date.now() - jwtStart;

    const fetchStart = Date.now();
    const response = await fetch(ONRAMP_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionPayload),
    });
    timings.fetch = Date.now() - fetchStart;

    const responseText = await response.text();

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(responseText);
    } catch {
      return json(req, 502, { error: "Invalid response from Coinbase" });
    }

    if (!response.ok) {
      return json(req, response.status >= 500 ? 502 : 400, {
        error:
          (data.errorMessage as string) ||
          (data.message as string) ||
          "Coinbase API error",
        coinbaseError: data,
      });
    }

    let onrampUrl: string | undefined;

    const session = data.session as Record<string, unknown> | undefined;
    if (session?.onrampUrl) onrampUrl = session.onrampUrl as string;
    if (!onrampUrl && data.onrampUrl) onrampUrl = data.onrampUrl as string;
    if (!onrampUrl && data.url) onrampUrl = data.url as string;
    if (!onrampUrl && data.data) {
      const nested = data.data as Record<string, unknown>;
      const nestedSession = nested.session as
        | Record<string, unknown>
        | undefined;
      if (nestedSession?.onrampUrl)
        onrampUrl = nestedSession.onrampUrl as string;
    }

    if (!onrampUrl) {
      return json(req, 502, {
        error: "No onramp URL in Coinbase response",
        debug: process.env.NODE_ENV === "development" ? data : undefined,
      });
    }

    const finalUrl = sandbox ? toSandboxUrl(onrampUrl) : onrampUrl;
    timings.total = Date.now() - start;

    return json(req, 200, {
      onrampUrl: finalUrl,
      sandbox,
      timings: process.env.NODE_ENV === "development" ? timings : undefined,
    });
  } catch (error) {
    return json(req, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
