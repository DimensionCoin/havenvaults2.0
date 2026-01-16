// lib/getServerUser.ts
import "server-only";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

/* ───────── Types ───────── */

/**
 * Minimal structural type for extracting a wallet address.
 * This avoids `any` while staying schema-agnostic.
 */
type UserWithWalletLike = {
  walletAddress?: string | null;
  depositWallet?: string | { address?: string | null } | null;
  embeddedWallet?: string | { address?: string | null } | null;
};

/* ───────── Base helper (unchanged behavior) ───────── */

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

/* ───────── ADDITIONS (safe, non-breaking) ───────── */

/**
 * Same as getServerUser(), but throws instead of returning null.
 * Useful for API routes that want a hard auth failure.
 */
export async function requireServerUser() {
  const u = await getServerUser();
  if (!u) throw new Error("Unauthorized");
  return u;
}

/**
 * Extract a PublicKey from whatever shape your user model stores.
 * Supports walletAddress / depositWallet / embeddedWallet.
 */
export function getUserWalletPubkey(user: UserWithWalletLike): PublicKey {
  const candidates: unknown[] = [
    user.walletAddress,
    typeof user.depositWallet === "string"
      ? user.depositWallet
      : user.depositWallet?.address,
    typeof user.embeddedWallet === "string"
      ? user.embeddedWallet
      : user.embeddedWallet?.address,
  ];

  const found = candidates.find(
    (v) => typeof v === "string" && v.trim().length > 0 && v !== "pending"
  );

  if (!found) {
    throw new Error("User has no linked wallet address");
  }

  return new PublicKey(found);
}

/**
 * Security check: ensure the expected user is a required signer
 * AND that their signature exists.
 */
export function assertUserSigned(
  tx: VersionedTransaction,
  expectedUser: PublicKey
) {
  const header = tx.message.header;
  const requiredSignerKeys = tx.message.staticAccountKeys.slice(
    0,
    header.numRequiredSignatures
  );

  const signerIndex = requiredSignerKeys.findIndex((k) =>
    k.equals(expectedUser)
  );

  if (signerIndex === -1) {
    throw new Error("User is not a required signer for this transaction");
  }

  const sig = tx.signatures[signerIndex];
  const hasSig = sig?.some((b) => b !== 0);

  if (!hasSig) {
    throw new Error("Missing user signature");
  }
}
