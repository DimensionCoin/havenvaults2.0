// app/api/onramp/session/route.ts
// FIXED: Properly handles one-click-buy URL parameters for international users
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// V2 API endpoint
const ONRAMP_SESSION_URL_V2 =
  "https://api.cdp.coinbase.com/platform/v2/onramp/sessions";

const API_KEY_ID = process.env.COINBASE_API_KEY_ID!;
const API_KEY_SECRET = process.env.COINBASE_API_SECRET!;

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

const GUEST_CHECKOUT_COUNTRIES = new Set(["US"]);

const VALID_PAYMENT_METHODS_V2 = new Set([
  "CARD",
  "ACH",
  "APPLE_PAY",
  "PAYPAL",
  "FIAT_WALLET",
  "CRYPTO_WALLET",
]);

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
  IRELAND: "IE",
  AUSTRIA: "AT",
  BELGIUM: "BE",
  DENMARK: "DK",
  FINLAND: "FI",
  NORWAY: "NO",
  SWEDEN: "SE",
  PORTUGAL: "PT",
  POLAND: "PL",
  "NEW ZEALAND": "NZ",
  "HONG KONG": "HK",
  TAIWAN: "TW",
  "SOUTH KOREA": "KR",
  KOREA: "KR",
};

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

function normalizeCountry(raw: string): string {
  const upper = raw.toUpperCase().trim();
  if (upper.length === 2) {
    return upper;
  }
  return COUNTRY_NAME_TO_CODE[upper] || upper.slice(0, 2);
}

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

/**
 * Build a proper one-click-buy URL by ensuring all required parameters are present
 * According to Coinbase docs, one-click-buy requires:
 * - sessionToken (from the API response)
 * - presetFiatAmount OR presetCryptoAmount
 * - fiatCurrency (required when using presetFiatAmount)
 * - defaultAsset
 */
function buildOneClickBuyUrl(
  baseUrl: string,
  options: {
    paymentAmount?: string;
    paymentCurrency: string;
    purchaseCurrency: string;
    destinationNetwork: string;
  },
): string {
  try {
    const url = new URL(baseUrl);

    // CRITICAL FIX: The URL path must be /buy for one-click-buy to work
    // The V2 API sometimes returns /buy/input or /buy/select-asset which don't support presets
    if (url.pathname !== "/buy") {
      url.pathname = "/buy";
      console.log("[Onramp] Changed URL path to /buy for one-click experience");
    }

    // Add the required one-click-buy parameters if we have an amount
    if (options.paymentAmount) {
      // presetFiatAmount - the amount the user wants to spend
      url.searchParams.set("presetFiatAmount", options.paymentAmount);

      // fiatCurrency - REQUIRED when using presetFiatAmount
      // This MUST match what the user's payment method uses
      url.searchParams.set("fiatCurrency", options.paymentCurrency);

      console.log(
        `[Onramp] Set presetFiatAmount=${options.paymentAmount}, fiatCurrency=${options.paymentCurrency}`,
      );
    }

    // defaultAsset - the crypto asset to purchase
    if (!url.searchParams.has("defaultAsset")) {
      url.searchParams.set("defaultAsset", options.purchaseCurrency);
    }

    // defaultNetwork - pre-select the network
    if (!url.searchParams.has("defaultNetwork")) {
      url.searchParams.set("defaultNetwork", options.destinationNetwork);
    }

    return url.toString();
  } catch (e) {
    console.error("[Onramp] Failed to build one-click URL:", e);
    return baseUrl;
  }
}

/* ───────── main ───────── */

