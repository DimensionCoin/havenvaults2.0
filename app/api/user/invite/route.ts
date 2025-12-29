import "server-only";
import { NextResponse } from "next/server";
import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InviteItem = {
  isPersonal?: boolean;
  email?: string | null;
  status?: "sent" | "clicked" | "signed_up";
  sentAt?: Date | string | null;
  clickedAt?: Date | string | null;
  redeemedAt?: Date | string | null;
};

type InviteDTO = {
  email: string | null;
  status: "sent" | "clicked" | "signed_up";
  sentAt: string | null;
  clickedAt: string | null;
  redeemedAt: string | null;
};


export async function GET() {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session?.sub)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await User.findOne({ privyId: session.sub }).lean().exec();
    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const rawInvites = (user.invites || []) as InviteItem[];

    const invites: InviteDTO[] = rawInvites
      .filter((i: InviteItem) => i.isPersonal === true)
      .map((i: InviteItem) => ({
        email: i.email ?? null,
        status: (i.status ?? "sent") as InviteDTO["status"],
        sentAt: i.sentAt ? new Date(i.sentAt).toISOString() : null,
        clickedAt: i.clickedAt ? new Date(i.clickedAt).toISOString() : null,
        redeemedAt: i.redeemedAt ? new Date(i.redeemedAt).toISOString() : null,
      }))
      .sort((a: InviteDTO, b: InviteDTO) =>
        (b.sentAt || "").localeCompare(a.sentAt || "")
      );

    return NextResponse.json({ invites });
  } catch (err) {
    console.error("/api/user/invites GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch invites" },
      { status: 500 }
    );
  }
}
