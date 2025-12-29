// components/accounts/DepositAccountCard.tsx
"use client";

import React, { useState } from "react";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import Deposit from "@/components/accounts/deposit/Deposit";
import Transfer from "@/components/accounts/deposit/Transfer";
import Withdraw from "@/components/accounts/deposit/Withdraw";
import { useBalance } from "@/providers/BalanceProvider";

type DrawerMode = "deposit" | "transfer" | "withdraw" | null;

type DepositAccountCardProps = {
  /**
   * Optional explicit loading flag (falls back to BalanceProvider.loading)
   */
  loading?: boolean;
  walletAddress: string; // sender's Solana address

  /**
   * Optional override for the balance.
   * If not provided, we use usdcUsd from BalanceProvider.
   * NOTE: this value should already be in the user's display currency.
   */
  balanceOverride?: number;

  onDeposit?: () => void;
  onTransfer?: () => void;
  onWithdraw?: () => void;
};

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const DepositAccountCard: React.FC<DepositAccountCardProps> = ({
  loading,
  walletAddress,
  balanceOverride,
  onDeposit,
  onTransfer,
  onWithdraw,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  // 🔹 Pull USDC + loading from BalanceProvider
  const {
    usdcUsd, // already in user's display currency
    loading: balanceLoading,
  } = useBalance();

  const effectiveLoading = loading ?? balanceLoading;
  const effectiveBalance = balanceOverride ?? usdcUsd;

  // 🔹 Always show as $<amount> with 2 decimals, no currency code prefix
  const formatDisplay = (n?: number | null) => {
    const value =
      n === undefined || n === null || Number.isNaN(n) ? 0 : Number(n);

    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const openDrawer = (mode: Exclude<DrawerMode, null>) => {
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

  const handleDrawerChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) {
      setDrawerMode(null);
    }
  };

  return (
    <Drawer open={drawerOpen} onOpenChange={handleDrawerChange}>
      {/* Card */}
      <div className="flex h-full w-full flex-col justify-between rounded-2xl border border-zinc-800 bg-white/10 px-4 py-4 sm:px-6 sm:py-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-200/80">
            Deposit Account
          </p>

          <div className="mt-4">
            <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-50 sm:text-4xl">
              {effectiveLoading ? "…" : formatDisplay(effectiveBalance)}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Account #{shortAddress(walletAddress)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          {/* Deposit → opens Deposit drawer */}
          <DrawerTrigger asChild>
            <button
              type="button"
              onClick={() => openDrawer("deposit")}
              className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] transition hover:brightness-105"
            >
              Deposit
            </button>
          </DrawerTrigger>

          {/* Transfer → opens Transfer drawer */}
          <DrawerTrigger asChild>
            <button
              type="button"
              onClick={() => openDrawer("transfer")}
              className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-900/70"
            >
              Transfer
            </button>
          </DrawerTrigger>

          {/* Withdraw → opens Withdraw drawer */}
          <DrawerTrigger asChild>
            <button
              type="button"
              onClick={() => openDrawer("withdraw")}
              className="flex-1 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-900"
            >
              Withdraw
            </button>
          </DrawerTrigger>
        </div>
      </div>

      {/* Drawer body — we only mount ONE flow at a time */}
      {drawerMode === "deposit" && (
        <Deposit
          walletAddress={walletAddress}
          balanceUsd={effectiveBalance}
          onSuccess={async () => {
            onDeposit?.();
            setDrawerOpen(false);
          }}
        />
      )}

      {drawerMode === "transfer" && (
        <Transfer
          walletAddress={walletAddress}
          balanceUsd={effectiveBalance}
          onSuccess={async () => {
            onTransfer?.();
            setDrawerOpen(false);
          }}
        />
      )}

      {drawerMode === "withdraw" && (
        <Withdraw
          walletAddress={walletAddress}
          balanceUsd={effectiveBalance}
          onSuccess={async () => {
            onWithdraw?.();
            setDrawerOpen(false);
          }}
        />
      )}
    </Drawer>
  );
};

export default DepositAccountCard;
