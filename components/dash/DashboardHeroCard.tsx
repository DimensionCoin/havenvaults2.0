// components/dash/DashboardHeroCard.tsx
"use client";

import React from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import HistoryChart from "@/components/dash/Chart";
import { LogoutButton } from "@/components/shared/LogoutButton";
import Link from "next/link";
import { IoNotifications } from "react-icons/io5";

const formatTotalUsd = (value?: number | null): string => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "$0.00";
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `$${millions.toFixed(1)}M`;
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const DashboardHeroCard: React.FC = () => {
  const { user } = useUser();
  const {
    totalUsd,
    totalChange24hUsd,
    totalChange24hPct,
    loading: balanceLoading,
  } = useBalance();

  if (!user) return null;

  const avatarUrl = user.profileImageUrl || null;
  const displayName = user.firstName || "Investor";

  const initials =
    !avatarUrl && user
      ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()
      : "HV";

  const formattedTotal = formatTotalUsd(totalUsd);

  const changeUsd =
    typeof totalChange24hUsd === "number" && !Number.isNaN(totalChange24hUsd)
      ? totalChange24hUsd
      : 0;

  const changePct =
    typeof totalChange24hPct === "number" && !Number.isNaN(totalChange24hPct)
      ? totalChange24hPct * 100
      : 0;

  const isPositive = changeUsd >= 0;

  return (
    <section className="w-full">
      <div className="relative overflow-hidden rounded-3xl bg-white/10 pt-4 md:px-6 md:pt-5">
        {/* Top row: avatar + greeting + actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 px-3">
            {/* Avatar → link to /profile */}
            <Link
              href="/profile"
              className="relative flex h-14 w-14 md:h-18 md:w-18 items-center justify-center overflow-hidden rounded-full border border-white/40 bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 hover:border-primary/70 transition"
              aria-label="Go to profile"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-sm font-semibold text-white">
                  {initials}
                </span>
              )}
            </Link>

            <div className="flex flex-col">
              <span className="text-[14px] md:text-md font-medium text-white/70 uppercase tracking-[0.2em]">
                Welcome back
              </span>
              <span className="text-2xl md:text-4xl font-semibold text-white">
                {displayName}
              </span>
            </div>
          </div>

          {/* Right side: notif + logout */}
          <div className="flex items-center gap-2 px-3">
            <div className="h-8 w-8 rounded-full bg-black/45 flex items-center justify-center">
              <IoNotifications className="w-4 h-4" />
            </div>

            <div className="h-8 w-8 rounded-full bg-black/25 flex items-center justify-center">
              <LogoutButton />
            </div>
          </div>
        </div>

        {/* Balance + 24h change */}
        <div className="mt-4 flex items-end justify-between gap-3 px-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/70">
              Portfolio balance
            </p>
            <p className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight text-white">
              {balanceLoading ? "…" : formattedTotal}
            </p>
          </div>

          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] md:text-xs font-medium ${
              isPositive
                ? "bg-emerald-500/20 text-emerald-100"
                : "bg-red-500/25 text-red-100"
            }`}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/40 text-[9px]">
              {isPositive ? (
                <ArrowUpRight className="h-2 w-2" />
              ) : (
                <ArrowDownRight className="h-2 w-2" />
              )}
            </span>
            <span>
              ${Math.abs(changeUsd).toFixed(2)} (
              {Math.abs(changePct).toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Chart block */}
        <div className="mt-4 rounded-2xl bg-black/25 px-2 pt-1.5 pb-1">
          <HistoryChart />
        </div>
      </div>
    </section>
  );
};

export default DashboardHeroCard;
