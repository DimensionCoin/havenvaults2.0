// app/api/onramp/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  partnerUserRef?: string;
  sandbox?: boolean;
  country?: string;
  subdivision?: string;
}

export async function POST(req: NextRequest) {
  const timings: Record<string, number> = {};
  const start = Date.now();

  if (!API_KEY_ID || !API_KEY_SECRET) {
    return json(500, { error: "Missing Coinbase API credentials" });
  }

  let body: Partial<RequestBody>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  timings.parse = Date.now() - start;

  const destinationAddress = (body.destinationAddress || "").trim();
  const purchaseCurrency = (body.purchaseCurrency || "USDC").trim();
  const destinationNetwork = (body.destinationNetwork || "solana").trim();
  const paymentCurrency = (body.paymentCurrency || "USD").trim();
  const paymentAmount = body.paymentAmount?.trim();
  const redirectUrl = body.redirectUrl?.trim();
  const sandbox = Boolean(body.sandbox);

  const baseRef = (body.partnerUserRef || "haven-user").trim();
  const partnerUserRef = sandbox
    ? baseRef.startsWith("sandbox-")
      ? baseRef
      : `sandbox-${baseRef}`
    : baseRef;

  const country = (body.country || "").toUpperCase() || undefined;
  const subdivision = body.subdivision?.toUpperCase();

  // Validation
  if (!destinationAddress) {
    return json(400, { error: "Missing destinationAddress" });
  }

  if (
    destinationNetwork.toLowerCase() === "solana" &&
    !isProbablySolanaAddress(destinationAddress)
  ) {
    return json(400, { error: "Invalid Solana address format" });
  }

  // Build payload
  const sessionPayload: Record<string, string> = {
    destinationAddress,
    purchaseCurrency,
    destinationNetwork,
  };

  if (paymentCurrency) sessionPayload.paymentCurrency = paymentCurrency;
  if (paymentAmount && parseFloat(paymentAmount) > 0) {
    sessionPayload.paymentAmount = paymentAmount;
  }
  if (redirectUrl) sessionPayload.redirectUrl = redirectUrl;
  if (partnerUserRef) sessionPayload.partnerUserRef = partnerUserRef;
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

    console.log("[Onramp] Creating session with payload:", sessionPayload);

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

    // Log raw response for debugging
    console.log("[Onramp] Raw response status:", response.status);
    console.log("[Onramp] Raw response body:", responseText);

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        "[Onramp] Failed to parse JSON:",
        responseText.slice(0, 500)
      );
      return json(502, { error: "Invalid response from Coinbase" });
    }

    // Log parsed response
    console.log("[Onramp] Parsed response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error("[Onramp] Coinbase API error:", {
        status: response.status,
        data,
      });
      return json(response.status >= 500 ? 502 : 400, {
        error:
          (data.errorMessage as string) ||
          (data.message as string) ||
          "Coinbase API error",
        coinbaseError: data,
      });
    }

    // Try multiple possible response structures
    let onrampUrl: string | undefined;

    // Structure 1: { session: { onrampUrl: "..." } }
    const session = data.session as Record<string, unknown> | undefined;
    if (session?.onrampUrl) {
      onrampUrl = session.onrampUrl as string;
    }

    // Structure 2: { onrampUrl: "..." }
    if (!onrampUrl && data.onrampUrl) {
      onrampUrl = data.onrampUrl as string;
    }

    // Structure 3: { url: "..." }
    if (!onrampUrl && data.url) {
      onrampUrl = data.url as string;
    }

    // Structure 4: { data: { session: { onrampUrl: "..." } } }
    if (!onrampUrl && data.data) {
      const nested = data.data as Record<string, unknown>;
      const nestedSession = nested.session as
        | Record<string, unknown>
        | undefined;
      if (nestedSession?.onrampUrl) {
        onrampUrl = nestedSession.onrampUrl as string;
      }
    }

    console.log("[Onramp] Extracted onrampUrl:", onrampUrl);

    if (!onrampUrl) {
      console.error(
        "[Onramp] Could not find onrampUrl in response. Full response:",
        data
      );
      return json(502, {
        error: "No onramp URL in Coinbase response",
        debug: process.env.NODE_ENV === "development" ? data : undefined,
      });
    }

    const finalUrl = sandbox ? toSandboxUrl(onrampUrl) : onrampUrl;
    timings.total = Date.now() - start;

    console.log("[Onramp] Success! Timings (ms):", timings);
    console.log("[Onramp] Final URL:", finalUrl);

    return json(200, {
      onrampUrl: finalUrl,
      sandbox,
      timings: process.env.NODE_ENV === "development" ? timings : undefined,
    });
  } catch (error) {
    console.error("[Onramp] Request failed:", error);
    return json(500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
