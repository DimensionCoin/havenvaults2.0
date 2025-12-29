import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InviteItem = {
  inviteToken: string;
  status: "sent" | "clicked" | "signed_up";
  clickedAt?: Date | null;
  sentAt?: Date | null;
  signedUpAt?: Date | null;
  email?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    await connect();

    const body = (await req.json().catch(() => ({}))) as {
      inviteToken?: string;
    };
    const inviteToken = (body.inviteToken || "").trim();
    if (!inviteToken) {
      return NextResponse.json(
        { error: "inviteToken is required" },
        { status: 400 }
      );
    }

    const inviter = await User.findOne({ "invites.inviteToken": inviteToken });
    if (!inviter) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const invites = (inviter.invites || []) as InviteItem[];

    const invite = invites.find(
      (i: InviteItem) => i.inviteToken === inviteToken
    );
    if (!invite) return NextResponse.json({ ok: false }, { status: 404 });

    const now = new Date();
    if (invite.status === "sent") {
      invite.status = "clicked";
      invite.clickedAt = now;
      await inviter.save();
    }

    return NextResponse.json({ ok: true, status: invite.status });
  } catch (err) {
    console.error("/api/invite/track error:", err);
    return NextResponse.json(
      { error: "Failed to track invite" },
      { status: 500 }
    );
  }
}
