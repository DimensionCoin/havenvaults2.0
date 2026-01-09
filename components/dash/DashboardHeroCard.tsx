"use client";

import React from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import HistoryChart from "@/components/dash/Chart";
import { LogoutButton } from "@/components/shared/LogoutButton";
import Link from "next/link";
import ThemeToggle from "../shared/ThemeToggle";
import NotificationButton from "../shared/NotificationButton";

const formatTotalUsd = (value?: number | null): string => {
  if (value === undefined || value === null || Number.isNaN(value))
    return "$0.00";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;

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
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card pt-4 md:px-6 md:pt-5 shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
        {/* subtle top fade */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-foreground/10 to-transparent dark:from-foreground/12" />

        {/* Top row */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 px-3">
            {/* Avatar */}
            <Link
              href="/profile"
              className="
                relative flex h-11 w-11 md:h-12 md:w-12 items-center justify-center overflow-hidden rounded-full
                border border-border bg-secondary
                shadow-[0_10px_22px_rgba(0,0,0,0.10)] dark:shadow-[0_14px_38px_rgba(0,0,0,0.55)]
                transition hover:border-primary/30
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              "
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
                <span className="text-[12px] font-semibold text-foreground/85">
                  {initials}
                </span>
              )}
            </Link>

            <div className="flex flex-col leading-tight">
              <span className="text-[12px] md:text-[13px] font-semibold text-muted-foreground uppercase tracking-[0.22em]">
                Welcome back
              </span>
              <span className="text-[22px] md:text-4xl font-semibold tracking-tight text-foreground">
                {displayName}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 px-1 sm:px-0">
            <div
              className="
      flex items-center gap-1.5
      rounded-full border border-border
      bg-card/80 backdrop-blur-xl
      shadow-fintech-sm
      p-1
    "
            >
              <ThemeToggle />

              <div className="max-w-0.5 h-6 w-px bg-border/70" />

              <div
                className="
        flex h-6 w-6 items-center justify-center
        rounded-full border border-border
        bg-card/80 shadow-fintech-sm
        text-foreground/80 hover:text-foreground
        hover:bg-secondary transition
      "
                aria-label="Notifications"
              >
                <NotificationButton />
              </div>

              <div className="mx-0.5 h-6 w-px bg-border/70" />

              <div
                className="
        flex h-6 w-6 items-center justify-center
        rounded-full border border-border
        bg-card/80 shadow-fintech-sm
        text-foreground/80 hover:text-foreground
        hover:bg-secondary transition
      "
                aria-label="Logout"
              >
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>
        {/* Balance + 24h change */}
        <div className="relative z-10 mt-3 flex items-end justify-between gap-3 px-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.20em] text-muted-foreground">
              Total account balance
            </p>
            <p className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
              {balanceLoading ? "…" : formattedTotal}
            </p>
          </div>

          <div
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] md:text-xs font-semibold border",
              isPositive
                ? "bg-primary/10 text-foreground border-primary/20"
                : "bg-destructive/10 text-foreground border-destructive/20",
            ].join(" ")}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-background/60 border border-border">
              {isPositive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
            </span>
            <span className="tabular-nums">
              ${Math.abs(changeUsd).toFixed(2)} (
              {Math.abs(changePct).toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Chart block */}
        <div className="relative z-10 mt-3 mb-0 md:mb-3 rounded-2xl border border-border bg-secondary px-2 pt-1.5 pb-1">
          <HistoryChart />
        </div>
      </div>
    </section>
  );
};

export default DashboardHeroCard;
