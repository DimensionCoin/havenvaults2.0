// app/api/onramp/session/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// V2 API endpoint - this is the newer API that properly handles one-click buy URLs
const ONRAMP_SESSION_URL_V2 =
  "https://api.cdp.coinbase.com/platform/v2/onramp/sessions";

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
  const realIp = req.headers.get("x-real-ip");
  if (realIp && isValidPublicIp(realIp)) {
    return realIp;
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp && isValidPublicIp(firstIp)) {
      return firstIp;
    }
  }

  // @ts-expect-error - ip may exist on NextRequest in some environments
  if (req.ip && isValidPublicIp(req.ip)) {
    // @ts-expect-error - ip may exist on NextRequest in some environments
    return req.ip;
  }

  return null;
}

function isValidIp(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  if (parts.every((p) => p === 0)) return true;
  return false;
}

function isValidPublicIp(ip: string): boolean {
  if (!isValidIp(ip)) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return !isPrivateIp(ip);
  }
  return true;
}

type RequestBody = {
  destinationAddress?: string;
  purchaseCurrency?: string;
  destinationNetwork?: string;
  paymentCurrency?: string;
  paymentAmount?: string;
  paymentMethod?: string;
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

// Countries that support Guest Checkout (US only)
const GUEST_CHECKOUT_COUNTRIES = new Set(["US"]);

// Valid payment methods for the V2 API
const VALID_PAYMENT_METHODS_V2 = new Set([
  "CARD",
  "ACH",
  "APPLE_PAY",
  "PAYPAL",
  "FIAT_WALLET",
  "CRYPTO_WALLET",
]);

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

/**
 * Generate JWT for Coinbase V2 API
 */
async function generateCoinbaseJwtV2(method: string, path: string) {
  return generateJwt({
    apiKeyId: API_KEY_ID,
    apiKeySecret: API_KEY_SECRET,
    requestMethod: method,
    requestHost: "api.cdp.coinbase.com",
    requestPath: path,
    expiresIn: 120,
  });
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

  // Get user's country - ensure we use ISO 3166-1 two-letter codes
  const rawCountry = (body.country || user?.country || "").toUpperCase().trim();

  // Map common country names to ISO codes
  const COUNTRY_NAME_TO_CODE: Record<string, string> = {
    CANADA: "CA",
    "UNITED STATES": "US",
    USA: "US",
    "UNITED KINGDOM": "GB",
    UK: "GB",
    AUSTRALIA: "AU",
    GERMANY: "DE",
    FRANCE: "FR",
    SPAIN: "ES",
    ITALY: "IT",
    NETHERLANDS: "NL",
    SWITZERLAND: "CH",
    SINGAPORE: "SG",
    JAPAN: "JP",
    BRAZIL: "BR",
    MEXICO: "MX",
  };

  // If it's already a 2-letter code, use it; otherwise try to map it
  const userCountry =
    rawCountry.length === 2
      ? rawCountry
      : COUNTRY_NAME_TO_CODE[rawCountry] || rawCountry.slice(0, 2);

  const userSubdivision = (body.subdivision || user?.subdivision || "")
    .toUpperCase()
    .trim();

  const isGuestCheckoutEligible = GUEST_CHECKOUT_COUNTRIES.has(userCountry);

  // Determine payment method for V2 API
  let paymentMethod = (body.paymentMethod || "").toUpperCase();
  if (!paymentMethod || !VALID_PAYMENT_METHODS_V2.has(paymentMethod)) {
    paymentMethod = "CARD"; // Default to CARD for V2 API
  }

  // Partner user reference
  const base =
    String(user?.privyId || "") ||
    String(user?._id || "") ||
    String(user?.id || "") ||
    "unknown";
  const partnerUserRef = `user-${stablePartnerRef(base)}`;

  try {
    // Build request body for V2 API
    // Required fields: purchaseCurrency, destinationNetwork, destinationAddress
    // Optional for one-click: paymentAmount, paymentCurrency
    // Optional for quote: paymentMethod, country, subdivision
    const requestBody: Record<string, string> = {
      purchaseCurrency: purchaseCurrency,
      destinationNetwork: destinationNetwork,
      destinationAddress: userDepositAddress,
      clientIp: clientIp,
      partnerUserRef: partnerUserRef,
    };

    // Add payment amount and currency for one-click URL with pre-filled amount
    if (paymentAmount) {
      requestBody.paymentAmount = paymentAmount;
      requestBody.paymentCurrency = paymentCurrency;
    }

    // Add payment method and country for full quote
    if (paymentMethod && userCountry) {
      requestBody.paymentMethod = paymentMethod;
      requestBody.country = userCountry;

      // Subdivision required for US
      if (userCountry === "US" && userSubdivision) {
        requestBody.subdivision = userSubdivision;
      }
    }

    // Add redirect URL if provided
    if (safeRedirectUrl) {
      requestBody.redirectUrl = safeRedirectUrl;
    }

    console.log("[Onramp V2] Creating session with:", {
      ...requestBody,
      destinationAddress: requestBody.destinationAddress?.slice(0, 8) + "...",
      clientIp: "[redacted]",
    });

    // Generate JWT for V2 API
    const jwt = await generateCoinbaseJwtV2(
      "POST",
      "/platform/v2/onramp/sessions",
    );

    const response = await fetch(ONRAMP_SESSION_URL_V2, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      console.error("[Onramp V2] Failed to parse response:", text);
      return json(req, 502, { error: "Invalid response from Coinbase" });
    }

    if (!response.ok) {
      console.error("[Onramp V2] Error:", response.status, data);

      // Extract error message from V2 API response
      const errorType = data?.errorType as string | undefined;
      const errorMessage = data?.errorMessage as string | undefined;
      const errorMsg = errorMessage || errorType || "Coinbase API error";

      return json(req, response.status >= 500 ? 502 : 400, {
        error: errorMsg,
        errorType,
      });
    }

    // Extract session and quote from V2 API response
    const session = data.session as { onrampUrl?: string } | undefined;
    const quote = data.quote as Record<string, unknown> | undefined;

    const onrampUrl = session?.onrampUrl;

    if (!onrampUrl) {
      console.error("[Onramp V2] No onrampUrl in response:", data);
      return json(req, 502, { error: "No onramp URL in Coinbase response" });
    }

    console.log("[Onramp V2] Session created successfully", {
      hasQuote: !!quote,
      hasAmount: !!paymentAmount,
    });

    return json(req, 200, {
      onrampUrl,
      quote: quote || null,
      destinationAddress: userDepositAddress,
      purchaseCurrency: "USDC",
      destinationNetwork: "solana",
      paymentCurrency,
      paymentAmount: paymentAmount || null,
      paymentMethod,
      redirectUrl: safeRedirectUrl || null,
      flowType: isGuestCheckoutEligible ? "guest" : "coinbase_login",
      country: userCountry || null,
    });
  } catch (error) {
    console.error("[Onramp V2] Error:", error);
    return json(req, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
