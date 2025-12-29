import "server-only";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User, { IContact, IInvite } from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { email?: string; message?: string };

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export async function POST(req: NextRequest) {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const inviter = await User.findOne({ privyId: session.sub });
    if (!inviter) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const emailRaw = (body.email || "").trim().toLowerCase();

    if (!emailRaw || !isValidEmail(emailRaw)) {
      return NextResponse.json(
        { error: "Valid email is required." },
        { status: 400 }
      );
    }

    // ✅ 1) Check if they already exist on Haven — if yes, don't create a personal link
    const existingUser = await User.findOne({ email: emailRaw }).lean().exec();
    if (existingUser) {
      // update contacts → active
      const now = new Date();
      const contacts: IContact[] = inviter.contacts || [];
      const idx = contacts.findIndex(
        (c) => (c.email || "").toLowerCase() === emailRaw
      );

      if (idx >= 0) {
        const c = contacts[idx];
        c.status = "active";
        c.havenUser = existingUser._id;
        c.walletAddress = c.walletAddress || existingUser.walletAddress;
        c.joinedAt = c.joinedAt || now;
      } else {
        contacts.push({
          email: emailRaw,
          status: "active",
          havenUser: existingUser._id,
          walletAddress: existingUser.walletAddress,
          joinedAt: now,
        });
      }

      inviter.contacts = contacts;
      await inviter.save();

      return NextResponse.json(
        {
          ok: false,
          reason: "already_on_haven",
          message:
            "That email is already a Haven user. No personal invite created.",
        },
        { status: 409 }
      );
    }

    // ✅ 2) Idempotent: if an unredeemed personal invite already exists for this email, return it
  const invites: IInvite[] = inviter.invites || [];

  const existingInvite: IInvite | undefined = invites.find(
    (i: IInvite) =>
      i.isPersonal === true &&
      (i.email || "").toLowerCase() === emailRaw &&
      i.status !== "signed_up"
  );


    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
    const buildUrl = (token: string) => {
      // ✅ IMPORTANT: personal link should NOT include ?ref=...
      // so it can't be reused as a generic referral link
      const path = `/sign-in?invite=${encodeURIComponent(token)}`;
      return baseUrl ? `${baseUrl}${path}` : path;
    };

    if (existingInvite?.inviteToken) {
      return NextResponse.json(
        {
          ok: true,
          reused: true,
          invite: {
            email: emailRaw,
            inviteToken: existingInvite.inviteToken,
            status: existingInvite.status,
            sentAt: existingInvite.sentAt?.toISOString?.() ?? null,
          },
          link: buildUrl(existingInvite.inviteToken),
        },
        { status: 200 }
      );
    }

    // ✅ 3) Create brand-new one-time token
    let inviteToken = "";
    while (true) {
      inviteToken = crypto.randomBytes(24).toString("base64url"); // strong token
      const collision = await User.exists({
        "invites.inviteToken": inviteToken,
      });
      if (!collision) break;
    }

    const now = new Date();

    inviter.invites.push({
      email: emailRaw,
      sentAt: now,
      status: "sent",
      invitedUser: undefined,
      inviteToken,
      isPersonal: true,
      clickedAt: undefined,
      redeemedAt: undefined,
      claimedEmail: undefined,
      claimedWalletAddress: undefined,
    });

    // ✅ 4) Upsert inviter contact as invited
    const contacts: IContact[] = inviter.contacts || [];
    const idx = contacts.findIndex(
      (c) => (c.email || "").toLowerCase() === emailRaw
    );

    if (idx >= 0) {
      const c = contacts[idx];
      if (c.status === "external") c.status = "invited";
      c.invitedAt = c.invitedAt || now;
      c.email = emailRaw;
    } else {
      contacts.push({
        email: emailRaw,
        status: "invited",
        invitedAt: now,
      });
    }

    inviter.contacts = contacts;
    await inviter.save();

    return NextResponse.json(
      {
        ok: true,
        reused: false,
        invite: {
          email: emailRaw,
          inviteToken,
          status: "sent",
          sentAt: now.toISOString(),
        },
        link: buildUrl(inviteToken),
        path: `/sign-in?invite=${encodeURIComponent(inviteToken)}`,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("/api/user/invite/personal error:", err);
    return NextResponse.json(
      { error: "Failed to create personal invite" },
      { status: 500 }
    );
  }
}
