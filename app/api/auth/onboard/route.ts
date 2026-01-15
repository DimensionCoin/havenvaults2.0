// app/api/auth/onboard/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
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

export async function POST(req: NextRequest) {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privyId = session.sub;

    const body = (await req.json().catch(() => ({}))) as Body;

    const firstName =
      typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName =
      typeof body.lastName === "string" ? body.lastName.trim() : "";

    const country =
      typeof body.country === "string" && body.country.trim()
        ? body.country.trim().toUpperCase()
        : undefined;

    const displayCurrency = parseDisplayCurrency(body.displayCurrency);

    const financialKnowledgeLevel = isFinancialKnowledgeLevel(
      body.financialKnowledgeLevel
    )
      ? body.financialKnowledgeLevel
      : undefined;

    const riskLevel = isRiskLevel(body.riskLevel) ? body.riskLevel : undefined;

    // ───────── Basic validation ─────────
    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: "First name and last name are required." },
        { status: 400 }
      );
    }

    // If the client sent a value but it wasn't valid, reject clearly
    if (body.displayCurrency !== undefined && !displayCurrency) {
      return NextResponse.json(
        { error: "Invalid display currency." },
        { status: 400 }
      );
    }

    if (
      body.financialKnowledgeLevel !== undefined &&
      !financialKnowledgeLevel
    ) {
      return NextResponse.json(
        { error: "Invalid financial knowledge level." },
        { status: 400 }
      );
    }

    if (body.riskLevel !== undefined && !riskLevel) {
      return NextResponse.json(
        { error: "Invalid risk level." },
        { status: 400 }
      );
    }

    // ───────── Load user ─────────
    const user = await User.findOne({ privyId });
    if (!user) {
      return NextResponse.json(
        { error: "User not found for this session." },
        { status: 404 }
      );
    }

    // ───────── Apply updates ─────────
    user.firstName = firstName;
    user.lastName = lastName;

    if (country) user.country = country;
    if (displayCurrency) user.displayCurrency = displayCurrency;
    if (financialKnowledgeLevel)
      user.financialKnowledgeLevel = financialKnowledgeLevel;
    if (riskLevel) user.riskLevel = riskLevel;

    user.isOnboarded = true;

    await user.save();

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
      { status: 200 }
    );
  } catch (err) {
    console.error("/api/auth/onboard error:", err);
    return NextResponse.json(
      { error: "Failed to complete onboarding" },
      { status: 500 }
    );
  }
}
