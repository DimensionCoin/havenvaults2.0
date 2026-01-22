// app/api/onramp/session/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Use the documented v1 token API endpoint
// See: https://docs.cdp.coinbase.com/onramp-&-offramp/session-token-authentication
const ONRAMP_TOKEN_URL = "https://api.developer.coinbase.com/onramp/v1/token";

const API_KEY_ID = process.env.COINBASE_API_KEY_ID!;
const API_KEY_SECRET = process.env.COINBASE_API_SECRET!;

/**
 * Use a SERVER env var for allowed origins if possible.
 */
const ORIGINS = (process.env.NEXT_PUBLIC_APP_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ───────── helpers ───────── */

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = origin && ORIGINS.includes(origin) ? origin : "";

  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

function isAllowedRedirectUrl(redirectUrl: string): boolean {
  if (!redirectUrl) return false;
  try {
    const u = new URL(redirectUrl);
    return ORIGINS.includes(u.origin);
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getUserDepositAddress(user: any): string | null {
  const candidates: unknown[] = [
    user?.walletAddress,
    typeof user?.depositWallet === "string"
      ? user.depositWallet
      : user?.depositWallet?.address,
    typeof user?.embeddedWallet === "string"
      ? user.embeddedWallet
      : user?.embeddedWallet?.address,
  ];

  const found = candidates.find(
    (v) => typeof v === "string" && v.trim().length > 0 && v !== "pending",
  );

  return typeof found === "string" ? found.trim() : null;
}

function stablePartnerRef(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 24);
}

/**
 * Extract client IP from the request.
 * Coinbase requires this for security validation.
 */
function getClientIp(req: NextRequest): string | null {
  // Vercel provides the real IP in x-real-ip header
  const realIp = req.headers.get("x-real-ip");
  if (realIp && isValidPublicIp(realIp)) {
    return realIp;
  }

  // Fallback to x-forwarded-for (first IP in the chain)
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp && isValidPublicIp(firstIp)) {
      return firstIp;
    }
  }

  // Next.js may provide IP in the request
  // @ts-expect-error - ip may exist on NextRequest in some environments
  if (req.ip && isValidPublicIp(req.ip)) {
    // @ts-expect-error - ip may exist on NextRequest in some environments
    return req.ip;
  }

  return null;
}

function isValidIp(ip: string): boolean {
  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

function isPrivateIp(ip: string): boolean {
  // Check for private/reserved IP ranges
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;

  // 10.0.0.0 - 10.255.255.255
  if (parts[0] === 10) return true;

  // 172.16.0.0 - 172.31.255.255
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // 192.168.0.0 - 192.168.255.255
  if (parts[0] === 192 && parts[1] === 168) return true;

  // 127.0.0.0 - 127.255.255.255 (loopback)
  if (parts[0] === 127) return true;

  // 0.0.0.0
  if (parts.every((p) => p === 0)) return true;

  return false;
}

function isValidPublicIp(ip: string): boolean {
  if (!isValidIp(ip)) return false;
  // For IPv4, check it's not private
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return !isPrivateIp(ip);
  }
  // For IPv6, assume it's valid (simplified)
  return true;
}

type RequestBody = {
  destinationAddress?: string;
  purchaseCurrency?: string;
  destinationNetwork?: string;
  paymentCurrency?: string;
  paymentAmount?: string;
  redirectUrl?: string;
  sandbox?: boolean;
  country?: string;
  subdivision?: string;
};

const ALLOWED_PAYMENT_CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "SGD",
  "BRL",
  "MXN",
]);

// Countries that support Guest Checkout (US only as of Jan 2026)
const GUEST_CHECKOUT_COUNTRIES = new Set(["US"]);

// Currencies that support presetFiatAmount according to Coinbase docs
const PRESET_FIAT_SUPPORTED = new Set(["USD", "CAD", "GBP", "EUR"]);

function normalizeCurrency(s?: string) {
  const v = (s || "").trim().toUpperCase();
  return v || undefined;
}

