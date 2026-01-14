// app/api/onramp/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Create Onramp Session API - returns URL with params baked in
const ONRAMP_SESSION_URL =
  "https://api.cdp.coinbase.com/platform/v2/onramp/sessions";

const API_KEY_ID = process.env.COINBASE_API_KEY_ID!;
const API_KEY_SECRET = process.env.COINBASE_API_SECRET!;

function json(status: number, body: unknown) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

function toSandboxUrl(onrampUrl: string): string {
  try {
    const u = new URL(onrampUrl);
    u.host = "pay-sandbox.coinbase.com";
    u.protocol = "https:";
    return u.toString();
  } catch {
    return onrampUrl;
  }
}

/**
 * Check if an IP address is private/local (not allowed by Coinbase)
 */
function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;

  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80"))
    return true;

  return false;
}

type Body = {
  destinationAddress: string;

  // what the user is buying (keep default USDC)
  purchaseCurrency?: string;

  // where it goes (keep default solana)
  destinationNetwork?: string;

  // user's selected display currency (USD/CAD/etc)
  paymentCurrency?: string;

  redirectUrl?: string;
  partnerUserRef?: string;

  sandbox?: boolean;

  // CA/US/etc (Coinbase eligibility routing)
  country?: string;
  subdivision?: string; // required only for US in some cases
};

export async function POST(req: NextRequest) {
  try {
    if (!API_KEY_ID || !API_KEY_SECRET) {
      return json(500, {
        error:
          "Missing Coinbase API credentials. Set COINBASE_API_KEY_ID and COINBASE_API_SECRET.",
      });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<Body>;

    const destinationAddress = (body.destinationAddress || "").trim();
    const purchaseCurrency = (body.purchaseCurrency || "USDC").trim();
    const destinationNetwork = (body.destinationNetwork || "solana").trim();

    // ✅ user payment/display currency (no amount)
    const paymentCurrency = (body.paymentCurrency || "USD").trim();

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

    // Default to CA unless you pass otherwise
    const country = (body.country || "CA").toUpperCase();

    // --- validation ---
    if (!destinationAddress) {
      return json(400, { error: "Missing destinationAddress" });
    }
    if (
      destinationNetwork.toLowerCase() === "solana" &&
      !isProbablySolanaAddress(destinationAddress)
    ) {
      return json(400, {
        error: "Destination address is not a valid Solana address.",
      });
    }
    if (!purchaseCurrency) {
      return json(400, { error: "Missing purchaseCurrency" });
    }
    if (!paymentCurrency) {
      return json(400, { error: "Missing paymentCurrency" });
    }

    // Get client IP for the request (Coinbase may use it for risk/eligibility)
    const forwardedFor = req.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    const realIp = req.headers.get("x-real-ip");
    const clientIp = forwardedFor || realIp;
    const safeClientIp =
      clientIp && !isPrivateIp(clientIp) ? clientIp : undefined;

    /**
     * ✅ No paymentAmount
     * ✅ No paymentMethod
     *
     * Let Coinbase handle:
     * - amount entry
     * - payment method selection (card/bank/etc)
     */
    const sessionPayload: Record<string, unknown> = {
      purchaseCurrency,
      destinationNetwork,
      destinationAddress,

      // user-selected display currency (USD/CAD/etc)
      paymentCurrency,

      country,
      partnerUserRef,
    };

    if (redirectUrl) sessionPayload.redirectUrl = redirectUrl;
    if (safeClientIp) sessionPayload.clientIp = safeClientIp;

    // Subdivision only required for US (if you have it)
    if (country === "US" && body.subdivision) {
      sessionPayload.subdivision = body.subdivision;
    }

    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_KEY_SECRET,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/onramp/sessions",
      expiresIn: 120,
    });

    console.log("[Onramp] Create session payload:", sessionPayload);

    const res = await fetch(ONRAMP_SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionPayload),
      cache: "no-store",
    });

    const responseText = await res.text();
    let responseJson: Record<string, unknown>;

    try {
      responseJson = JSON.parse(responseText);
    } catch {
      console.error("[Onramp] Failed to parse response:", responseText);
      return json(500, {
        error: "Invalid response from Coinbase API",
        raw: responseText.slice(0, 500),
      });
    }

    if (!res.ok) {
      console.error("[Onramp] Coinbase error:", responseJson);
      const errorMessage =
        getStringField(responseJson, "message") ||
        getStringField(responseJson, "error") ||
        "Failed to create onramp session";
      return json(res.status === 401 ? 401 : 400, {
        error: errorMessage,
        coinbase: responseJson,
        sent:
          process.env.NODE_ENV === "development" ? sessionPayload : undefined,
      });
    }

    // Response format: { session: { onrampUrl: "..." }, ... }
    const session = responseJson.session as Record<string, unknown> | undefined;
    const onrampUrl = getStringField(session || {}, "onrampUrl");

    if (!onrampUrl) {
      console.error("[Onramp] No onrampUrl in response:", responseJson);
      return json(400, {
        error: "Missing onramp URL in Coinbase response",
        coinbase: responseJson,
      });
    }

    const finalUrl = sandbox ? toSandboxUrl(onrampUrl) : onrampUrl;

    return json(200, {
      url: finalUrl, // ✅ return a simple url field for the frontend
      sandbox,
      sent: process.env.NODE_ENV === "development" ? sessionPayload : undefined,
    });
  } catch (e: unknown) {
    console.error("[Onramp] Server error:", e);
    return json(500, { error: getErrorMessage(e) || "Server error" });
  }
}
