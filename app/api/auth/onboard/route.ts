// app/api/auth/onboard/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { rateLimitServer } from "@/lib/rateLimitServer";
import User, {
  type FinancialKnowledgeLevel,
  type RiskLevel,
  parseDisplayCurrency,
} from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Validators (type-guards) ───────── */

const VALID_RISK_LEVELS = ["low", "medium", "high"] as const;
const VALID_KNOWLEDGE_LEVELS = [
  "none",
  "beginner",
  "intermediate",
  "advanced",
] as const;

function isRiskLevel(x: unknown): x is RiskLevel {
  return (
    typeof x === "string" &&
    (VALID_RISK_LEVELS as readonly string[]).includes(x)
  );
}

function isFinancialKnowledgeLevel(x: unknown): x is FinancialKnowledgeLevel {
  return (
    typeof x === "string" &&
    (VALID_KNOWLEDGE_LEVELS as readonly string[]).includes(x)
  );
}

/* ───────── Route ───────── */

type Body = {
  firstName?: unknown;
  lastName?: unknown;
  country?: unknown;
  displayCurrency?: unknown;
  financialKnowledgeLevel?: unknown;
  riskLevel?: unknown;
};

// Small helpers to keep the handler clean
function cleanName(v: unknown, maxLen = 50): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function cleanCountry(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toUpperCase();
  // Accept ISO-3166-1 alpha-2 style: "CA", "US", ...
  if (!/^[A-Z]{2}$/.test(s)) return undefined;
  return s;
}

export async function POST(req: NextRequest) {
  try {
    // ✅ Rate limit BEFORE any expensive work
    const blocked = await rateLimitServer(req, {
      api: "auth:onboard",
      perSecond: 2,
      requireAuth: true,
    });
    if (blocked) return blocked;

    // ✅ Auth check early
    const session = await getSessionFromCookies();
    if (!session?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const privyId = session.sub;

    // ✅ Parse body safely
    const body = (await req.json().catch(() => ({}))) as Body;

    const firstName = cleanName(body.firstName, 50);
    const lastName = cleanName(body.lastName, 50);

    const country =
      body.country === undefined ? undefined : cleanCountry(body.country);

    const displayCurrency = parseDisplayCurrency(body.displayCurrency);

    const financialKnowledgeLevel =
      body.financialKnowledgeLevel === undefined
        ? undefined
        : isFinancialKnowledgeLevel(body.financialKnowledgeLevel)
          ? body.financialKnowledgeLevel
          : null;

    const riskLevel =
      body.riskLevel === undefined
        ? undefined
        : isRiskLevel(body.riskLevel)
          ? body.riskLevel
          : null;

    // ───────── Required validation ─────────
    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: "First name and last name are required." },
        { status: 400 },
      );
    }

    // ───────── Optional validation ─────────
    // If optional fields were PROVIDED but invalid, reject clearly.
    if (body.country !== undefined && !country) {
      return NextResponse.json(
        { error: "Invalid country code." },
        { status: 400 },
      );
    }

    if (body.displayCurrency !== undefined && !displayCurrency) {
      return NextResponse.json(
        { error: "Invalid display currency." },
        { status: 400 },
      );
    }

    if (financialKnowledgeLevel === null) {
      return NextResponse.json(
        { error: "Invalid financial knowledge level." },
        { status: 400 },
      );
    }

    if (riskLevel === null) {
      return NextResponse.json(
        { error: "Invalid risk level." },
        { status: 400 },
      );
    }

    await connect();

    // ✅ Build atomic update (prevents races + double onboarding)
    const set: Record<string, unknown> = {
      firstName,
      lastName,
      isOnboarded: true,
    };

    if (country) set.country = country;
    if (displayCurrency) set.displayCurrency = displayCurrency;
    if (financialKnowledgeLevel)
      set.financialKnowledgeLevel = financialKnowledgeLevel;
    if (riskLevel) set.riskLevel = riskLevel;

    // Only onboard users who are NOT already onboarded
    const user = await User.findOneAndUpdate(
      { privyId, isOnboarded: { $ne: true } },
      { $set: set },
      { new: true },
    );

    // If null, either user doesn't exist OR already onboarded
    if (!user) {
      const existing = await User.findOne({ privyId })
        .select("_id isOnboarded")
        .lean();
      if (!existing) {
        return NextResponse.json(
          { error: "User not found for this session." },
          { status: 404 },
        );
      }
      // ✅ Idempotent: already onboarded
      return NextResponse.json(
        { error: "User already onboarded." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        user: {
          id: user._id.toString(),
          privyId: user.privyId,
          email: user.email,
          walletAddress: user.walletAddress,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          country: user.country ?? null,
          displayCurrency: user.displayCurrency,
          financialKnowledgeLevel: user.financialKnowledgeLevel,
          riskLevel: user.riskLevel,
          isOnboarded: user.isOnboarded,
          isPro: user.isPro,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("/api/auth/onboard error:", err);
    return NextResponse.json(
      { error: "Failed to complete onboarding" },
      { status: 500 },
    );
  }
}
