// app/api/auth/onboard/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User, {
  DISPLAY_CURRENCIES,
  FinancialKnowledgeLevel,
  RiskLevel,
} from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_RISK_LEVELS: RiskLevel[] = ["low", "medium", "high"];
const VALID_KNOWLEDGE_LEVELS: FinancialKnowledgeLevel[] = [
  "none",
  "beginner",
  "intermediate",
  "advanced",
];

export async function POST(req: NextRequest) {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session || !session.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privyId = session.sub;

    const body: {
      firstName?: string;
      lastName?: string;
      country?: string;
      displayCurrency?: string;
      financialKnowledgeLevel?: FinancialKnowledgeLevel;
      riskLevel?: RiskLevel;
    } = await req.json().catch(() => ({}));
    const {
      firstName,
      lastName,
      country,
      displayCurrency,
      financialKnowledgeLevel,
      riskLevel,
    } = body;

    // Basic validation
    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: "First name and last name are required." },
        { status: 400 }
      );
    }

    if (
      displayCurrency &&
      !DISPLAY_CURRENCIES.includes(
        displayCurrency as typeof DISPLAY_CURRENCIES[number]
      )
    ) {
      return NextResponse.json(
        { error: "Invalid display currency." },
        { status: 400 }
      );
    }

    if (
      financialKnowledgeLevel &&
      !VALID_KNOWLEDGE_LEVELS.includes(
        financialKnowledgeLevel as FinancialKnowledgeLevel
      )
    ) {
      return NextResponse.json(
        { error: "Invalid financial knowledge level." },
        { status: 400 }
      );
    }

    if (riskLevel && !VALID_RISK_LEVELS.includes(riskLevel as RiskLevel)) {
      return NextResponse.json(
        { error: "Invalid risk level." },
        { status: 400 }
      );
    }

    // Look up the user by privyId
    const user = await User.findOne({ privyId });
    if (!user) {
      return NextResponse.json(
        { error: "User not found for this session." },
        { status: 404 }
      );
    }

    // Apply updates
    user.firstName = String(firstName).trim();
    user.lastName = String(lastName).trim();

    if (country) {
      user.country = String(country).toUpperCase();
    }

    if (displayCurrency) {
      user.displayCurrency = displayCurrency;
    }

    if (financialKnowledgeLevel) {
      user.financialKnowledgeLevel = financialKnowledgeLevel;
    }

    if (riskLevel) {
      user.riskLevel = riskLevel;
    }

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
