// app/api/user/invite/claim/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  inviteToken?: string;
  referralCode?: string; // optional, ignored (kept for compatibility)
};

type InviteItem = {
  inviteToken: string;
  isPersonal?: boolean;
  email?: string | null;
  status: "sent" | "clicked" | "signed_up";
  sentAt?: Date | null;
  clickedAt?: Date | null;
  redeemedAt?: Date | null;
  invitedUser?: Types.ObjectId | null;
  claimedEmail?: string | null;
  claimedWalletAddress?: string | null;
};

type ContactItem = {
  email?: string | null;
  walletAddress?: string | null;
  havenUser?: Types.ObjectId | null;
  status?: "invited" | "active" | "external";
  invitedAt?: Date | null;
  joinedAt?: Date | null;
};

export async function POST(req: NextRequest) {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const inviteToken = (body.inviteToken || "").trim();
    if (!inviteToken) {
      return NextResponse.json(
        { error: "inviteToken is required" },
        { status: 400 }
      );
    }

    const receiver = await User.findOne({ privyId: session.sub });
    if (!receiver) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (receiver.referredBy) {
      return NextResponse.json(
        {
          ok: false,
          reason: "already_referred",
          message: "Referral already set for this account.",
        },
        { status: 409 }
      );
    }

    const receiverIdStr = receiver._id.toString();
    const receiverEmail = (receiver.email || "").toLowerCase();
    const receiverWallet = receiver.walletAddress;
    const now = new Date();

    // Find inviter who owns this invite token (personal only)
    const inviter = await User.findOne({
      invites: { $elemMatch: { inviteToken, isPersonal: true } },
    });

    if (!inviter) {
      return NextResponse.json(
        {
          ok: false,
          reason: "not_found",
          message: "Invite not found or no longer valid.",
        },
        { status: 404 }
      );
    }

    // no self-referral
    if (inviter._id.equals(receiver._id)) {
      return NextResponse.json(
        { error: "You cannot use your own invite." },
        { status: 400 }
      );
    }

    const invites = (inviter.invites || []) as InviteItem[];
    const invite = invites.find((i) => i.inviteToken === inviteToken);
    if (!invite) {
      return NextResponse.json(
        { ok: false, reason: "not_found" },
        { status: 404 }
      );
    }

    // Email-bound: only invited email can redeem
    const inviteEmail = (invite.email || "").toLowerCase();
    if (!inviteEmail || inviteEmail !== receiverEmail) {
      return NextResponse.json(
        {
          ok: false,
          reason: "wrong_recipient",
          message:
            "This invite link is only valid for the email it was sent to.",
        },
        { status: 403 }
      );
    }

    const invitedUserIdStr = invite.invitedUser
      ? (invite.invitedUser as Types.ObjectId).toString()
      : null;

    // One-time: if used by someone else, block
    if (
      invite.status === "signed_up" &&
      invitedUserIdStr &&
      invitedUserIdStr !== receiverIdStr
    ) {
      return NextResponse.json(
        {
          ok: false,
          reason: "already_used",
          message: "This invite has already been used.",
        },
        { status: 409 }
      );
    }

    const alreadyLinked =
      invite.status === "signed_up" && invitedUserIdStr === receiverIdStr;

    // If this invite was never marked clicked, mark it now (helps “recent invites” UI)
    if (!invite.clickedAt) {
      invite.clickedAt = now;
      if (invite.status === "sent") invite.status = "clicked";
    }

    if (!alreadyLinked) {
      invite.status = "signed_up";
      invite.invitedUser = receiver._id;
      invite.redeemedAt = invite.redeemedAt || now;
      invite.claimedEmail = receiverEmail;
      invite.claimedWalletAddress = receiverWallet;
    }

    const contacts = (inviter.contacts || []) as ContactItem[];

    const contact = contacts.find(
      (c) => (c.email || "").toLowerCase() === receiverEmail
    );

    if (!contact) {
      inviter.contacts.push({
        email: receiverEmail,
        walletAddress: receiverWallet,
        havenUser: receiver._id,
        status: "active",
        invitedAt: invite.sentAt || now,
        joinedAt: now,
      });
    } else {
      contact.status = "active";
      contact.havenUser = receiver._id;
      contact.walletAddress = contact.walletAddress || receiverWallet;
      contact.invitedAt = contact.invitedAt || invite.sentAt || now;
      contact.joinedAt = contact.joinedAt || now;
    }

    // Ensure inviter.referrals includes receiver once
    const alreadyInReferrals = (inviter.referrals || []).some(
      (id: Types.ObjectId) => id.toString() === receiverIdStr
    );
    if (!alreadyInReferrals) inviter.referrals.push(receiver._id);

    // Set receiver.referredBy
    receiver.referredBy = inviter._id;

    await Promise.all([inviter.save(), receiver.save()]);

    return NextResponse.json(
      {
        ok: true,
        alreadyLinked,
        inviter: {
          id: inviter._id.toString(),
          email: inviter.email ?? null,
          fullName:
            [inviter.firstName, inviter.lastName].filter(Boolean).join(" ") ||
            null,
        },
        invite: {
          email: inviteEmail,
          inviteToken,
          status: invite.status,
          sentAt: invite.sentAt ? new Date(invite.sentAt).toISOString() : null,
          redeemedAt: invite.redeemedAt
            ? new Date(invite.redeemedAt).toISOString()
            : null,
          clickedAt: invite.clickedAt
            ? new Date(invite.clickedAt).toISOString()
            : null,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("/api/user/invite/claim error:", err);
    return NextResponse.json(
      { error: "Failed to claim invite" },
      { status: 500 }
    );
  }
}
