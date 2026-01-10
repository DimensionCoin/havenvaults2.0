"use client";

import React, { useState } from "react";
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
  // ✅ Deposit is now a Dialog, so we don't need Drawer state anymore
  const [modalMode, setModalMode] = useState<DrawerMode>(null);
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

  return (
    <>
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
          {/* Deposit -> Dialog */}
          <button
            type="button"
            onClick={() => setModalMode("deposit")}
            className="haven-btn-primary flex-1 text-[#0b3204]"
          >
            Deposit
          </button>

          {/* Transfer -> Dialog */}
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            className="haven-btn-primary flex-1 text-[#0b3204]"
          >
            Transfer
          </button>

          {/* Withdraw -> Dialog */}
          <button
            type="button"
            onClick={() => setModalMode("withdraw")}
            className="haven-btn-primary flex-1 text-[#0b3204]"
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* Deposit modal */}
      <Deposit
        open={modalMode === "deposit"}
        onOpenChange={(open) => {
          if (!open) setModalMode(null);
        }}
        walletAddress={walletAddress}
        balanceUsd={effectiveBalance}
        onSuccess={async () => {
          onDeposit?.();
          setModalMode(null);
        }}
      />

      {/* Withdraw modal */}
      <Withdraw
        open={modalMode === "withdraw"}
        onOpenChange={(open) => {
          if (!open) setModalMode(null);
        }}
        walletAddress={walletAddress}
        balanceUsd={effectiveBalance}
        onSuccess={async () => {
          onWithdraw?.();
          setModalMode(null);
        }}
      />

      {/* Transfer modal */}
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
