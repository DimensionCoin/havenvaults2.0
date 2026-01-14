// app/api/onramp/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { getSessionFromCookies } from "@/lib/auth"; // <- use your existing auth
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONRAMP_SESSION_URL =
  "https://api.cdp.coinbase.com/platform/v2/onramp/sessions";

const API_KEY_ID = process.env.COINBASE_API_KEY_ID!;
const API_KEY_SECRET = process.env.COINBASE_API_SECRET!;

const ONRAMP_ENABLED =
  (process.env.ONRAMP_ENABLED || "false").toLowerCase() === "true";
const ADMIN_EMAILS = (process.env.ONRAMP_ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

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
  purchaseCurrency?: string;
  destinationNetwork?: string;
  paymentCurrency?: string;
  redirectUrl?: string;
  partnerUserRef?: string;
  sandbox?: boolean;
  country?: string;
  subdivision?: string;
};

export async function POST(req: NextRequest) {
  try {
    // ✅ Auth + admin gating
    const session = await getSessionFromCookies();
    if (!session?.userId) return json(401, { error: "Unauthorized" });

    await connect();
    const me = await User.findById(session.userId).lean();
    const email = String(me?.email || "")
      .trim()
      .toLowerCase();

    const isAdmin = email && ADMIN_EMAILS.includes(email);

    // ✅ KILL SWITCH: only admins can use onramp while disabled
    if (!ONRAMP_ENABLED && !isAdmin) {
      return json(403, {
        error:
          "Onramp is temporarily disabled while we complete provider approval.",
        code: "ONRAMP_DISABLED",
      });
    }

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
    const paymentCurrency = (body.paymentCurrency || "USD").trim();

    const redirectUrl = body.redirectUrl
      ? String(body.redirectUrl).trim()
      : undefined;

    const sandbox = !!body.sandbox;
    const rawRef = body.partnerUserRef
      ? String(body.partnerUserRef).trim()
      : `user-${session.userId}`;
    const partnerUserRef = sandbox
      ? rawRef.startsWith("sandbox-")
        ? rawRef
        : `sandbox-${rawRef}`
      : rawRef;

    const country = (body.country || "CA").toUpperCase();

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

    const forwardedFor = req.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    const realIp = req.headers.get("x-real-ip");
    const clientIp = forwardedFor || realIp;
    const safeClientIp =
      clientIp && !isPrivateIp(clientIp) ? clientIp : undefined;

    // ✅ No amount + no paymentMethod (Coinbase chooses)
    const sessionPayload: Record<string, unknown> = {
      purchaseCurrency,
      destinationNetwork,
      destinationAddress,
      paymentCurrency,
      country,
      partnerUserRef,
    };

    if (redirectUrl) sessionPayload.redirectUrl = redirectUrl;
    if (safeClientIp) sessionPayload.clientIp = safeClientIp;
    if (country === "US" && body.subdivision)
      sessionPayload.subdivision = body.subdivision;

    const jwt = await generateJwt({
      apiKeyId: API_KEY_ID,
      apiKeySecret: API_KEY_SECRET,
      requestMethod: "POST",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/onramp/sessions",
      expiresIn: 120,
    });

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
      return json(500, { error: "Invalid response from Coinbase API" });
    }

    if (!res.ok) {
      const errorMessage =
        getStringField(responseJson, "message") ||
        getStringField(responseJson, "error") ||
        "Failed to create onramp session";
      return json(res.status === 401 ? 401 : 400, {
        error: errorMessage,
        coinbase: responseJson,
      });
    }

    const sessionObj = responseJson.session as
      | Record<string, unknown>
      | undefined;
    const onrampUrl = getStringField(sessionObj || {}, "onrampUrl");
    if (!onrampUrl)
      return json(400, { error: "Missing onramp URL in Coinbase response" });

    const finalUrl = sandbox ? toSandboxUrl(onrampUrl) : onrampUrl;

    return json(200, { url: finalUrl, sandbox });
  } catch (e: unknown) {
    return json(500, { error: getErrorMessage(e) || "Server error" });
  }
}
