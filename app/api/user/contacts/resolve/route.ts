// app/api/user/contacts/resolve/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User, { IContact } from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper to build a nice name from a User doc
type MinimalUser = {
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string | null;
};

function buildFullName(
  user: MinimalUser | null | undefined
): string | undefined {
  if (!user) return undefined;
  const parts = [user.firstName, user.lastName].filter(Boolean);
  if (!parts.length) return undefined;
  return parts.join(" ");
}

export async function GET(req: NextRequest) {
  try {
    await connect();

    const { searchParams } = new URL(req.url);
    const emailRaw = searchParams.get("email");
    const email = emailRaw?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: "Missing email query parameter" },
        { status: 400 }
      );
    }

    const session = await getSessionFromCookies();
    if (!session?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load the current user + their contacts (with havenUser populated)
    const currentUser =
      (session.userId &&
        (await User.findById(session.userId)
          .populate(
            "contacts.havenUser",
            "firstName lastName profileImageUrl email walletAddress"
          )
          .exec())) ||
      (await User.findOne({ privyId: session.sub })
        .populate(
          "contacts.havenUser",
          "firstName lastName profileImageUrl email walletAddress"
        )
        .exec());

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    /* ───────────────────────────── 1) Canonical Haven user by email ───────────────────────────── */

    const targetUser = await User.findOne({ email }).lean().exec();

    if (targetUser && targetUser.walletAddress) {
      // (Optional) Best-effort: keep their saved contact in sync with the
      // canonical Haven user + wallet for this email.
      try {
        const contacts = (currentUser.contacts || []) as IContact[];

        const idx = contacts.findIndex(
          (c: IContact) =>
            typeof c.email === "string" && c.email.toLowerCase() === email
        );

        if (idx >= 0) {
          contacts[idx].walletAddress = targetUser.walletAddress;
          contacts[idx].havenUser = targetUser._id;
          contacts[idx].status = "active";
          currentUser.markModified("contacts");
          await currentUser.save();
        }
      } catch (e) {
        console.warn(
          "[/api/user/contacts/resolve] failed to sync contact with canonical user:",
          e
        );
      }

      // ✅ Always use the current walletAddress from the User collection
      return NextResponse.json({
        email: targetUser.email,
        name: buildFullName(targetUser),
        walletAddress: targetUser.walletAddress,
        status: "active",
        profileImageUrl: targetUser.profileImageUrl ?? null,
      });
    }

    /* ───────────────────────────── 2) Fallback: external contact ─────────────────────────────
       If there is no Haven user for this email, you *may* still want to allow
       sending to a saved external wallet later. For now, your Transfer flow
       treats 404 as "must have a Haven account", so you can keep this or
       delete it depending on roadmap.
    */

    const contacts = (currentUser.contacts || []) as IContact[];

    const contact = contacts.find(
      (c: IContact) =>
        typeof c.email === "string" && c.email.toLowerCase() === email
    );

    if (contact && contact.walletAddress) {
      type PopulatedContact = IContact & { havenUser?: MinimalUser | null };
      const contactHavenUser = (contact as PopulatedContact).havenUser;

      const isPopulatedHavenUser =
        contactHavenUser &&
        typeof contactHavenUser === "object" &&
        ("firstName" in contactHavenUser ||
          "lastName" in contactHavenUser ||
          "profileImageUrl" in contactHavenUser);

      const havenUserInfo = isPopulatedHavenUser
        ? (contactHavenUser as MinimalUser)
        : null;

      return NextResponse.json({
        email,
        name: contact.name || buildFullName(havenUserInfo ?? undefined),
        walletAddress: contact.walletAddress,
        status: contact.status || (havenUserInfo ? "active" : "external"),
        profileImageUrl: havenUserInfo?.profileImageUrl ?? null,
      });
    }

    // No Haven user + no external wallet → can't send
    return NextResponse.json(
      { error: "No Haven user found for this email" },
      { status: 404 }
    );
  } catch (err) {
    console.error("[/api/user/contacts/resolve] GET error:", err);
    return NextResponse.json(
      { error: "Failed to resolve contact" },
      { status: 500 }
    );
  }
}
