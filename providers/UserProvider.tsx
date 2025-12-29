// providers/UserProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Loading from "@/components/shared/Loading";

// This should match (or be a subset of) what /api/auth/user returns
export type AppUser = {
  id: string;
  privyId: string;
  email: string;
  walletAddress: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  country: string | null;
  displayCurrency: string;
  profileImageUrl: string | null;

  // ✅ Savings (NEW SHAPE from updated /api/auth/user)
  savingsAccounts: Array<{
    type: "flex" | "plus";

    // authority wallet (owner)
    walletAddress: string;

    // Marginfi account you query for balance / tells you if "opened"
    marginfiAccountPk: string | null;

    // aggregates (Decimal128 -> string, always present as "0" if empty)
    principalDeposited: string;
    principalWithdrawn: string;
    interestWithdrawn: string;
    feesPaidUsdc: string;

    // optional cached reconciliation fields
    lastOnChainBalance: string | null;
    lastSyncedAt: string | null;

    createdAt: string | null;
    updatedAt: string | null;
  }>;

  // Risk / knowledge
  financialKnowledgeLevel:
    | "none"
    | "beginner"
    | "intermediate"
    | "advanced"
    | null;
  riskLevel: "low" | "medium" | "high" | null;

  // Plan / flags
  referralCode: string;
  isPro: boolean;
  isOnboarded: boolean;
  lastLoginAt: string | null;
  lastBalanceSyncAt: string | null;

  // Membership meta
  createdAt: string | null;
  updatedAt: string | null;

  // Contacts (people they’ve added / invited)
  contacts: Array<{
    name: string | null;
    email: string | null;
    walletAddress: string | null;
    status: "invited" | "active" | "external";
    invitedAt: string | null;
    joinedAt: string | null;
  }>;

  // Outbound invites (email-based)
  invites: Array<{
    email: string;
    sentAt: string | null;
    status: "sent" | "clicked" | "signed_up";
    invitedUserId: string | null;
  }>;

  // Referrals (actual users who signed up with this user’s code)
  referrals: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;
    email: string | null;
    walletAddress: string | null;
    profileImageUrl: string | null;
    joinedAt: string | null;
  }>;

  referralCount: number;

  // Historic portfolio snapshots (for charts, streaks, etc.)
  balanceSnapshots: Array<{
    asOf: string | null;
    totalBalanceUSDC: string | null;
    breakdown: {
      savingsFlex: string | null;
      savingsPlus: string | null;
      invest: string | null;
      amplify: string | null;
    } | null;
  }>;
};

type UserContextValue = {
  user: AppUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;

  // ✅ convenience helpers (optional, non-breaking)
  savingsFlex: AppUser["savingsAccounts"][number] | null;
  savingsPlus: AppUser["savingsAccounts"][number] | null;
  hasFlexAccount: boolean;
  hasPlusAccount: boolean;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

// Truly public routes (no auth required)
const PUBLIC_ROUTES = ["/", "/sign-in"];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return true;
  return PUBLIC_ROUTES.includes(pathname);
}

function getSavingsByType(
  user: AppUser | null,
  type: "flex" | "plus"
): AppUser["savingsAccounts"][number] | null {
  if (!user?.savingsAccounts?.length) return null;
  return user.savingsAccounts.find((a) => a.type === type) ?? null;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/auth/user", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      // Not logged in OR no DB user
      if (res.status === 401 || res.status === 404) {
        setUser(null);

        // If they’re trying to hit a protected route (anything not in PUBLIC_ROUTES),
        // send them to /sign-in
        if (!isPublicRoute(pathname)) {
          router.replace("/sign-in");
        }

        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        console.error("Failed to fetch user:", data);
        setError((data as any)?.error || "Failed to fetch user");
        return;
      }

      const data = (await res.json()) as { user: AppUser };
      setUser(data.user);
    } catch (err) {
      console.error("Error fetching user:", err);
      setError("Failed to fetch user");
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  // Fetch user whenever the provider mounts or the route changes
  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Redirect logic for onboard / dashboard / auth pages
  useEffect(() => {
    if (loading) return; // wait until we know if there's a user or not

    // No user: if we're on a public route ("/" or "/sign-in"), do nothing.
    // If they tried to go to a protected route, fetchUser already redirected them.
    if (!user) return;

    // Logged in but NOT onboarded → force them to /onboard
    if (!user.isOnboarded && pathname !== "/onboard") {
      router.replace("/onboard");
      return;
    }

    // Logged in + onboarded:
    // If they hit "/", "/sign-in", or "/onboard" (auth land),
    // throw them into the app.
    if (
      user.isOnboarded &&
      (pathname === "/" || pathname === "/sign-in" || pathname === "/onboard")
    ) {
      router.replace("/dashboard");
      return;
    }
  }, [user, loading, pathname, router]);

  const savingsFlex = getSavingsByType(user, "flex");
  const savingsPlus = getSavingsByType(user, "plus");

  const value: UserContextValue = {
    user,
    loading,
    error,
    refresh: fetchUser,

    // ✅ optional helpers (safe additions)
    savingsFlex,
    savingsPlus,
    hasFlexAccount: !!savingsFlex?.marginfiAccountPk,
    hasPlusAccount: !!savingsPlus?.marginfiAccountPk,
  };

  return (
    <UserContext.Provider value={value}>
      {loading ? <Loading /> : children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return ctx;
}
