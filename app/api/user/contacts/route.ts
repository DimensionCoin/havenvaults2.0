// app/api/user/contacts/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User, { type IContact } from "@/models/User";
import { Types } from "mongoose";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------------
   Types
------------------------- */

type UserWithAvatar = {
  profileImageUrl?: string | null;
  avatarUrl?: string | null;
  imageUrl?: string | null;
};

type UserWithName = UserWithAvatar & {
  firstName?: string | null;
  lastName?: string | null;
};

type ContactWithProfileImage = IContact & {
  profileImageUrl?: string | null;
};

/* -------------------------
   Helpers
------------------------- */

function pickProfileImage(u: UserWithAvatar | null | undefined): string | null {
  const url =
    (u?.profileImageUrl as string | undefined) ||
    (u?.avatarUrl as string | undefined) ||
    (u?.imageUrl as string | undefined) ||
    null;

  const trimmed = (url || "").trim();
  return trimmed ? trimmed : null;
}

/** Build a display name from firstName/lastName fields */
function buildFullName(u: UserWithName | null | undefined): string | null {
  const first = (u?.firstName || "").trim();
  const last = (u?.lastName || "").trim();
  if (!first && !last) return null;
  return [first, last].filter(Boolean).join(" ");
}

function normalizeContacts(
  contacts: IContact[] = [],
  havenUsersById?: Map<
    string,
    { name: string | null; profileImageUrl: string | null }
  >,
) {
  return contacts.map((c, idx) => {
    const havenId =
      c.havenUser instanceof Types.ObjectId
        ? c.havenUser.toString()
        : typeof c.havenUser === "string"
          ? c.havenUser
          : null;

    const contactWithImage = c as ContactWithProfileImage;
    const fromContact = contactWithImage.profileImageUrl?.trim() || null;
    const havenData = havenId ? havenUsersById?.get(havenId) : null;

    // Priority for name: contact.name > havenUser fullName > null
    const contactName = (c.name || "").trim() || null;
    const havenName = havenData?.name || null;

    // Priority for avatar: contact.profileImageUrl > havenUser avatar > null
    const havenAvatar = havenData?.profileImageUrl || null;

    return {
      id: `${idx}-${c.email ?? c.walletAddress ?? "contact"}`,
      name: contactName || havenName,
      email: c.email ?? null,
      walletAddress: c.walletAddress ?? null,
      status: c.status ?? "external",
      profileImageUrl: fromContact || havenAvatar || null,
    };
  });
}

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

/** Bulk fetch Haven user data (name + avatar) for a list of IDs */
async function fetchHavenUsersById(
  havenIds: string[],
): Promise<
  Map<string, { name: string | null; profileImageUrl: string | null }>
> {
  const result = new Map<
    string,
    { name: string | null; profileImageUrl: string | null }
  >();

  if (!havenIds.length) return result;

  const havenUsers = await User.find({ _id: { $in: havenIds } })
    .select("_id firstName lastName profileImageUrl avatarUrl imageUrl")
    .lean()
    .exec();

  for (const hu of havenUsers) {
    result.set(String(hu._id), {
      name: buildFullName(hu),
      profileImageUrl: pickProfileImage(hu),
    });
  }

  return result;
}

/* -------------------------
   GET: list contacts
------------------------- */

export async function GET() {
  try {
    const { user, error, status } = await getAuthedUser();
    if (!user) return NextResponse.json({ error }, { status });

    const contacts = (user.contacts || []) as IContact[];

    // Bulk fetch Haven user data (name + avatar)
    const havenIds = Array.from(
      new Set(
        contacts
          .map((c) =>
            c.havenUser instanceof Types.ObjectId
              ? c.havenUser.toString()
              : null,
          )
          .filter(Boolean) as string[],
      ),
    );

    const havenUsersById = await fetchHavenUsersById(havenIds);
    const out = normalizeContacts(contacts, havenUsersById);

    return NextResponse.json({ contacts: out });
  } catch (err) {
    console.error("[/api/user/contacts] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 },
    );
  }
}

/* -------------------------
   POST: upsert contact
------------------------- */

