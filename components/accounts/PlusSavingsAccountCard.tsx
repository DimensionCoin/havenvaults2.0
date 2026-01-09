// components/accounts/PlusSavingsAccountCard.tsx
"use client";

import React, { useMemo } from "react";

type SavingsAccountShape = {
  walletAddress: string;
  totalDeposited: number; // already in DISPLAY currency (unused for now)
};

type PlusSavingsAccountCardProps = {
  account?: SavingsAccountShape;
  loading: boolean;
  displayCurrency: string;

  // kept for compatibility
  onDeposit: () => void;
  onWithdraw: () => void;
  onOpenAccount: () => void;
};

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

function makeMoneyFormatter(currency: string) {
  const c = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

const PlusSavingsAccountCard: React.FC<PlusSavingsAccountCardProps> = ({
  account,
  loading,
  displayCurrency,
  onOpenAccount,
}) => {
  const formatMoney = useMemo(
    () => makeMoneyFormatter(displayCurrency),
    [displayCurrency]
  );

  // Mock for now
  const apyFinal = 7.0;
  const mockBalance = 0;

  // show something stable in the subtitle (same shape as Flex)
  const accountPkToShow = account?.walletAddress
    ? shortAddress(account.walletAddress)
    : "—";

  return (
    <div className="relative h-full w-full">
      {/* BASE CARD (matches Flex open state layout) */}
      <div className="haven-card flex h-full w-full flex-col justify-between p-4 sm:p-6">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="haven-kicker">Plus Account</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Account #{accountPkToShow}
              </p>
            </div>

            {/* APY pill (same shape) */}
            <span className="haven-pill">APY {apyFinal.toFixed(2)}%</span>
          </div>

          <div className="mt-4">
            <p className="text-3xl text-foreground/80 font-semibold tracking-tight sm:text-4xl">
              {loading ? "…" : formatMoney.format(mockBalance)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Lock funds for higher yield and faster growth
            </p>
          </div>
        </div>

        {/* Actions row (same spacing/height as Flex) */}
        <div className="mt-5 flex gap-2">
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
      </div>

      {/* OVERLAY (absolute → does NOT change size) */}
      <div className="absolute inset-0 z-10 rounded-3xl border border-border bg-background/75 backdrop-blur-[4px]">
        <div className="flex h-full w-full flex-col items-center justify-center px-5 text-center">
          <span className="haven-pill">APY {apyFinal.toFixed(2)}%</span>

          <div className="mt-3 text-xl font-semibold tracking-tight text-foreground">
            Coming soon
          </div>

          <div className="mt-1 text-[12px] text-muted-foreground max-w-[260px]">
            Plus is launching soon. Higher yield, more growth.
          </div>

          <button
            type="button"
            onClick={onOpenAccount}
            className="mt-4 haven-btn-primary max-w-[220px] text-[#0b3204]"
          >
            Coming soon!
          </button>

          
        </div>
      </div>
    </div>
  );
};

export default PlusSavingsAccountCard;
