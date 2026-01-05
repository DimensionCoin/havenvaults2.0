"use client";

import React, { useMemo } from "react";

type SavingsAccountShape = {
  walletAddress: string;
  totalDeposited: number; // already in DISPLAY currency
};

type PlusSavingsAccountCardProps = {
  account?: SavingsAccountShape;
  loading: boolean;

  // ✅ new
  displayCurrency: string; // e.g. "CAD", "EUR"

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

  // Avoid throw if someone has an invalid currency code in DB.
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
  onDeposit,
  onWithdraw,
  onOpenAccount,
}) => {
  const hasAccount = !!account;

  const formatMoney = useMemo(
    () => makeMoneyFormatter(displayCurrency),
    [displayCurrency]
  );

  const title = "Plus Savings Account";
  const openTitle = "Plus Account Coming Soon!";
  // ✅ no “USDC” in UI copy
  const description = "Lock funds for higher yield and faster growth.";

  if (!hasAccount) {
    return (
      <div className="flex h-full w-full flex-col justify-between rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 via-zinc-950 to-zinc-950 px-4 py-4 sm:px-6 sm:py-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
            {title}
          </p>

          <p className="mt-3 text-lg font-semibold text-zinc-50 sm:text-xl">
            {openTitle}
          </p>
          <p className="mt-1 text-xs text-zinc-400">{description}</p>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={onOpenAccount}
            className="w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] transition hover:brightness-105"
          >
            Coming Soon!
          </button>
        </div>
      </div>
    );
  }

  const deposited = account?.totalDeposited ?? 0;

  return (
    <div className="flex h-full w-full flex-col justify-between rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 via-zinc-950 to-zinc-950 px-4 py-4 sm:px-6 sm:py-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
          {title}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Dedicated savings wallet • {shortAddress(account.walletAddress)}
        </p>

        <div className="mt-4">
          <p className="text-xs font-medium text-zinc-400">Total Deposited</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {loading ? "…" : formatMoney.format(deposited)}
          </p>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onDeposit}
          className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] transition hover:brightness-105"
        >
          Deposit
        </button>
        <button
          type="button"
          onClick={onWithdraw}
          className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-900"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
};

export default PlusSavingsAccountCard;
