// app/api/auth/session/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { privyServerClient } from "@/lib/privyServer";
import { setSessionCookie } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function generateReferralCode() {
  return `HVN_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// Small helper to normalize linked accounts between client/server shapes
type LinkedAccount = {
  type?: string;
  kind?: string;
  address?: string;
  email?: string | null;
  walletClientType?: string;
  chainType?: string;
  chain_type?: string;
  chain?: string;
  blockchain?: string;
  oauthProvider?: string;
  provider?: string;
  profile?: { email?: string };
  userInfo?: { email?: string };
  publicAddress?: string;
  public_address?: string;
};

type PrivyUser = {
  email?: string | { address?: string | null } | null;
  linkedAccounts?: LinkedAccount[];
  linked_accounts?: LinkedAccount[];
};

// Small helper to normalize linked accounts between client/server shapes
function getLinkedAccounts(privyUser: PrivyUser | null | undefined): LinkedAccount[] {
  if (!privyUser) return [];
  const linked =
    privyUser.linkedAccounts ??
    privyUser.linked_accounts ??
    [];
  return Array.isArray(linked) ? linked : [];
}

// Try to extract an email from the Privy user profile (robust across shapes)
function deriveEmailFromPrivyUser(privyUser: PrivyUser | null | undefined): string | undefined {
  if (!privyUser) return undefined;

  // 1) Standard email on root
  const emailField = privyUser.email;
  if (typeof emailField === "string") return emailField;
  if (emailField && typeof emailField === "object" && emailField.address) {
    return String(emailField.address);
  }

  const linkedAccounts = getLinkedAccounts(privyUser);

  // 2) Explicit "email" account, if any
  const emailAccount = linkedAccounts.find(
    (acc) =>
      (acc?.type === "email" || acc?.kind === "email") &&
      (acc.address || acc.email)
  );

  if (emailAccount?.address) return String(emailAccount.address);
  if (emailAccount?.email) return String(emailAccount.email);

  // 3) Google OAuth account (most Google logins will hit this)
  const googleAccount = linkedAccounts.find(
    (acc) =>
      (acc?.type === "oauth" || acc?.type === "google") &&
      (acc.provider === "google" || acc.oauthProvider === "google")
  );

  if (googleAccount?.email) return String(googleAccount.email);
  if (googleAccount?.address) return String(googleAccount.address);
  if (googleAccount?.profile?.email) return String(googleAccount.profile.email);
  if (googleAccount?.userInfo?.email)
    return String(googleAccount.userInfo.email);

  // 4) Last resort: scan all linked accounts for an email-looking field
  for (const acc of linkedAccounts) {
    const candidates = [
      acc?.email,
      acc?.address,
      acc?.profile?.email,
      acc?.userInfo?.email,
    ].filter(Boolean);

    for (const c of candidates) {
      const value = String(c);
      if (value.includes("@")) {
        return value;
      }
    }
  }

  // If we reach here, we genuinely don't have an email for this Privy user
  return undefined;
}

// Try to extract a Solana embedded wallet address (more defensive)
function deriveSolanaWalletFromPrivyUser(privyUser: PrivyUser | null | undefined): string | undefined {
  const linkedAccounts = getLinkedAccounts(privyUser);
  if (!linkedAccounts.length) return undefined;

  const solWallet = linkedAccounts.find((acc) => {
    if (acc?.type !== "wallet") return false;

    const chain =
      acc.chainType || acc.chain_type || acc.chain || acc.blockchain || "";
    const chainLower = String(chain).toLowerCase();

    // handle "solana", "solana:devnet", "solana:mainnet", etc.
    return chainLower.includes("solana");
  });

  return (
    solWallet?.address ||
    solWallet?.publicAddress ||
    solWallet?.public_address ||
    undefined
  );
}

export async function POST(req: NextRequest) {
  try {
    await connect();

    let accessToken: string | null = null;
    let solanaAddressFromBody: string | undefined;
    let emailFromBody: string | undefined;

    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");

    if (authHeader && authHeader.startsWith("Bearer ")) {
      accessToken = authHeader.slice("Bearer ".length).trim() || null;
    }

    const body: {
      accessToken?: string;
      solanaAddress?: string;
      email?: string;
    } | null = await req.json().catch(() => null);

    if (!accessToken && body && typeof body.accessToken === "string") {
      accessToken = body.accessToken.trim();
    }
    if (body && typeof body.solanaAddress === "string") {
      solanaAddressFromBody = body.solanaAddress.trim();
    }
    if (body && typeof body.email === "string") {
      emailFromBody = body.email.trim().toLowerCase();
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing or invalid accessToken" },
        { status: 400 }
      );
    }

    // 1) Verify Privy auth token → privyId
    const claims: {
      userId?: string;
      sub?: string;
      user_id?: string;
      email?: string;
      email_address?: string;
    } = await privyServerClient.verifyAuthToken(accessToken);

    const privyId: string | undefined =
      claims.userId ?? claims.sub ?? claims.user_id;

    if (!privyId) {
      return NextResponse.json(
        { error: "Invalid Privy token (no userId)" },
        { status: 401 }
      );
    }

    const emailFromClaims: string | undefined =
      claims.email || claims.email_address || undefined;

    // 2) Fetch Privy user profile (email + wallet)
    let privyUser: PrivyUser | null = null;
    try {
      privyUser = await privyServerClient.getUser(privyId);
    } catch (e) {
      console.warn("privyServerClient.getUser failed:", e);
    }

    const emailFromPrivy = deriveEmailFromPrivyUser(privyUser);
    const walletFromPrivy = deriveSolanaWalletFromPrivyUser(privyUser);

    // 3) Load existing Mongo user (if any)
    let user = await User.findOne({ privyId });

    const now = new Date();
    const isNewUser = !user;

    // Decide final email + wallet that we will persist
    const finalEmail: string = (
      emailFromBody ||
      emailFromPrivy || // 👈 this will now capture Google OAuth emails
      emailFromClaims ||
      user?.email || // if existing user
      `${privyId.replace(/[:]/g, "_")}@user.haven.local`
    ).toLowerCase();

    // Treat "pending" as "no wallet yet"
    const existingWallet =
      user && user.walletAddress !== "pending" ? user.walletAddress : undefined;

    const finalWalletAddress: string =
      solanaAddressFromBody || walletFromPrivy || existingWallet || "pending";

    console.log("[/api/auth/session] wallet + email resolution:", {
      solanaAddressFromBody,
      walletFromPrivy,
      existingWallet,
      finalWalletAddress,
      isNewUser,
      privyId,
      emailFromBody,
      emailFromPrivy,
      emailFromClaims,
      finalEmail,
    });

    if (!user) {
      // New user
      user = await User.create({
        privyId,
        email: finalEmail,
        walletAddress: finalWalletAddress,
        referralCode: generateReferralCode(),
        displayCurrency: "USD",
        isOnboarded: false,
        isPro: false,
        lastLoginAt: now,
      });
    } else {
      // Existing user: update email / wallet if changed
      if (finalWalletAddress && user.walletAddress !== finalWalletAddress) {
        user.walletAddress = finalWalletAddress;
      }
      if (finalEmail && user.email !== finalEmail) {
        user.email = finalEmail;
      }
      user.lastLoginAt = now;
      await user.save();
    }

    // 4) Set session cookie with privyId + userId
    await setSessionCookie({
      sub: privyId,
      userId: user._id.toString(),
      email: user.email,
    });

    return NextResponse.json(
      {
        ok: true,
        isNewUser,
        user: {
          id: user._id.toString(),
          privyId: user.privyId,
          email: user.email,
          walletAddress: user.walletAddress,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          isOnboarded: user.isOnboarded,
          isPro: user.isPro,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("/api/auth/session error:", err);
    return NextResponse.json(
      { error: "Failed to create app session" },
      { status: 500 }
    );
  }
}
