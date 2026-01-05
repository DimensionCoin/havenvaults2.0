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
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/10 pt-4 md:px-6 md:pt-5">
        {/* subtle top fade for a more premium look */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/25 to-transparent" />

        {/* Top row: avatar + greeting + actions */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 px-3">
            {/* Avatar → link to /profile */}
            <Link
              href="/profile"
              className="relative flex h-11 w-11 md:h-12 md:w-12 items-center justify-center overflow-hidden rounded-full
                         border border-white/20 bg-black/35
                         shadow-[0_14px_38px_rgba(0,0,0,0.55)]
                         transition hover:border-emerald-300/35
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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
                <span className="text-[12px] font-semibold text-white/90">
                  {initials}
                </span>
              )}
            </Link>

            <div className="flex flex-col leading-tight">
              <span className="text-[12px] md:text-[13px] font-semibold text-white/55 uppercase tracking-[0.22em]">
                Welcome back
              </span>
              <span className="text-[22px] md:text-4xl font-semibold tracking-tight text-white/92">
                {displayName}
              </span>
            </div>
          </div>

          {/* Right side: notif + logout */}
          <div className="relative z-10 flex items-center gap-2 px-3">
            <button
              type="button"
              className="h-9 w-9 rounded-full border border-white/10 bg-black/35
                         shadow-[0_14px_34px_rgba(0,0,0,0.5)]
                         text-white/70 hover:text-white/90 hover:border-white/20 transition
                         flex items-center justify-center"
              aria-label="Notifications"
            >
              <IoNotifications className="h-4 w-4" />
            </button>

            <div
              className="h-9 w-9 rounded-full border border-white/10 bg-black/35
                         shadow-[0_14px_34px_rgba(0,0,0,0.5)]
                         text-white/70 hover:text-white/90 hover:border-white/20 transition
                         flex items-center justify-center"
              aria-label="Logout"
            >
              <LogoutButton />
            </div>
          </div>
        </div>

        {/* Balance + 24h change */}
        <div className="relative z-10 mt-3 flex items-end justify-between gap-3 px-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.20em] text-white/55">
              Total account balance
            </p>
            <p className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight text-white/92">
              {balanceLoading ? "…" : formattedTotal}
            </p>
          </div>

          <div
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] md:text-xs font-semibold border",
              isPositive
                ? "bg-emerald-500/15 text-emerald-100 border-emerald-300/20"
                : "bg-rose-500/15 text-rose-100 border-rose-300/20",
            ].join(" ")}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/45">
              {isPositive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
            </span>
            <span>
              ${Math.abs(changeUsd).toFixed(2)} (
              {Math.abs(changePct).toFixed(2)}
              %)
            </span>
          </div>
        </div>

        {/* Chart block */}
        <div className="relative z-10 mt-3 mb-0 md:mb-3 rounded-2xl border border-white/10 bg-black/30 px-2 pt-1.5 pb-1">
          <HistoryChart />
        </div>
      </div>
    </section>
  );
};

export default DashboardHeroCard;
