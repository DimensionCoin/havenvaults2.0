// components/accounts/SpendingAccountCard.tsx
"use client";

import React from "react";

type Props = {
  loading?: boolean;
  className?: string;
  last4?: string;
  holderName?: string;
  expires?: string;
  balance?: number;
  onDeposit?: () => void;
  onWithdraw?: () => void;
};

const shortCard = (last4?: string) => (last4 ? `•••• ${last4}` : "•••• ••••");

const formatDisplay = (n?: number | null) => {
  const value =
    n === undefined || n === null || Number.isNaN(n) ? 0 : Number(n);
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const SpendingAccountCard: React.FC<Props> = ({
  loading,
  className,
  last4 = "9284",
  balance = 0,
}) => {
  return (
    <div
      className={["relative h-full min-h-[240px] w-full", className || ""].join(
        " "
      )}
    >
      {/* BASE CARD */}
      <div className="haven-card flex h-full w-full cursor-pointer flex-col justify-between p-4 sm:p-6 relative overflow-hidden">
        {/* Credit card style gradient overlay */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -inset-24 bg-[radial-gradient(circle_at_20%_10%,rgba(41,198,104,0.15),transparent_55%)] dark:bg-[radial-gradient(circle_at_20%_10%,rgba(63,243,135,0.12),transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_90%_90%,rgba(41,198,104,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_90%_90%,rgba(63,243,135,0.06),transparent_50%)]" />
        </div>

        {/* Content */}
        <div className="relative z-10">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="haven-kicker">Spending Account</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Card {shortCard(last4)}
              </p>
            </div>

            <span className="haven-pill">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Active
            </span>
          </div>

          {/* Balance display */}
          <div className="mt-4">
            <p className="text-3xl text-foreground font-semibold tracking-tight sm:text-4xl">
              {loading ? "…" : formatDisplay(balance)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Available to spend
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="relative z-10 mt-5 flex gap-2">
          <button
            type="button"
            className="haven-btn-primary flex-1 text-[#0b3204]"
            disabled
            aria-disabled="true"
          >
            Deposit
          </button>

          <button
            type="button"
            className="haven-btn-primary flex-1 text-[#0b3204]"
            disabled
            aria-disabled="true"
          >
            Withdraw
          </button>
        </div>

        {/* Subtle corner glow */}
        <div className="pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-primary/8 blur-2xl" />
      </div>

      {/* OVERLAY */}
      <div className="absolute inset-0 z-10 rounded-3xl border border-border bg-background/75 backdrop-blur-[2px]">
        <div className="flex h-full w-full flex-col items-center justify-center px-5 text-center">
          <span className="haven-pill">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Pre Paid Credit Card
          </span>

          <div className="mt-3 text-xl font-semibold tracking-tight text-foreground">
            Coming soon
          </div>

          <div className="mt-1 text-[12px] text-muted-foreground max-w-[260px]">
            Spend your money anywhere with a Haven pre paid credit card.
          </div>

          <button
            type="button"
            className="mt-4 haven-btn-primary max-w-[220px] text-[#0b3204]"
            disabled
          >
            Coming soon!
          </button>
        </div>
      </div>
    </div>
  );
};

export default SpendingAccountCard;
