// app/api/auth/user/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

function d128ToString(v: unknown): string | null {
  if (v == null) return null;
  // mongoose Decimal128 has toString()
  if (typeof v?.toString === "function") return v.toString();
  return String(v);
}

type SavingsType = "flex" | "plus";

type SavingsAccountLean = {
  type?: string;
  walletAddress?: string;
  marginfiAccountPk?: string | null;
  principalDeposited?: unknown;
  principalWithdrawn?: unknown;
  interestWithdrawn?: unknown;
  feesPaidUsdc?: unknown;
  lastOnChainBalance?: unknown;
  lastSyncedAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

type ContactLean = {
  name?: string | null;
  email?: string | null;
  walletAddress?: string | null;
  status?: string | null;
  invitedAt?: string | Date | null;
  joinedAt?: string | Date | null;
};

type InviteLean = {
  email?: string | null;
  sentAt?: string | Date | null;
  status?: string | null;
  invitedUser?: unknown;
};

type ReferralLean = {
  _id?: { toString?: () => string };
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  walletAddress?: string | null;
  profileImageUrl?: string | null;
  createdAt?: string | Date | null;
};

type BalanceSnapshotLean = {
  asOf?: string | Date | null;
  totalBalanceUSDC?: unknown;
  breakdown?: {
    savingsFlex?: unknown;
    savingsPlus?: unknown;
    invest?: unknown;
    amplify?: unknown;
  } | null;
};

type UserLean = {
  _id: { toString: () => string };
  privyId?: string;
  email?: string;
  walletAddress?: string;
  firstName?: string | null;
  lastName?: string | null;
  country?: string | null;
  displayCurrency?: string;
  profileImageUrl?: string | null;
  savingsAccounts?: SavingsAccountLean[] | null;
  financialKnowledgeLevel?: unknown;
  riskLevel?: unknown;
  referralCode?: string;
  isPro?: boolean;
  isOnboarded?: boolean;
  lastLoginAt?: string | Date | null;
  lastBalanceSyncAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  contacts?: ContactLean[] | null;
  invites?: InviteLean[] | null;
  referrals?: ReferralLean[] | null;
  balanceSnapshots?: BalanceSnapshotLean[] | null;
};

function normalizeSavingsAccounts(user: UserLean) {
  const walletAddress: string = user.walletAddress || "pending";
  const raw = Array.isArray(user.savingsAccounts) ? user.savingsAccounts : [];

  const byType = new Map<SavingsType, SavingsAccountLean>();
  for (const acc of raw) {
    if (acc?.type === "flex" || acc?.type === "plus") {
      // first one wins; schema should prevent duplicates, but be defensive
      if (!byType.has(acc.type)) byType.set(acc.type, acc);
    }
  }

  const makeFallback = (type: SavingsType) => ({
    type,
    walletAddress,
    marginfiAccountPk: null,
    principalDeposited: "0",
    principalWithdrawn: "0",
    interestWithdrawn: "0",
    feesPaidUsdc: "0",
    lastOnChainBalance: null,
    lastSyncedAt: null,
    createdAt: null,
    updatedAt: null,
  });

  const serializeOne = (type: SavingsType) => {
    const acc = byType.get(type);
    if (!acc) return makeFallback(type);

    return {
      type,
      walletAddress: acc.walletAddress || walletAddress,
      marginfiAccountPk:
        typeof acc.marginfiAccountPk === "string" &&
        acc.marginfiAccountPk.trim()
          ? acc.marginfiAccountPk.trim()
          : null,

      principalDeposited: d128ToString(acc.principalDeposited) ?? "0",
      principalWithdrawn: d128ToString(acc.principalWithdrawn) ?? "0",
      interestWithdrawn: d128ToString(acc.interestWithdrawn) ?? "0",
      feesPaidUsdc: d128ToString(acc.feesPaidUsdc) ?? "0",

      lastOnChainBalance: d128ToString(acc.lastOnChainBalance),
      lastSyncedAt: acc.lastSyncedAt
        ? new Date(acc.lastSyncedAt).toISOString()
        : null,

      createdAt: acc.createdAt ? new Date(acc.createdAt).toISOString() : null,
      updatedAt: acc.updatedAt ? new Date(acc.updatedAt).toISOString() : null,
    };
  };

  // Always return in stable order
  return [serializeOne("flex"), serializeOne("plus")];
}

function serializeUser(user: UserLean) {
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || null;

  /* ───────── Contacts ───────── */
  const contacts = (user.contacts ?? []).map((c) => ({
    name: c.name ?? null,
    email: c.email ?? null,
    walletAddress: c.walletAddress ?? null,
    status: c.status,
    invitedAt: c.invitedAt ? new Date(c.invitedAt).toISOString() : null,
    joinedAt: c.joinedAt ? new Date(c.joinedAt).toISOString() : null,
  }));

  /* ───────── Invites ───────── */
  const invites = (user.invites ?? []).map((inv) => ({
    email: inv.email,
    sentAt: inv.sentAt ? new Date(inv.sentAt).toISOString() : null,
    status: inv.status,
    invitedUserId: inv.invitedUser ? inv.invitedUser.toString() : null,
  }));

  /* ───────── Referrals (populated) ───────── */
  const referralsRaw = (user.referrals ?? []) as ReferralLean[];
  const referrals = referralsRaw
    .map((r) => {
      const id =
        typeof r === "string" || typeof r === "number"
          ? String(r)
          : r._id?.toString?.();

      if (!id) return null;

      const firstName = r.firstName ?? null;
      const lastName = r.lastName ?? null;
      const email = r.email ?? null;
      const walletAddress = r.walletAddress ?? null;
      const profileImageUrl = r.profileImageUrl ?? null;
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
      const joinedAt = r.createdAt ? new Date(r.createdAt).toISOString() : null;

      return {
        id,
        firstName,
        lastName,
        fullName,
        email,
        walletAddress,
        profileImageUrl,
        joinedAt,
      };
    })
    .filter(Boolean);

  /* ───────── Balance snapshots ───────── */
  const balanceSnapshots = (user.balanceSnapshots ?? []).map((snap) => ({
    asOf: snap.asOf ? new Date(snap.asOf).toISOString() : null,
    totalBalanceUSDC: d128ToString(snap.totalBalanceUSDC),
    breakdown: snap.breakdown
      ? {
          savingsFlex: d128ToString(snap.breakdown.savingsFlex),
          savingsPlus: d128ToString(snap.breakdown.savingsPlus),
          invest: d128ToString(snap.breakdown.invest),
          amplify: d128ToString(snap.breakdown.amplify),
        }
      : null,
  }));

  return {
    id: user._id.toString(),
    privyId: user.privyId,
    email: user.email,
    walletAddress: user.walletAddress,

    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    fullName,

    country: user.country ?? null,
    displayCurrency: user.displayCurrency,
    profileImageUrl: user.profileImageUrl ?? null,

    // ✅ Savings: normalized + includes marginfiAccountPk + aggregates
    savingsAccounts: normalizeSavingsAccounts(user),

    financialKnowledgeLevel: user.financialKnowledgeLevel ?? null,
    riskLevel: user.riskLevel ?? null,

    referralCode: user.referralCode,
    isPro: user.isPro,
    isOnboarded: user.isOnboarded,
    lastLoginAt: user.lastLoginAt
      ? new Date(user.lastLoginAt).toISOString()
      : null,
    lastBalanceSyncAt: user.lastBalanceSyncAt
      ? new Date(user.lastBalanceSyncAt).toISOString()
      : null,

    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : null,

    contacts,
    invites,
    referrals,
    referralCount: referrals.length,

    balanceSnapshots,
  };
}

export async function GET() {
  try {
    await connect();

    const session = await getSessionFromCookies();
    if (!session?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await User.findOne({ privyId: session.sub })
      .populate(
        "referrals",
        "firstName lastName email walletAddress profileImageUrl createdAt"
      )
      .lean();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: serializeUser(user) }, { status: 200 });
  } catch (err) {
    console.error("Error in GET /api/auth/user:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
