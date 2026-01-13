// app/api/onramp/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CDP_BASE = "https://api.cdp.coinbase.com/platform";
const API_KEY_ID = process.env.COINBASE_API_KEY_ID!;
const API_KEY_SECRET = process.env.COINBASE_API_SECRET!;

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

function getStringField(obj: unknown, key: string) {
  if (!obj || typeof obj !== "object") return "";
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

function getErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return getStringField(e, "message");
}

function isProbablySolanaAddress(addr: string) {
  const a = (addr || "").trim();
  if (a.length < 32 || a.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(a);
}

function isMoneyString(s: string) {
  return /^[0-9]+(\.[0-9]{2})$/.test(s);
}

function extractSessionToken(onrampUrl: string): string | null {
  try {
    const u = new URL(onrampUrl);
    return u.searchParams.get("sessionToken");
  } catch {
    return null;
  }
}

function toSandboxUrl(onrampUrl: string): string {
  const u = new URL(onrampUrl);
  u.host = "pay-sandbox.coinbase.com";
  u.protocol = "https:";
  return u.toString();
}

/**
 * Check if an IP address is private/local (not allowed by Coinbase)
 */
function isPrivateIp(ip: string): boolean {
  if (!ip) return true;

  // Localhost
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;

  // Private IPv4 ranges
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    // 10.x.x.x
    if (parts[0] === 10) return true;
    // 172.16.x.x - 172.31.x.x
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.x.x
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.x.x (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  // IPv6 private ranges (simplified check)
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80"))
    return true;

  return false;
}

type Body = {
  destinationAddress: string;
  purchaseCurrency: string;
  destinationNetwork: string;
  paymentCurrency?: string;
  paymentAmount?: string;
  redirectUrl?: string;
  partnerUserRef?: string;
  sandbox?: boolean;
  paymentMethod?:
    | "CARD"
    | "ACH"
    | "APPLE_PAY"
    | "PAYPAL"
    | "FIAT_WALLET"
    | "CRYPTO_WALLET";
  country?: string;
  subdivision?: string;
};

export async function POST(req: NextRequest) {
  try {
    // Validate API credentials exist
    if (!API_KEY_ID || !API_KEY_SECRET) {
      return json(500, {
        error:
          "Missing Coinbase API credentials. Set COINBASE_API_KEY_ID and COINBASE_API_SECRET.",
      });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<Body>;

    const destinationAddress = (body.destinationAddress || "").trim();
    const purchaseCurrency = (body.purchaseCurrency || "").trim();
    const destinationNetwork = (body.destinationNetwork || "").trim();

    const paymentCurrency = (body.paymentCurrency || "USD").trim();
    const paymentAmount = body.paymentAmount
      ? String(body.paymentAmount).trim()
      : undefined;

    const redirectUrl = body.redirectUrl
      ? String(body.redirectUrl).trim()
      : undefined;

    const sandbox = !!body.sandbox;
    const rawRef = body.partnerUserRef
      ? String(body.partnerUserRef).trim()
      : "user-unknown";
    const partnerUserRef = sandbox
      ? rawRef.startsWith("sandbox-")
        ? rawRef
        : `sandbox-${rawRef}`
      : rawRef;

    // --- validation ---
    if (!destinationAddress)
      return json(400, { error: "Missing destinationAddress" });
    if (
      destinationNetwork.toLowerCase() === "solana" &&
      !isProbablySolanaAddress(destinationAddress)
    ) {
      return json(400, {
        error: "Destination address is not a valid Solana address.",
      });
    }
    if (!purchaseCurrency)
      return json(400, { error: "Missing purchaseCurrency" });
    if (!destinationNetwork)
      return json(400, { error: "Missing destinationNetwork" });

    if (paymentAmount !== undefined) {
      if (!isMoneyString(paymentAmount)) {
        return json(400, {
          error: 'Invalid paymentAmount. Must be a string like "100.00".',
        });
      }
      const n = Number(paymentAmount);
      if (!Number.isFinite(n) || n <= 0) {
        return json(400, { error: "Invalid paymentAmount. Must be > 0." });
      }
    }

    // Build Coinbase payload
    const payload: {
      destinationAddress: string;
      purchaseCurrency: string;
      destinationNetwork: string;
      partnerUserRef: string;
      paymentCurrency?: string;
      paymentAmount?: string;
      redirectUrl?: string;
      paymentMethod?: Body["paymentMethod"];
      country?: string;
      subdivision?: string;
      clientIp?: string;
    } = {
      destinationAddress,
      purchaseCurrency,
      destinationNetwork,
      partnerUserRef,
    };

    if (paymentAmount !== undefined) {
      payload.paymentCurrency = paymentCurrency || "USD";
      payload.paymentAmount = paymentAmount;
    }

    if (redirectUrl) payload.redirectUrl = redirectUrl;

    if (body.paymentMethod) payload.paymentMethod = body.paymentMethod;
    if (body.country) payload.country = body.country;
    if (body.subdivision) payload.subdivision = body.subdivision;

    // Get client IP for the request (Coinbase recommends this for production)
    // Only include if it's a valid public IP - private IPs are rejected
    const forwardedFor = req.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    const realIp = req.headers.get("x-real-ip");
    const clientIp = forwardedFor || realIp;

    // Only add clientIp if it exists and is not a private/local IP
    if (clientIp && !isPrivateIp(clientIp)) {
      payload.clientIp = clientIp;
    }

    // Generate JWT for authentication using the official CDP SDK
    const requestPath = "/platform/v2/onramp/sessions";
    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_KEY_SECRET,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: requestPath,
      expiresIn: 120,
    });

    const r = await fetch(`${CDP_BASE}/v2/onramp/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;

    if (!r.ok) {
      console.error("[Onramp] Coinbase API error:", j);
      const errorMessage =
        getStringField(j, "errorMessage") ||
        getStringField(j, "message") ||
        "Coinbase session failed";
      return json(r.status === 401 ? 401 : 400, {
        error: errorMessage,
        coinbase: j,
        sent: process.env.NODE_ENV === "development" ? payload : undefined,
      });
    }

    const session =
      j.session && typeof j.session === "object"
        ? (j.session as Record<string, unknown>)
        : null;
    const onrampUrl =
      session && typeof session.onrampUrl === "string"
        ? session.onrampUrl
        : undefined;
    if (!onrampUrl) {
      return json(400, {
        error: "Missing session.onrampUrl in Coinbase response",
        coinbase: j,
      });
    }

    const finalUrl = sandbox ? toSandboxUrl(onrampUrl) : onrampUrl;
    const sessionToken = extractSessionToken(onrampUrl);

    return json(200, {
      onrampUrl: finalUrl,
      sessionToken,
      sandbox,
      quote: j.quote,
      sent: process.env.NODE_ENV === "development" ? payload : undefined,
    });
  } catch (e: unknown) {
    console.error("[Onramp] Server error:", e);
    return json(500, { error: getErrorMessage(e) || "Server error" });
  }
}
