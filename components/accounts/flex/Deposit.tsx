"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useUser } from "@/providers/UserProvider";
import { useSavingsDeposit } from "@/hooks/useSavingsDeposit";

type DepositFlexProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasAccount: boolean;
};

function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function clampInput(raw: string) {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  const head = cleaned.slice(0, dot);
  const tail = cleaned.slice(dot + 1).replace(/\./g, "");
  return `${head}.${tail.slice(0, 2)}`;
}

function parseAmount(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const DepositFlex: React.FC<DepositFlexProps> = ({
  open,
  onOpenChange,
  hasAccount,
}) => {
  const { user, refresh } = useUser();
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();
  const { deposit, loading, error } = useSavingsDeposit();

  const [amountRaw, setAmountRaw] = useState("");
  const amount = useMemo(() => parseAmount(amountRaw), [amountRaw]);

  // portal mount guard
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) setAmountRaw("");
  }, [open]);

  // lock background scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  const close = () => onOpenChange(false);

  const onSubmit = async () => {
    if (!user?.walletAddress) return;
    const n = amount;
    if (!n) return;

    await deposit({ amountDisplay: n, owner58: user.walletAddress });
    await refresh();
    close();
  };

  if (!open || !mounted) return null;

  const title = hasAccount ? "Deposit" : "Open account";
  const subtitle = hasAccount
    ? "Add funds to your savings."
    : "Choose an amount to start your savings account.";

  return createPortal(
    <div
      className="
        fixed inset-0 z-[9999]
        flex items-center justify-center
        p-4 sm:p-6
        h-[100dvh] w-[100dvw]
      "
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/90"
      />

      {/* modal */}
      <div
        role="dialog"
        aria-modal="true"
        className="
          relative w-full max-w-md
          rounded-2xl border border-zinc-800 bg-zinc-950
          p-4 shadow-2xl
          max-h-[calc(100dvh-2rem)]
          overflow-y-auto
        "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
              Flex
            </p>
            <p className="mt-2 text-lg font-semibold text-zinc-50">{title}</p>
            <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
          </div>

          <button
            type="button"
            onClick={close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:bg-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-xs font-medium text-zinc-300">
            Amount ({displayCurrency})
          </label>
          <input
            value={amountRaw}
            onChange={(e) => setAmountRaw(clampInput(e.target.value))}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <p className="text-[11px] text-zinc-500">
            You’ll see the final amount in {displayCurrency}.
          </p>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-red-900/40 bg-red-950/30 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900"
            disabled={loading}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || !amount}
            className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] transition hover:brightness-105 disabled:opacity-60 disabled:shadow-none"
          >
            {loading
              ? "Processing…"
              : hasAccount
              ? "Deposit"
              : "Open & deposit"}
          </button>
        </div>

        <div className="mt-3 text-[11px] text-zinc-500">
          {amount
            ? `Amount: ${formatMoney(amount, displayCurrency)}`
            : "Enter an amount to continue."}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DepositFlex;
