// app/api/onramp/session/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// API endpoints
const ONRAMP_TOKEN_URL = "https://api.developer.coinbase.com/onramp/v1/token";
const BUY_QUOTE_URL = "https://api.developer.coinbase.com/onramp/v1/buy/quote";

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

// Countries that support Guest Checkout (US only as of Jan 2026)
const GUEST_CHECKOUT_COUNTRIES = new Set(["US"]);

// Valid payment methods for the Buy Quote API
const VALID_PAYMENT_METHODS = new Set([
  "UNSPECIFIED",
  "CARD",
  "ACH_BANK_ACCOUNT",
  "APPLE_PAY",
  "FIAT_WALLET",
  "CRYPTO_ACCOUNT",
  "GUEST_CHECKOUT_CARD",
  "PAYPAL",
  "RTP",
  "GUEST_CHECKOUT_APPLE_PAY",
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
 * Generate JWT for Coinbase API
 */
async function generateCoinbaseJwt(method: string, path: string) {
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
 * Use the Buy Quote API to get a one-click-buy URL with amount pre-filled.
 * This is the preferred method when the user has specified an amount.
 */
async function getBuyQuoteUrl(params: {
  destinationAddress: string;
  purchaseCurrency: string;
  purchaseNetwork: string;
  paymentAmount: string;
  paymentCurrency: string;
  paymentMethod: string;
  country: string;
  subdivision?: string;
  clientIp: string;
}): Promise<{ onrampUrl: string; quoteId: string; fees: unknown } | null> {
  try {
    const jwt = await generateCoinbaseJwt("POST", "/onramp/v1/buy/quote");

    const requestBody: Record<string, string> = {
      purchaseCurrency: params.purchaseCurrency,
      purchaseNetwork: params.purchaseNetwork,
      paymentAmount: params.paymentAmount,
      paymentCurrency: params.paymentCurrency,
      paymentMethod: params.paymentMethod,
      country: params.country,
      destinationAddress: params.destinationAddress,
      clientIp: params.clientIp,
    };

    // Add subdivision for US users (required)
    if (params.subdivision) {
      requestBody.subdivision = params.subdivision;
    }

    console.log("[Onramp] Requesting buy quote:", {
      ...requestBody,
      destinationAddress: requestBody.destinationAddress?.slice(0, 8) + "...",
      clientIp: "[redacted]",
    });

    const response = await fetch(BUY_QUOTE_URL, {
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
      console.error("[Onramp] Failed to parse quote response:", text);
      return null;
    }

    if (!response.ok) {
      console.error("[Onramp] Buy quote error:", response.status, data);
      return null;
    }

    const onrampUrl = data.onramp_url as string | undefined;
    const quoteId = data.quote_id as string | undefined;

    if (!onrampUrl) {
      console.error("[Onramp] No onramp_url in quote response:", data);
      return null;
    }

    return {
      onrampUrl,
      quoteId: quoteId || "",
      fees: {
        coinbaseFee: data.coinbase_fee,
        networkFee: data.network_fee,
        paymentTotal: data.payment_total,
        purchaseAmount: data.purchase_amount,
      },
    };
  } catch (error) {
    console.error("[Onramp] Buy quote request failed:", error);
    return null;
  }
}

/**
 * Fallback to session token API when no amount is specified.
 * This allows users to enter the amount in Coinbase checkout.
 */
async function getSessionTokenUrl(params: {
  destinationAddress: string;
  clientIp: string;
  paymentCurrency: string;
  isGuestCheckoutEligible: boolean;
  partnerUserRef: string;
  redirectUrl?: string;
}): Promise<string | null> {
  try {
    const jwt = await generateCoinbaseJwt("POST", "/onramp/v1/token");

    const tokenPayload = {
      addresses: [
        {
          address: params.destinationAddress,
          blockchains: ["solana"],
        },
      ],
      assets: ["USDC"],
      clientIp: params.clientIp,
    };

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
      console.error("[Onramp] Failed to parse token response:", text);
      return null;
    }

    if (!response.ok || !data) {
      console.error("[Onramp] Session token error:", response.status, data);
      return null;
    }

    const dataObj = data.data as Record<string, unknown> | undefined;
    const sessionToken =
      (typeof data.token === "string" ? data.token : null) ||
      (typeof dataObj?.token === "string" ? dataObj.token : null);

    if (!sessionToken) {
      console.error("[Onramp] No token in response:", data);
      return null;
    }

    // Build URL manually for session token flow
    const baseUrl = params.isGuestCheckoutEligible
      ? "https://pay.coinbase.com/buy"
      : "https://pay.coinbase.com/buy/select-asset";

    const onrampUrl = new URL(baseUrl);
    onrampUrl.searchParams.set("sessionToken", sessionToken);
    onrampUrl.searchParams.set("defaultNetwork", "solana");
    onrampUrl.searchParams.set("defaultAsset", "USDC");
    onrampUrl.searchParams.set("fiatCurrency", params.paymentCurrency);
    onrampUrl.searchParams.set("partnerUserRef", params.partnerUserRef);

    if (!params.isGuestCheckoutEligible) {
      onrampUrl.searchParams.set("defaultPaymentMethod", "CARD");
    }

    if (params.redirectUrl) {
      onrampUrl.searchParams.set("redirectUrl", params.redirectUrl);
    }

    return onrampUrl.toString();
  } catch (error) {
    console.error("[Onramp] Session token request failed:", error);
    return null;
  }
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

  // Get user's country
  const userCountry = (body.country || user?.country || "")
    .toUpperCase()
    .trim();
  const userSubdivision = (body.subdivision || user?.subdivision || "")
    .toUpperCase()
    .trim();

  const isGuestCheckoutEligible = GUEST_CHECKOUT_COUNTRIES.has(userCountry);

  // Determine payment method
  let paymentMethod = (body.paymentMethod || "").toUpperCase();
  if (!paymentMethod || !VALID_PAYMENT_METHODS.has(paymentMethod)) {
    // Default based on country and checkout type
    if (isGuestCheckoutEligible) {
      paymentMethod = "GUEST_CHECKOUT_CARD";
    } else {
      paymentMethod = "CARD";
    }
  }

  // Partner user reference
  const base =
    String(user?.privyId || "") ||
    String(user?._id || "") ||
    String(user?.id || "") ||
    "unknown";
  const partnerUserRef = `user-${stablePartnerRef(base)}`;

  try {
    let onrampUrl: string | null = null;
    let quoteId: string | null = null;
    let fees: unknown = null;
    let method: "quote" | "session" = "session";

    // If user specified an amount, use the Buy Quote API for pre-filled URL
    if (paymentAmount && userCountry) {
      const quoteResult = await getBuyQuoteUrl({
        destinationAddress: userDepositAddress,
        purchaseCurrency: "USDC",
        purchaseNetwork: "solana",
        paymentAmount,
        paymentCurrency,
        paymentMethod,
        country: userCountry,
        subdivision:
          userCountry === "US" ? userSubdivision || undefined : undefined,
        clientIp,
      });

      if (quoteResult) {
        onrampUrl = quoteResult.onrampUrl;
        quoteId = quoteResult.quoteId;
        fees = quoteResult.fees;
        method = "quote";
        console.log("[Onramp] Using Buy Quote URL with pre-filled amount");
      } else {
        console.log("[Onramp] Buy Quote failed, falling back to session token");
      }
    }

    // Fallback to session token if quote failed or no amount specified
    if (!onrampUrl) {
      onrampUrl = await getSessionTokenUrl({
        destinationAddress: userDepositAddress,
        clientIp,
        paymentCurrency,
        isGuestCheckoutEligible,
        partnerUserRef,
        redirectUrl: safeRedirectUrl,
      });
      method = "session";
    }

    if (!onrampUrl) {
      return json(req, 502, {
        error: "Failed to create Coinbase checkout URL",
      });
    }

    return json(req, 200, {
      onrampUrl,
      quoteId,
      fees,
      method,
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
    console.error("[Onramp] Error:", error);
    return json(req, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
