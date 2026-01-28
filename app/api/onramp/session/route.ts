// app/api/onramp/session/route.ts
// Properly handles US vs non-US users for Coinbase Onramp
// - US users: Full one-click-buy with pre-filled amounts
// - Non-US users: Simple session (amount entered in Coinbase)
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { requireServerUser } from "@/lib/getServerUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V2_CREATE_SESSION_URL =
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

function getClientIp(req: NextRequest): string | null {
  const realIp = req.headers.get("x-real-ip");
  if (realIp && isValidPublicIp(realIp)) return realIp;

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp && isValidPublicIp(firstIp)) return firstIp;
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

function isPrivateIpv4(ip: string): boolean {
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
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return !isPrivateIpv4(ip);
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
  country?: string;
  subdivision?: string;
};

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  CANADA: "CA",
  "UNITED STATES": "US",
  USA: "US",
  "UNITED KINGDOM": "GB",
  UK: "GB",
  AUSTRALIA: "AU",
  GERMANY: "DE",
  FRANCE: "FR",
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

const VALID_PAYMENT_METHODS = new Set([
  "CARD",
  "ACH_BANK_ACCOUNT",
  "APPLE_PAY",
  "FIAT_WALLET",
]);

function normalizeCountry(raw: string): string {
  const upper = (raw || "").toUpperCase().trim();
  if (!upper) return "";
  if (upper.length === 2) return upper;
  return COUNTRY_NAME_TO_CODE[upper] || upper.slice(0, 2);
}

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

  // Get country
  const userCountry = normalizeCountry(
    (body.country || user?.country || "").toString(),
  );

  const userSubdivision = (body.subdivision || user?.subdivision || "")
    .toString()
    .toUpperCase()
    .trim();

  // Determine if this is a US user (can get full one-click-buy)
  const isUSUser = userCountry === "US";

  // Payment currency - for US default to USD, for CA default to CAD, etc.
  const paymentCurrency =
    normalizeCurrency(body.paymentCurrency) ||
    (userCountry === "CA" ? "CAD" : userCountry === "GB" ? "GBP" : "USD");

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

  const requestedPaymentMethod = (body.paymentMethod || "")
    .toUpperCase()
    .trim();
  const validPaymentMethod = VALID_PAYMENT_METHODS.has(requestedPaymentMethod)
    ? requestedPaymentMethod
    : "CARD";

  console.log("[Onramp] Request:", {
    country: userCountry,
    isUSUser,
    currency: paymentCurrency,
    amount: paymentAmount || "(none)",
    destination: userDepositAddress.slice(0, 8) + "...",
  });

  try {
    // Build request body for V2 API
    const sessionReq: Record<string, string> = {
      purchaseCurrency,
      destinationNetwork,
      destinationAddress: userDepositAddress,
      clientIp,
    };

    // Always include country if we have it
    if (userCountry) {
      sessionReq.country = userCountry;
    }

    // ─────────────────────────────────────────────────────────────────────
    // US USERS: Full one-click-buy support
    // Can include paymentAmount, paymentCurrency, paymentMethod, subdivision
    // ─────────────────────────────────────────────────────────────────────
    if (isUSUser) {
      // US requires subdivision for quotes
      if (userSubdivision) {
        sessionReq.subdivision = userSubdivision;
      }

      // Include payment details for one-click-buy
      if (paymentAmount) {
        sessionReq.paymentAmount = paymentAmount;
        sessionReq.paymentCurrency = paymentCurrency;
        sessionReq.paymentMethod = validPaymentMethod;
      }
    }
    // ─────────────────────────────────────────────────────────────────────
    // NON-US USERS (Canada, UK, EU, etc.): Simple session only
    // Do NOT include paymentAmount, paymentCurrency, or paymentMethod
    // This avoids the "currency mismatch" error
    // User will enter amount in Coinbase UI
    // ─────────────────────────────────────────────────────────────────────
    // (No additional fields needed for non-US)

    if (safeRedirectUrl) {
      sessionReq.redirectUrl = safeRedirectUrl;
    }

    // Partner user ref for tracking
    if (user?.id || user?._id) {
      sessionReq.partnerUserRef = String(user.id || user._id);
    }

    console.log("[Onramp] Session request body:", sessionReq);

    const jwt = await generateCoinbaseJwtV2(
      "POST",
      "/platform/v2/onramp/sessions",
    );

    const resp = await fetch(V2_CREATE_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionReq),
      cache: "no-store",
    });

    const text = await resp.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("[Onramp] Failed to parse response:", text);
      return json(req, 502, { error: "Invalid response from Coinbase" });
    }

    if (!resp.ok) {
      console.error("[Onramp] Coinbase error:", resp.status, data);
      const message = data?.message || data?.error || "Coinbase API error";
      return json(req, resp.status >= 500 ? 502 : 400, { error: message });
    }

    const onrampUrl: string | undefined = data?.session?.onrampUrl;
    if (!onrampUrl) {
      console.error("[Onramp] No onrampUrl in response:", data);
      return json(req, 502, { error: "No onrampUrl returned by Coinbase" });
    }

    console.log("[Onramp] Success! URL:", onrampUrl);

    // Quote is only included for US users with full payment details
    const quote = data?.quote ?? null;

    return json(req, 200, {
      onrampUrl,
      quote,
      destinationAddress: userDepositAddress,
      purchaseCurrency: "USDC",
      destinationNetwork: "solana",

      // For US: echo what was requested
      // For non-US: null (they enter in Coinbase)
      paymentCurrency: isUSUser && paymentAmount ? paymentCurrency : null,
      paymentAmount: isUSUser ? paymentAmount : null,
      paymentMethod: isUSUser && paymentAmount ? validPaymentMethod : null,

      country: userCountry || null,
      subdivision: isUSUser ? userSubdivision || null : null,

      // Flow type helps frontend show appropriate UI
      flowType: isUSUser ? "guest_checkout" : "coinbase_login",

      // Let frontend know if amount was pre-filled
      amountPrefilled: isUSUser && !!paymentAmount,

      method: "v2_session",
    });
  } catch (e) {
    console.error("[Onramp] Error:", e);
    return json(req, 500, {
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}