export async function POST(req: NextRequest) {
  try {
    const { user, error, status } = await getAuthedUser();
    if (!user) return NextResponse.json({ error }, { status });

    const body: {
      name?: string;
      email?: string;
      walletAddress?: string;
    } | null = await req.json().catch(() => null);

    const nameFromBody = body?.name?.trim() || undefined;
    const emailRaw = body?.email?.trim().toLowerCase();
    const walletAddress = body?.walletAddress?.trim() || undefined;

    if (!emailRaw && !walletAddress) {
      return NextResponse.json(
        { error: "Must provide at least an email or walletAddress" },
        { status: 400 },
      );
    }

    const email = emailRaw;

    // Find Haven user & pull their name + profile image
    let targetUser: {
      _id: Types.ObjectId;
      firstName?: string | null;
      lastName?: string | null;
      walletAddress?: string | null;
      profileImageUrl?: string | null;
      avatarUrl?: string | null;
      imageUrl?: string | null;
    } | null = null;

    if (email) {
      targetUser = await User.findOne({ email })
        .select(
          "_id firstName lastName walletAddress profileImageUrl avatarUrl imageUrl",
        )
        .lean()
        .exec();
    }

    // Build the contact name: use provided name, or Haven user's full name
    const contactName = nameFromBody || buildFullName(targetUser) || undefined;

    const contactPayload: IContact = {
      name: contactName,
      email: email ?? undefined,
      walletAddress: walletAddress ?? targetUser?.walletAddress ?? undefined,
      havenUser: targetUser?._id ?? undefined,
      status: targetUser ? "active" : "external",
      // @ts-expect-error - profileImageUrl may not be in IContact schema
      profileImageUrl: targetUser ? pickProfileImage(targetUser) : undefined,
    };

    const contacts: IContact[] = ((user.contacts || []) as IContact[]).slice();
    let updated = false;

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];

      if (
        (email && c.email === email) ||
        (walletAddress && c.walletAddress === walletAddress)
      ) {
        contacts[i] = { ...c, ...contactPayload };
        updated = true;
        break;
      }
    }

    if (!updated) contacts.push(contactPayload);

    user.contacts = contacts as unknown as IContact[];
    await user.save();

    // Rebuild response with full Haven user data
    const saved = (user.contacts || []) as IContact[];

    const havenIds = Array.from(
      new Set(
        saved
          .map((c) =>
            c.havenUser instanceof Types.ObjectId
              ? c.havenUser.toString()
              : null,
          )
          .filter(Boolean) as string[],
      ),
    );

    const havenUsersById = await fetchHavenUsersById(havenIds);
    const outContacts = normalizeContacts(saved, havenUsersById);

    return NextResponse.json({ ok: true, contacts: outContacts });
  } catch (err) {
    console.error("[/api/user/contacts] POST error:", err);
    return NextResponse.json(
      { error: "Failed to save contact" },
      { status: 500 },
    );
  }
}

/* -------------------------
   DELETE: remove contact
------------------------- */

export async function DELETE(req: NextRequest) {
  try {
    const { user, error, status } = await getAuthedUser();
    if (!user) return NextResponse.json({ error }, { status });

    const body: { email?: string; walletAddress?: string } | null = await req
      .json()
      .catch(() => null);

    const emailRaw = body?.email?.trim().toLowerCase();
    const walletAddress = body?.walletAddress?.trim() || undefined;

    if (!emailRaw && !walletAddress) {
      return NextResponse.json(
        { error: "Must provide email or walletAddress to remove" },
        { status: 400 },
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

    // Fetch Haven user data for remaining contacts
    const havenIds = Array.from(
      new Set(
        after
          .map((c) =>
            c.havenUser instanceof Types.ObjectId
              ? c.havenUser.toString()
              : null,
          )
          .filter(Boolean) as string[],
      ),
    );

    const havenUsersById = await fetchHavenUsersById(havenIds);
    const out = normalizeContacts(after, havenUsersById);

    return NextResponse.json({ ok: true, contacts: out });
  } catch (err) {
    console.error("[/api/user/contacts] DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to remove contact" },
      { status: 500 },
    );
  }
}
