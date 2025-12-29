// app/api/user/referral/claim/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";
import { Types } from "mongoose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session || !session.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = await User.findOne({ privyId: session.sub });
    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      referralCode?: string;
    };

    const referralCode = (body.referralCode || "").trim();
    if (!referralCode) {
      return NextResponse.json(
        { error: "Referral code is required" },
        { status: 400 }
      );
    }

    // Already has a referrer? Make it idempotent.
    if (currentUser.referredBy) {
      return NextResponse.json(
        {
          ok: false,
          reason: "already_referred",
          message: "Referral already set for this account.",
        },
        { status: 200 }
      );
    }

    const inviter = await User.findOne({ referralCode });
    if (!inviter) {
      return NextResponse.json(
        { error: "Invalid referral code" },
        { status: 404 }
      );
    }

    // No self-referrals
    if (inviter._id.equals(currentUser._id)) {
      return NextResponse.json(
        { error: "You cannot use your own referral code" },
        { status: 400 }
      );
    }

    // ---- Link the accounts ----

    // Add current user to inviter.referrals if not already there
    const referrals: Types.ObjectId[] = inviter.referrals || [];
    if (!referrals.some((id) => id.equals(currentUser._id))) {
      referrals.push(currentUser._id);
      inviter.referrals = referrals;
    }

    // Mark current user as referred by inviter
    currentUser.referredBy = inviter._id;

    await Promise.all([inviter.save(), currentUser.save()]);

    return NextResponse.json(
      {
        ok: true,
        inviter: {
          id: inviter._id.toString(),
          email: inviter.email,
          firstName: inviter.firstName,
          lastName: inviter.lastName,
          referralCode: inviter.referralCode,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in POST /api/user/referral/claim:", err);
    return NextResponse.json(
      { error: "Failed to claim referral" },
      { status: 500 }
    );
  }
}
