import { NextResponse, NextRequest } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { jwtVerify } from "jose";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_ID = process.env.PRIVY_APP_ID;
const SECRET = process.env.PRIVY_SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_COOKIE = "haven_session";

// 👇 Privy is optional now
const privy = APP_ID && SECRET ? new PrivyClient(APP_ID, SECRET) : null;

const enc = new TextEncoder();

// ---------- helpers ----------
function readBearer(req: Request): string | null {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const t = authz.slice(7).trim();
    if (t) return t;
  }
  return null;
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const target = name.toLowerCase() + "=";
  const part = cookie
    .split(";")
    .map((s) => s.trim())
    .find((c) => c.toLowerCase().startsWith(target));
  return part ? decodeURIComponent(part.substring(target.length)) : null;
}

async function getUserDocFromRequest(req: Request) {
  // If we don't have the secrets configured, just skip auth
  if (!JWT_SECRET && !privy) {
    console.log(
      "[FX] getUserDocFromRequest: no JWT_SECRET/privy, skipping auth"
    );
    return null;
  }

  // 1) Prefer Privy bearer: verify and find by privyId
  const bearer = readBearer(req);
  if (bearer && privy) {
    try {
      console.log("[FX] getUserDocFromRequest: trying Privy bearer");
      const claims = await privy.verifyAuthToken(bearer);
      const privyId = claims.userId;
      await connect();
      const byPrivy = await User.findOne({ privyId }).lean();
      if (byPrivy) {
        console.log("[FX] getUserDocFromRequest: found user by privyId", {
          privyId,
          userId: byPrivy._id?.toString?.(),
          displayCurrency: byPrivy.displayCurrency,
        });
        return byPrivy;
      }
    } catch (e) {
      console.warn("[FX] getUserDocFromRequest: Privy path failed:", e);
      // fall through to cookie
    }
  }

  // 2) Fallback to app session cookie (haven_session) -> verify JWT -> find by _id
  if (!JWT_SECRET) {
    console.log(
      "[FX] getUserDocFromRequest: no JWT_SECRET, skipping cookie path"
    );
    return null;
  }

  const sessionJwt = readCookie(req, SESSION_COOKIE);
  if (!sessionJwt) {
    console.log("[FX] getUserDocFromRequest: no session cookie");
    return null;
  }

  try {
    const { payload } = await jwtVerify(sessionJwt, enc.encode(JWT_SECRET));
    const uid =
      (typeof payload.uid === "string" && payload.uid) ||
      (typeof payload.userId === "string" && payload.userId) ||
      null;
    if (!uid) {
      console.warn(
        "[FX] getUserDocFromRequest: JWT payload missing uid/userId"
      );
      return null;
    }
    await connect();
    const byId = await User.findById(uid).lean();
    if (!byId) {
      console.warn("[FX] getUserDocFromRequest: no user found for JWT uid", {
        uid,
      });
      return null;
    }
    console.log("[FX] getUserDocFromRequest: found user by _id", {
      uid,
      displayCurrency: byId.displayCurrency,
    });
    return byId;
  } catch (e) {
    console.warn("[FX] getUserDocFromRequest: JWT verify failed:", e);
    return null;
  }
}

const norm3 = (s?: string) => (s || "").trim().toUpperCase();
const normalizeTargetCurrency = (c: string) =>
  norm3(c) === "USDC" ? "USD" : norm3(c);

// ---------- external providers (free, no key) ----------
type FxResult = { rate: number; asOf?: string; source: string };

async function fetchRateUSDTo_Frankfurter(target: string): Promise<FxResult> {
  console.log("[FX] Frankfurter: fetching USD ->", target);
  const r = await fetch(
    `https://api.frankfurter.app/latest?from=USD&to=${encodeURIComponent(
      target
    )}`,
    { next: { revalidate: 300 } }
  );
  if (!r.ok) throw new Error(`Frankfurter error ${r.status}`);
  const j = (await r.json()) as {
    rates?: Record<string, number>;
    date?: string;
  };
  const rate = Number(j?.rates?.[target]);
  console.log("[FX] Frankfurter: raw JSON", {
    date: j.date,
    rate,
    target,
  });
  if (!isFinite(rate) || rate <= 0) throw new Error("Frankfurter missing rate");
  return { rate, asOf: j.date, source: "frankfurter" };
}

async function fetchRateUSDTo_ERAPI(target: string): Promise<FxResult> {
  console.log("[FX] ER-API: fetching USD ->", target);
  const r = await fetch("https://open.er-api.com/v6/latest/USD", {
    next: { revalidate: 300 },
  });
  if (!r.ok) throw new Error(`ER-API error ${r.status}`);
  const j = (await r.json()) as {
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  };
  const rate = Number(j?.rates?.[target]);
  console.log("[FX] ER-API: raw JSON snippet", {
    time_last_update_utc: j.time_last_update_utc,
    rate,
    target,
  });
  if (!isFinite(rate) || rate <= 0) throw new Error("ER-API missing rate");
  return { rate, asOf: j.time_last_update_utc, source: "open.er-api.com" };
}

