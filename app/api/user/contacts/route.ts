// app/api/user/contacts/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User, { type IContact } from "@/models/User";
import { Types } from "mongoose";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Small helper to normalize contacts for the client
function normalizeContacts(contacts: IContact[] = []) {
  return contacts.map((c, idx) => ({
    id: `${idx}-${c.email ?? c.walletAddress ?? "contact"}`,
    name: c.name ?? null,
    email: c.email ?? null,
    walletAddress: c.walletAddress ?? null,
    status: c.status ?? "external",
  }));
}

// Shared helper to fetch the authed user
async function getAuthedUser() {
  await connect();

  const session = await getSessionFromCookies();
  if (!session?.sub) {
    return { error: "Unauthorized" as const, status: 401 as const, user: null };
  }

  const user =
    (session.userId && (await User.findById(session.userId).exec())) ||
    (await User.findOne({ privyId: session.sub }).exec());

  if (!user) {
    return {
      error: "User not found" as const,
      status: 404 as const,
      user: null,
    };
  }

  return { user, error: null as null, status: 200 as const };
}

/* ───────────────────────────────── GET: list contacts ─────────────────────────────── */

export async function GET() {
  try {
    const { user, error, status } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error }, { status });
    }

    const contacts = normalizeContacts((user.contacts || []) as IContact[]);
    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("[/api/user/contacts] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}

/* ───────────────────────────────── POST: upsert contact ───────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const { user, error, status } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error }, { status });
    }

    const body: {
      name?: string;
      email?: string;
      walletAddress?: string;
    } | null = await req.json().catch(() => null);

    const name = body?.name?.trim() || undefined;
    const emailRaw = body?.email?.trim().toLowerCase();
    const walletAddress = body?.walletAddress?.trim() || undefined;

    if (!emailRaw && !walletAddress) {
      return NextResponse.json(
        { error: "Must provide at least an email or walletAddress" },
        { status: 400 }
      );
    }

    const email = emailRaw;

    // Try to see if there's a Haven user for this email
    let targetUser: { _id: Types.ObjectId; walletAddress?: string | null } | null =
      null;
    if (email) {
      targetUser = await User.findOne({ email })
        .select("_id walletAddress")
        .lean()
        .exec();
    }

    const contactPayload: IContact = {
      name,
      email: email ?? undefined,
      walletAddress: walletAddress ?? targetUser?.walletAddress ?? undefined,
      havenUser: targetUser?._id ?? undefined,
      status: targetUser ? "active" : "external",
    };

    // Upsert into user.contacts by email if present, else by walletAddress
    const contacts: IContact[] = ((user.contacts || []) as IContact[]).slice();
    let updated = false;

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];

      if (
        (email && c.email === email) ||
        (walletAddress && c.walletAddress === walletAddress)
      ) {
        // ✅ No toObject() — IContact is a plain type
        contacts[i] = {
          ...c,
          ...contactPayload,
        };
        updated = true;
        break;
      }
    }

    if (!updated) {
      contacts.push(contactPayload);
    }

    user.contacts = contacts as unknown as IContact[];
    await user.save();

    const outContacts = normalizeContacts((user.contacts || []) as IContact[]);
    return NextResponse.json({ ok: true, contacts: outContacts });
  } catch (err) {
    console.error("[/api/user/contacts] POST error:", err);
    return NextResponse.json(
      { error: "Failed to save contact" },
      { status: 500 }
    );
  }
}

/* ─────────────────────────────── DELETE: remove contact ───────────────────────────── */

export async function DELETE(req: NextRequest) {
  try {
    const { user, error, status } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error }, { status });
    }

    const body: { email?: string; walletAddress?: string } | null = await req
      .json()
      .catch(() => null);

    const emailRaw = body?.email?.trim().toLowerCase();
    const walletAddress = body?.walletAddress?.trim() || undefined;

    if (!emailRaw && !walletAddress) {
      return NextResponse.json(
        { error: "Must provide email or walletAddress to remove" },
        { status: 400 }
      );
    }

    const before: IContact[] = (user.contacts || []) as IContact[];

    const after = before.filter((c) => {
      const matchesEmail = emailRaw && c.email === emailRaw;
      const matchesWallet = walletAddress && c.walletAddress === walletAddress;
      return !(matchesEmail || matchesWallet);
    });

    user.contacts = after as unknown as IContact[];
    await user.save();

    const outContacts = normalizeContacts((user.contacts || []) as IContact[]);
    return NextResponse.json({ ok: true, contacts: outContacts });
  } catch (err) {
    console.error("[/api/user/contacts] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to remove contact" },
      { status: 500 }
    );
  }
}
