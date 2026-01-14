// lib/getServerUser.ts
import "server-only";
import { connect } from "@/lib/db";
import User from "@/models/User"; // <- your existing User model
import { getSessionFromCookies } from "@/lib/auth";

export async function getServerUser() {
  const session = await getSessionFromCookies();
  if (!session?.sub) return null;

  await connect();

  // Prefer a direct Mongo id if you store it in the JWT
  if (session.userId) {
    const u = await User.findById(session.userId).lean();
    return u ?? null;
  }

  // Otherwise look up by privyId (sub)
  const u = await User.findOne({ privyId: session.sub }).lean();
  return u ?? null;
}