async function fetchRateUSDTo_ExchangerateHost(
  target: string
): Promise<FxResult> {
  console.log("[FX] exchangerate.host: fetching USD ->", target);
  const r = await fetch(
    `https://api.exchangerate.host/latest?base=USD&symbols=${encodeURIComponent(
      target
    )}`,
    { next: { revalidate: 300 } }
  );
  if (!r.ok) throw new Error(`exchangerate.host error ${r.status}`);
  const j = (await r.json()) as {
    rates?: Record<string, number>;
    date?: string;
  };
  const rate = Number(j?.rates?.[target]);
  console.log("[FX] exchangerate.host: raw JSON", {
    date: j.date,
    rate,
    target,
  });
  if (!isFinite(rate) || rate <= 0)
    throw new Error("exchangerate.host missing rate");
  return { rate, asOf: j.date, source: "exchangerate.host" };
}

async function fetchRateUSDTo(target: string): Promise<FxResult> {
  console.log("[FX] fetchRateUSDTo: start", { target });

  const attempts: { name: string; fn: (t: string) => Promise<FxResult> }[] = [
    { name: "frankfurter", fn: fetchRateUSDTo_Frankfurter },
    { name: "er-api", fn: fetchRateUSDTo_ERAPI },
    { name: "exchangerate.host", fn: fetchRateUSDTo_ExchangerateHost },
  ];

  let lastErr: unknown = null;
  for (const { name, fn } of attempts) {
    try {
      const res = await fn(target);
      console.log("[FX] fetchRateUSDTo: provider success", {
        provider: name,
        target,
        rate: res.rate,
        asOf: res.asOf,
      });
      return res;
    } catch (e) {
      lastErr = e;
      console.warn("[FX] fetchRateUSDTo: provider failed", {
        provider: name,
        target,
        error: String(e),
      });
    }
  }
  console.error("[FX] fetchRateUSDTo: all providers failed", {
    target,
    lastErr: String(lastErr),
  });
  throw lastErr ?? new Error("No FX provider available");
}

// ---------- GET: allow query override + user displayCurrency ----------
export async function GET(req: NextRequest) {
  try {
    console.log("[FX] GET /api/fx called:", { url: req.url });

    const url = new URL(req.url);

    // ✅ Allow explicit override: /api/fx?currency=CAD or /api/fx?to=EUR
    const toParam =
      url.searchParams.get("currency") || url.searchParams.get("to");

    const amountStr = url.searchParams.get("amount");
    const amount =
      amountStr === null ? null : Number(url.searchParams.get("amount"));

    if (amount !== null && (!isFinite(amount) || amount < 0)) {
      console.warn("[FX] GET: invalid amount", { amountStr });
      return new NextResponse("Invalid amount", { status: 400 });
    }

    const userDoc = await getUserDocFromRequest(req).catch((e) => {
      console.warn("[FX] GET: getUserDocFromRequest threw:", e);
      return null;
    });

    const userDisplayCurrency =
      userDoc && typeof userDoc.displayCurrency === "string"
        ? userDoc.displayCurrency
        : "USD";

    const target = normalizeTargetCurrency(
      toParam || userDisplayCurrency || "USD"
    );

    console.log("[FX] GET: resolved currency info", {
      toParam,
      userDisplayCurrency,
      normalizedTarget: target,
      amount,
      userId: userDoc?._id?.toString?.(),
    });

    // USDC is pegged to USD
    if (target === "USD") {
      const payload = {
        base: "USD",
        target: "USD",
        rate: 1,
        amount,
        converted: amount ?? null,
        asOf: null,
        source: "peg",
        timestamp: Date.now(),
      };
      console.log("[FX] GET: returning peg (USD)", payload);
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "no-store",
          Vary: "Authorization, Cookie",
        },
      });
    }

    // Get USD→target rate with robust fallbacks
    const { rate, asOf, source } = await fetchRateUSDTo(target);

    const converted = amount === null ? null : amount * rate;

    const payload = {
      base: "USD",
      target,
      rate,
      amount,
      converted,
      asOf: asOf ?? null,
      source,
      timestamp: Date.now(),
    };

    console.log("[FX] GET: returning FX payload", payload);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        Vary: "Authorization, Cookie",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[FX] GET: error", msg);
    return new NextResponse(`FX failed: ${msg}`, { status: 400 });
  }
}
