// app/api/user/update/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User, {
  DISPLAY_CURRENCIES,
  type RiskLevel,
  type FinancialKnowledgeLevel,
} from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Partial<{
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  displayCurrency: string | null;
  riskLevel: RiskLevel | null;
  financialKnowledgeLevel: FinancialKnowledgeLevel | null;
}>;

const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high"];
const KNOWLEDGE_LEVELS: FinancialKnowledgeLevel[] = [
  "none",
  "beginner",
  "intermediate",
  "advanced",
];

export async function PATCH(req: NextRequest) {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session || !session.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privyId = session.sub;

    const user = await User.findOne({ privyId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      firstName,
      lastName,
      country,
      displayCurrency,
      riskLevel,
      financialKnowledgeLevel,
    } = body || {};

    // ---- Simple string fields ----
    if (firstName !== undefined) {
      const v = firstName === null ? null : String(firstName).trim();
      user.firstName = v || undefined;
    }

    if (lastName !== undefined) {
      const v = lastName === null ? null : String(lastName).trim();
      user.lastName = v || undefined;
    }

    if (country !== undefined) {
      const v = country === null ? null : String(country).trim();
      user.country = v || undefined;
    }

    // ---- displayCurrency ----
    if (displayCurrency !== undefined) {
      if (displayCurrency === null) {
        // fallback to default if null
        user.displayCurrency = "USD";
      } else {
        const upper = String(displayCurrency).trim().toUpperCase();
        const allowed = DISPLAY_CURRENCIES.includes(
          upper as typeof DISPLAY_CURRENCIES[number]
        );
        if (!allowed) {
          return NextResponse.json(
            {
              error: `Invalid displayCurrency: ${displayCurrency}. Must be one of ${DISPLAY_CURRENCIES.join(
                ", "
              )}.`,
            },
            { status: 400 }
          );
        }
        user.displayCurrency = upper as typeof DISPLAY_CURRENCIES[number];
      }
    }

    // ---- riskLevel ----
    if (riskLevel !== undefined) {
      if (riskLevel === null) {
        user.riskLevel = undefined;
      } else {
        const normalized = String(riskLevel).toLowerCase() as RiskLevel;
        if (!RISK_LEVELS.includes(normalized)) {
          return NextResponse.json(
            {
              error: `Invalid riskLevel: ${riskLevel}. Must be one of ${RISK_LEVELS.join(
                ", "
              )}.`,
            },
            { status: 400 }
          );
        }
        user.riskLevel = normalized;
      }
    }

    // ---- financialKnowledgeLevel ----
    if (financialKnowledgeLevel !== undefined) {
      if (financialKnowledgeLevel === null) {
        user.financialKnowledgeLevel = undefined;
      } else {
        const normalized = String(
          financialKnowledgeLevel
        ).toLowerCase() as FinancialKnowledgeLevel;
        if (!KNOWLEDGE_LEVELS.includes(normalized)) {
          return NextResponse.json(
            {
              error: `Invalid financialKnowledgeLevel: ${financialKnowledgeLevel}. Must be one of ${KNOWLEDGE_LEVELS.join(
                ", "
              )}.`,
            },
            { status: 400 }
          );
        }
        user.financialKnowledgeLevel = normalized;
      }
    }

    await user.save();

    // Return a safe subset of the user
    const safeUser = {
      id: user._id.toString(),
      privyId: user.privyId,
      email: user.email,
      walletAddress: user.walletAddress,
      firstName: user.firstName,
      lastName: user.lastName,
      country: user.country,
      displayCurrency: user.displayCurrency,
      profileImageUrl: user.profileImageUrl,
      financialKnowledgeLevel: user.financialKnowledgeLevel,
      riskLevel: user.riskLevel,
      referralCode: user.referralCode,
      isPro: user.isPro,
      isOnboarded: user.isOnboarded,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return NextResponse.json(
      {
        ok: true,
        user: safeUser,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in PATCH /api/user/update:", err);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
