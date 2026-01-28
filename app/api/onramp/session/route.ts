// app/api/onramp/session/route.ts
// FIXED: Uses V1 Buy Quote API for proper one-click-buy URLs
// The V1 Buy Quote API returns a ready-to-use URL with all parameters pre-filled
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// V1 Buy Quote API - returns ready-to-use one-click-buy URL
const BUY_QUOTE_URL = "https://api.developer.coinbase.com/onramp/v1/buy/quote";

// V1 Session Token API - for generating session tokens
const SESSION_TOKEN_URL = "https://api.developer.coinbase.com/onramp/v1/token";

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

const VALID_PAYMENT_METHODS = new Set([
  "CARD",
  "ACH_BANK_ACCOUNT",
  "APPLE_PAY",
  "FIAT_WALLET",
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

// Generate JWT for V1 API (different host)
async function generateCoinbaseJwtV1(method: string, path: string) {
  return generateJwt({
    apiKeyId: API_KEY_ID,
    apiKeySecret: API_KEY_SECRET,
    requestMethod: method,
    requestHost: "api.developer.coinbase.com",
    requestPath: path,
    expiresIn: 120,
  });
}

/**
 * Build a one-click-buy URL manually from a session token
 * This is the fallback if we don't have an amount
 */
function buildManualUrl(
  sessionToken: string,
  options: {
    paymentAmount?: string;
    paymentCurrency: string;
    purchaseCurrency: string;
    destinationNetwork: string;
  },
): string {
  const url = new URL("https://pay.coinbase.com/buy");

  url.searchParams.set("sessionToken", sessionToken);
  url.searchParams.set("defaultAsset", options.purchaseCurrency);
  url.searchParams.set("defaultNetwork", options.destinationNetwork);

  if (options.paymentAmount) {
    url.searchParams.set("presetFiatAmount", options.paymentAmount);
    url.searchParams.set("fiatCurrency", options.paymentCurrency);
  }

  return url.toString();
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

  // CRITICAL: Use the payment currency from the request (CAD for Canada, etc.)
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
  if (!paymentMethod || !VALID_PAYMENT_METHODS.has(paymentMethod)) {
    paymentMethod = "CARD";
  }

  console.log("[Onramp] Request params:", {
    country: userCountry,
    currency: paymentCurrency,
    amount: paymentAmount || "(none)",
    method: paymentMethod,
    destination: userDepositAddress.slice(0, 8) + "...",
    clientIp: clientIp.slice(0, 8) + "...",
  });

  try {
    // If user specified an amount, use the V1 Buy Quote API for a proper one-click-buy URL
    if (paymentAmount) {
      console.log("[Onramp] Using V1 Buy Quote API for one-click-buy URL");

      const quoteBody: Record<string, string> = {
        country: userCountry || "US",
        paymentAmount: paymentAmount,
        paymentCurrency: paymentCurrency, // CAD, USD, etc.
        paymentMethod: paymentMethod,
        purchaseCurrency: purchaseCurrency, // USDC
        purchaseNetwork: destinationNetwork, // solana
        destinationAddress: userDepositAddress,
        clientIp: clientIp,
      };

      if (userCountry === "US" && userSubdivision) {
        quoteBody.subdivision = userSubdivision;
      }

      const jwt = await generateCoinbaseJwtV1("POST", "/onramp/v1/buy/quote");

      console.log("[Onramp] Calling Buy Quote API with:", {
        country: quoteBody.country,
        paymentCurrency: quoteBody.paymentCurrency,
        paymentAmount: quoteBody.paymentAmount,
      });

      const response = await fetch(BUY_QUOTE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(quoteBody),
        cache: "no-store",
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        console.error("[Onramp] Failed to parse Buy Quote response:", text);
        return json(req, 502, { error: "Invalid response from Coinbase" });
      }

      if (!response.ok) {
        console.error("[Onramp] Buy Quote API error:", response.status, data);

        const errorMessage = (data?.message ||
          data?.error ||
          "Coinbase API error") as string;

        // If quote fails for international users, fall back to session token approach
        if (response.status === 400 || response.status === 422) {
          console.log(
            "[Onramp] Quote failed, falling back to session token approach",
          );
          // Continue to session token approach below
        } else {
          return json(req, response.status >= 500 ? 502 : 400, {
            error: errorMessage,
          });
        }
      } else {
        // Success! The Buy Quote API returns a ready-to-use one-click URL
        const onrampUrl = data.onramp_url as string;

        if (onrampUrl) {
          console.log(
            "[Onramp] Got one-click URL from Buy Quote API:",
            onrampUrl,
          );

          return json(req, 200, {
            onrampUrl,
            quote: {
              paymentTotal: data.payment_total,
              paymentSubtotal: data.payment_subtotal,
              purchaseAmount: data.purchase_amount,
              coinbaseFee: data.coinbase_fee,
              networkFee: data.network_fee,
              quoteId: data.quote_id,
            },
            destinationAddress: userDepositAddress,
            purchaseCurrency: "USDC",
            destinationNetwork: "solana",
            paymentCurrency,
            paymentAmount,
            paymentMethod,
            redirectUrl: safeRedirectUrl || null,
            flowType: isGuestCheckoutEligible ? "guest" : "coinbase_login",
            country: userCountry || null,
            method: "quote",
          });
        }
      }
    }

    // Fallback: Use V1 Session Token API and build URL manually
    // This is for when no amount is specified or quote failed
    console.log("[Onramp] Using V1 Session Token API");

    const sessionBody = {
      addresses: [
        {
          address: userDepositAddress,
          blockchains: ["solana"],
        },
      ],
      assets: ["USDC"],
      clientIp: clientIp,
    };

    const jwt = await generateCoinbaseJwtV1("POST", "/onramp/v1/token");

    const response = await fetch(SESSION_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionBody),
      cache: "no-store",
    });

    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      console.error("[Onramp] Failed to parse Session Token response:", text);
      return json(req, 502, { error: "Invalid response from Coinbase" });
    }

    if (!response.ok) {
      console.error("[Onramp] Session Token API error:", response.status, data);
      const errorMessage = (data?.message ||
        data?.error ||
        "Coinbase API error") as string;
      return json(req, response.status >= 500 ? 502 : 400, {
        error: errorMessage,
      });
    }

    const sessionToken = data.token as string;
    if (!sessionToken) {
      console.error("[Onramp] No session token in response:", data);
      return json(req, 502, { error: "No session token from Coinbase" });
    }

    // Build the URL manually with the correct parameters
    const onrampUrl = buildManualUrl(sessionToken, {
      paymentAmount,
      paymentCurrency,
      purchaseCurrency,
      destinationNetwork,
    });

    console.log("[Onramp] Built manual URL:", onrampUrl);

    return json(req, 200, {
      onrampUrl,
      quote: null,
      destinationAddress: userDepositAddress,
      purchaseCurrency: "USDC",
      destinationNetwork: "solana",
      paymentCurrency,
      paymentAmount: paymentAmount || null,
      paymentMethod,
      redirectUrl: safeRedirectUrl || null,
      flowType: isGuestCheckoutEligible ? "guest" : "coinbase_login",
      country: userCountry || null,
      method: "session",
    });
  } catch (error) {
    console.error("[Onramp] Error:", error);
    return json(req, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
