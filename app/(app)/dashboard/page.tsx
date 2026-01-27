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
  const balance = useBalance();

  // ✅ Canonical sender wallet address
  const walletAddress = user?.walletAddress ?? "";

  /**
   * ✅ Deposit wallet balance for TransferDash
   * BalanceProvider already converts to the user's display currency.
   * `usdcUsd` is the USDC value in display currency (USD/CAD/etc).
   */
  const depositBalanceDisplay = useMemo(() => {
    const n = Number(balance.usdcUsd ?? 0);
    return Number.isFinite(n) ? n : 0;
  }, [balance.usdcUsd]);

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

        {/* Transfer */}
        <div className="px-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Transfer
          </p>

          <TransferDash
            walletAddress={walletAddress}
            balanceUsd={depositBalanceDisplay}
            onSuccess={async () => {
              // Optional: refresh to make UI feel instant after sending
              // (TransferDash already refreshes internally, so this is just extra)
              await balance.refresh().catch(() => null);
            }}
          />
        </div>

        {/* Portfolio */}
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