function normalizeAmount(s?: string) {
  const raw = (s || "").trim();
  if (!raw) return undefined;

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return undefined;

  return n.toFixed(2);
}

/* ───────── main ───────── */

export async function POST(req: NextRequest) {
  if (!API_KEY_ID || !API_KEY_SECRET) {
    return json(req, 500, { error: "Missing Coinbase API credentials" });
  }

  // CORS check
  const origin = req.headers.get("origin") || "";
  if (ORIGINS.length && origin && !ORIGINS.includes(origin)) {
    return json(req, 403, { error: "Forbidden origin" });
  }

  // Extract client IP - required by Coinbase
  const clientIp = getClientIp(req);
  if (!clientIp) {
    // In development, provide a helpful error message
    if (process.env.NODE_ENV === "development") {
      return json(req, 400, {
        error:
          "Coinbase Onramp requires a public IP address. Local development with localhost is not supported. Please test on a deployed environment or use ngrok/similar to get a public IP.",
      });
    }
    return json(req, 400, { error: "Could not determine client IP" });
  }

  // Authenticate user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let user: any;
  try {
    user = await requireServerUser();
  } catch {
    return json(req, 401, { error: "Unauthorized" });
  }

  const userDepositAddress = getUserDepositAddress(user);
  if (!userDepositAddress) {
    return json(req, 400, { error: "User has no linked deposit address" });
  }
  if (!isProbablySolanaAddress(userDepositAddress)) {
    return json(req, 400, { error: "User deposit address is invalid" });
  }

  // Parse request body
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json(req, 400, { error: "Invalid JSON body" });
  }

  // Validate destination matches user's address
  const requestedDestination = (body.destinationAddress || "").trim();
  if (requestedDestination && requestedDestination !== userDepositAddress) {
    return json(req, 403, { error: "Forbidden destination address" });
  }

  // Validate currency/network
  const purchaseCurrency = (body.purchaseCurrency || "USDC")
    .trim()
    .toUpperCase();
  const destinationNetwork = (body.destinationNetwork || "solana")
    .trim()
    .toLowerCase();

  if (purchaseCurrency !== "USDC") {
    return json(req, 400, { error: "Unsupported purchaseCurrency" });
  }
  if (destinationNetwork !== "solana") {
    return json(req, 400, { error: "Unsupported destinationNetwork" });
  }

  const paymentCurrency = normalizeCurrency(body.paymentCurrency) || "USD";
  if (!ALLOWED_PAYMENT_CURRENCIES.has(paymentCurrency)) {
    return json(req, 400, { error: "Unsupported paymentCurrency" });
  }

  const paymentAmount = normalizeAmount(body.paymentAmount);
  if (body.paymentAmount && !paymentAmount) {
    return json(req, 400, { error: "Invalid paymentAmount" });
  }

  // Validate redirect URL
  const redirectUrl = (body.redirectUrl || "").trim();
  const safeRedirectUrl =
    redirectUrl && isAllowedRedirectUrl(redirectUrl) ? redirectUrl : undefined;

  // Sandbox mode
  const sandboxAllowed =
    process.env.COINBASE_ONRAMP_ALLOW_SANDBOX === "true" &&
    process.env.NODE_ENV !== "production";
  const sandbox = sandboxAllowed ? Boolean(body.sandbox) : false;

  // Get user's country for determining flow type
  const userCountry = (body.country || user?.country || "")
    .toUpperCase()
    .trim();
  const isGuestCheckoutEligible = GUEST_CHECKOUT_COUNTRIES.has(userCountry);

  // Partner user reference
  const base =
    String(user?.privyId || "") ||
    String(user?._id || "") ||
    String(user?.id || "") ||
    "unknown";
  const partnerUserRef = `user-${stablePartnerRef(base)}`;

  // Build token request payload per Coinbase v1 API docs
  // See: https://docs.cdp.coinbase.com/onramp-&-offramp/session-token-authentication
  const tokenPayload = {
    addresses: [
      {
        address: userDepositAddress,
        blockchains: ["solana"],
      },
    ],
    assets: ["USDC"],
    clientIp: clientIp,
  };

  try {
    // Generate JWT for authentication
    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_KEY_SECRET,
      requestMethod: "POST",
      requestHost: "api.developer.coinbase.com",
      requestPath: "/onramp/v1/token",
      expiresIn: 120,
    });

    // Request session token from Coinbase
    const response = await fetch(ONRAMP_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tokenPayload),
      cache: "no-store",
    });

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = null;
    }

    if (!data || typeof data !== "object") {
      console.error("[Onramp] Invalid response:", text);
      return json(req, 502, { error: "Invalid response from Coinbase" });
    }

    if (!response.ok) {
      console.error("[Onramp] Coinbase error:", response.status, data);
      const errorMsg =
        (typeof data.errorMessage === "string" ? data.errorMessage : null) ||
        (typeof data.message === "string" ? data.message : null) ||
        (typeof data.error === "string" ? data.error : null) ||
        "Coinbase API error";
      return json(req, response.status >= 500 ? 502 : 400, {
        error: errorMsg,
      });
    }

    // Extract session token from response
    // Response format: { "token": "...", "channel_id": "" } or { "data": { "token": "..." } }
    const dataObj = data.data as Record<string, unknown> | undefined;
    const sessionToken =
      (typeof data.token === "string" ? data.token : null) ||
      (typeof dataObj?.token === "string" ? dataObj.token : null);

    if (!sessionToken) {
      console.error("[Onramp] No token in response:", data);
      return json(req, 502, { error: "No session token in Coinbase response" });
    }

    // Build the onramp URL with session token and parameters
    // For non-US users, use /buy/select-asset which handles Coinbase login flow better
    // For US users with guest checkout, we can use /buy for faster flow
    const baseUrl = isGuestCheckoutEligible
      ? "https://pay.coinbase.com/buy"
      : "https://pay.coinbase.com/buy/select-asset";

    const onrampUrl = new URL(baseUrl);
    onrampUrl.searchParams.set("sessionToken", sessionToken);

    // Set defaults for better UX
    onrampUrl.searchParams.set("defaultNetwork", "solana");
    onrampUrl.searchParams.set("defaultAsset", "USDC");

    // Add preset amount if provided (only for supported currencies)
    if (paymentAmount && PRESET_FIAT_SUPPORTED.has(paymentCurrency)) {
      onrampUrl.searchParams.set("presetFiatAmount", paymentAmount);
      onrampUrl.searchParams.set("fiatCurrency", paymentCurrency);
    } else if (paymentCurrency) {
      // Still set the fiat currency for non-preset-supported currencies
      onrampUrl.searchParams.set("fiatCurrency", paymentCurrency);
    }

    // For non-US users, set default payment method to CARD
    // This helps skip the payment method selection screen for users who need to log in anyway
    if (!isGuestCheckoutEligible) {
      onrampUrl.searchParams.set("defaultPaymentMethod", "CARD");
    }

    // Add partner user ref for transaction tracking
    onrampUrl.searchParams.set("partnerUserRef", partnerUserRef);

    // Add redirect URL if provided
    if (safeRedirectUrl) {
      onrampUrl.searchParams.set("redirectUrl", safeRedirectUrl);
    }

    const finalUrl = onrampUrl.toString();

    return json(req, 200, {
      onrampUrl: finalUrl,
      sandbox,
      destinationAddress: userDepositAddress,
      purchaseCurrency: "USDC",
      destinationNetwork: "solana",
      paymentCurrency,
      paymentAmount: paymentAmount || null,
      redirectUrl: safeRedirectUrl || null,
      // Include flow info for frontend handling
      flowType: isGuestCheckoutEligible ? "guest" : "coinbase_login",
      country: userCountry || null,
    });
  } catch (error) {
    console.error("[Onramp] Error:", error);
    return json(req, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
