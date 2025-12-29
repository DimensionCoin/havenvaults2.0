// app/dashboard/page.tsx
"use client";

import InvestAccountCard from "@/components/accounts/InvestAccountCard";
import DashboardHeroCard from "@/components/dash/DashboardHeroCard";
import USDCAccountsCarousel from "@/components/dash/USDCAccountsCarousel";

export default function DashboardPage() {
  return (
    <main className="min-h-screen w-full px-3 pt-1 ">
      <section className="mx-auto w-full space-y-4">
        {/* Big hero/balance/chart card */}
        <DashboardHeroCard />

        {/* USDC accounts strip */}
        <p>Accounts</p>
        <USDCAccountsCarousel />

        {/* Token holdings */}
        <p>Assets</p>
        <div className="">
          <InvestAccountCard />
        </div>
      </section>
    </main>
  );
}
