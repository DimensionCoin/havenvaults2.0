"use client";

import React, { useState } from "react";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import Deposit from "@/components/accounts/deposit/Deposit";
import Transfer from "@/components/accounts/deposit/Transfer";
import Withdraw from "@/components/accounts/deposit/Withdraw";
import { useBalance } from "@/providers/BalanceProvider";

type DrawerMode = "deposit" | "withdraw" | null;

type DepositAccountCardProps = {
  loading?: boolean;
  walletAddress: string;
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
  const [transferOpen, setTransferOpen] = useState(false);

  const { usdcUsd, loading: balanceLoading } = useBalance();

  const effectiveLoading = loading ?? balanceLoading;
  const effectiveBalance = balanceOverride ?? usdcUsd;

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
    if (!open) setDrawerMode(null);
  };

  return (
    <>
      <Drawer open={drawerOpen} onOpenChange={handleDrawerChange}>
        {/* Card (Haven theme) */}
        <div className="haven-card flex h-full w-full flex-col justify-between p-4 sm:p-6">
          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="haven-kicker">Deposit Account</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Account #{shortAddress(walletAddress)}
                </p>
              </div>

              {/* Small status pill (optional but matches ref image) */}
              <span className="haven-pill">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Active
              </span>
            </div>

            {/* Balance */}
            <div className="mt-4">
              <p className="text-3xl text-foreground font-semibold tracking-tight sm:text-4xl">
                {effectiveLoading ? "…" : formatDisplay(effectiveBalance)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Available to transfer, invest, or withdraw
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex gap-2">
            {/* Deposit -> Drawer */}
            <DrawerTrigger asChild>
              <button
                type="button"
                onClick={() => openDrawer("deposit")}
                className="haven-btn-primary flex-1 text-[#0b3204]"
              >
                Deposit
              </button>
            </DrawerTrigger>

            {/* Transfer -> Dialog */}
            <button
              type="button"
              onClick={() => setTransferOpen(true)}
              className="haven-btn-primary flex-1 text-[#0b3204]"
            >
              Transfer
            </button>

            {/* Withdraw -> Drawer (outline, a bit “safer”) */}
            <DrawerTrigger asChild>
              <button
                type="button"
                onClick={() => openDrawer("withdraw")}
                className="haven-btn-primary flex-1 text-[#0b3204]"
              >
                Withdraw
              </button>
            </DrawerTrigger>
          </div>
        </div>

        {/* Drawer body */}
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

      {/* Transfer modal outside Drawer */}
      <Transfer
        open={transferOpen}
        onOpenChange={(open) => {
          setTransferOpen(open);
          if (!open) onTransfer?.();
        }}
        walletAddress={walletAddress}
        balanceUsd={effectiveBalance}
        onSuccess={async () => {
          onTransfer?.();
          setTransferOpen(false);
        }}
      />
    </>
  );
};

export default DepositAccountCard;
