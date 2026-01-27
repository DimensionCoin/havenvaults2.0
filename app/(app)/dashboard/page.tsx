// app/dashboard/page.tsx
"use client";

import React, { useMemo } from "react";

import DashboardHeroCard from "@/components/dash/DashboardHeroCard";
import USDCAccountsCarousel from "@/components/dash/USDCAccountsCarousel";
import TransferDash from "@/components/dash/Transfer";
import InvestAccountCard from "@/components/accounts/InvestAccountCard";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

export default function DashboardPage() {
  const { user } = useUser();

  // ✅ Your canonical sender wallet address (per your schema/provider)
  const walletAddress = user?.walletAddress ?? "";

  // ✅ You said BalanceProvider already returns display currency values
  // Replace this field name if your BalanceProvider uses a different key.
  const balance = useBalance() as unknown as {
    depositAccountBalanceUsd?: number;
  };

  const balanceDisplay = useMemo(() => {
    const n = Number(balance.depositAccountBalanceUsd ?? 0);
    return Number.isFinite(n) ? n : 0;
  }, [balance.depositAccountBalanceUsd]);

  return (
    <main className="min-h-screen w-full px-3 pt-1 pb-24">
      <section className="mx-auto w-full space-y-4">
        <DashboardHeroCard />

        {/* Accounts */}
        <div className="px-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Accounts
          </p>
          <USDCAccountsCarousel />
        </div>

        <div className="px-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Transfer
          </p>

          <TransferDash
            walletAddress={walletAddress}
            balanceUsd={balanceDisplay}
            onSuccess={async () => {
              // optional: you can refresh balances here if you want
            }}
          />
        </div>

        {/* Assets */}
        <div className="px-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Portfolio
          </p>
          <InvestAccountCard />
        </div>
      </section>
    </main>
  );
}