export async function POST(req: NextRequest) {
  if (!API_KEY_ID || !API_KEY_SECRET) {
    return json(req, 500, { error: "Missing Coinbase API credentials" });
  }

  const origin = req.headers.get("origin") || "";
  if (ORIGINS.length && origin && !ORIGINS.includes(origin)) {
    return json(req, 403, { error: "Forbidden origin" });
  }

  const clientIp = getClientIp(req);
  if (!clientIp) {
    if (process.env.NODE_ENV === "development") {
      return json(req, 400, {
        error:
          "Coinbase Onramp requires a public IP address. Local development with localhost is not supported.",
      });
    }
    return json(req, 400, { error: "Could not determine client IP" });
  }

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

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json(req, 400, { error: "Invalid JSON body" });
  }

  const requestedDestination = (body.destinationAddress || "").trim();
  if (requestedDestination && requestedDestination !== userDepositAddress) {
    return json(req, 403, { error: "Forbidden destination address" });
  }

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

  // CRITICAL: Use the payment currency from the request
  // This should be CAD for Canadian users, USD for US users, etc.
  const paymentCurrency = normalizeCurrency(body.paymentCurrency) || "USD";
  if (!ALLOWED_PAYMENT_CURRENCIES.has(paymentCurrency)) {
    return json(req, 400, { error: "Unsupported paymentCurrency" });
  }

  const paymentAmount = normalizeAmount(body.paymentAmount);
  if (body.paymentAmount && !paymentAmount) {
    return json(req, 400, { error: "Invalid paymentAmount" });
  }

  const redirectUrl = (body.redirectUrl || "").trim();
  const safeRedirectUrl =
    redirectUrl && isAllowedRedirectUrl(redirectUrl) ? redirectUrl : undefined;

  const rawCountry = (body.country || user?.country || "").toUpperCase().trim();
  const userCountry = normalizeCountry(rawCountry);

  const userSubdivision = (body.subdivision || user?.subdivision || "")
    .toUpperCase()
    .trim();

  const isGuestCheckoutEligible = GUEST_CHECKOUT_COUNTRIES.has(userCountry);

  let paymentMethod = (body.paymentMethod || "").toUpperCase();
  if (!paymentMethod || !VALID_PAYMENT_METHODS_V2.has(paymentMethod)) {
    paymentMethod = "CARD";
  }

  const base =
    String(user?.privyId || "") ||
    String(user?._id || "") ||
    String(user?.id || "") ||
    "unknown";
  const partnerUserRef = `user-${stablePartnerRef(base)}`;

  try {
    // Build request body for V2 API
    // NOTE: The V2 API takes paymentCurrency in the body, but we ALSO need to
    // add fiatCurrency as a URL parameter for one-click-buy to work properly
    const requestBody: Record<string, string> = {
      purchaseCurrency: purchaseCurrency,
      destinationNetwork: destinationNetwork,
      destinationAddress: userDepositAddress,
      clientIp: clientIp,
      partnerUserRef: partnerUserRef,
      // Always include paymentCurrency so Coinbase knows what currency to expect
      paymentCurrency: paymentCurrency,
    };

    // Include amount if provided
    if (paymentAmount) {
      requestBody.paymentAmount = paymentAmount;
    }

    // Include country for better payment method suggestions
    if (userCountry && userCountry.length === 2) {
      requestBody.country = userCountry;
      requestBody.paymentMethod = paymentMethod;

      if (
        userCountry === "US" &&
        userSubdivision &&
        userSubdivision.length === 2
      ) {
        requestBody.subdivision = userSubdivision;
      }
    }

    if (safeRedirectUrl) {
      requestBody.redirectUrl = safeRedirectUrl;
    }

    console.log("[Onramp V2] Creating session:", {
      country: userCountry,
      currency: paymentCurrency,
      amount: paymentAmount || "(none)",
      method: paymentMethod,
      destination: userDepositAddress.slice(0, 8) + "...",
    });

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

      const errorType = data?.errorType as string | undefined;
      const errorMessage = data?.errorMessage as string | undefined;
      const errorMsg = errorMessage || errorType || "Coinbase API error";

      if (errorType === "guest_region_forbidden") {
        return json(req, 400, {
          error:
            "Guest checkout is not available in your region. You will need to sign in with a Coinbase account.",
          errorType,
          flowType: "coinbase_login",
        });
      }

      return json(req, response.status >= 500 ? 502 : 400, {
        error: errorMsg,
        errorType,
      });
    }

    const session = data.session as { onrampUrl?: string } | undefined;
    const quote = data.quote as Record<string, unknown> | undefined;

    let onrampUrl = session?.onrampUrl;

    if (!onrampUrl) {
      console.error("[Onramp V2] No onrampUrl in response:", data);
      return json(req, 502, { error: "No onramp URL in Coinbase response" });
    }

    // Log the original URL for debugging
    console.log("[Onramp V2] Original URL from API:", onrampUrl);

    // CRITICAL FIX: Build proper one-click-buy URL with all required parameters
    // The V2 API doesn't always include these, so we need to add them
    onrampUrl = buildOneClickBuyUrl(onrampUrl, {
      paymentAmount: paymentAmount,
      paymentCurrency: paymentCurrency, // THIS IS THE KEY FIX - use CAD for Canadian users
      purchaseCurrency: purchaseCurrency,
      destinationNetwork: destinationNetwork,
    });

    console.log("[Onramp V2] Final one-click URL:", onrampUrl);

    console.log("[Onramp V2] Session created successfully", {
      hasQuote: !!quote,
      hasAmount: !!paymentAmount,
      country: userCountry,
      currency: paymentCurrency,
      flowType: isGuestCheckoutEligible ? "guest" : "coinbase_login",
    });

    let feeInfo = null;
    if (quote) {
      feeInfo = {
        paymentTotal: quote.paymentTotal
          ? { value: String(quote.paymentTotal), currency: paymentCurrency }
          : undefined,
        purchaseAmount: quote.purchaseAmount
          ? { value: String(quote.purchaseAmount), currency: "USDC" }
          : undefined,
      };
    }

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
      fees: feeInfo,
      method: paymentAmount ? "quote" : "session",
    });
  } catch (error) {
    console.error("[Onramp V2] Error:", error);
    return json(req, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
