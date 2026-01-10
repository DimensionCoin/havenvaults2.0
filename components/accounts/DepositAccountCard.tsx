"use client";

import React, { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

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

export default function DepositAccountCard({
  loading,
  walletAddress,
  balanceOverride,
  onDeposit,
  onTransfer,
  onWithdraw,
}: DepositAccountCardProps) {
  const router = useRouter();

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

  // --- ✅ MOBILE-CAROUSEL SAFE TAP NAV ---
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const moved = useRef(false);

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'button,a,input,select,textarea,[role="button"],[data-no-card-nav="true"]'
      )
    );
  };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only needed for touch/pen (carousel problem). Mouse clicks already work.
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    moved.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const dx = Math.abs(e.clientX - start.current.x);
    const dy = Math.abs(e.clientY - start.current.y);

    // threshold: if finger moves, it's a scroll gesture, not a tap
    if (dx > 8 || dy > 8) moved.current = true;
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      if (!start.current) return;

      const elapsed = Date.now() - start.current.t;
      const wasTap = !moved.current && elapsed < 600;

      start.current = null;

      if (!wasTap) return;
      if (isInteractiveTarget(e.target)) return;

      router.push("/deposit");
    },
    [router]
  );

  // (Optional) still allow desktop click
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(e.target)) return;
      router.push("/deposit");
    },
    [router]
  );

  return (
    <>
      <div
        role="link"
        tabIndex={0}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="haven-card flex h-full w-full cursor-pointer flex-col justify-between p-4 sm:p-6"
      >
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
            <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {effectiveLoading ? "…" : formatDisplay(effectiveBalance)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Available to transfer, invest, or withdraw
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setModalMode("deposit");
            }}
            className="haven-btn-primary flex-1 text-[#0b3204]"
          >
            Deposit
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTransferOpen(true);
            }}
            className="haven-btn-primary flex-1 text-[#0b3204]"
          >
            Transfer
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setModalMode("withdraw");
            }}
            className="haven-btn-primary flex-1 text-[#0b3204]"
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* Modals */}
      <Deposit
        open={modalMode === "deposit"}
        onOpenChange={(open) => !open && setModalMode(null)}
        walletAddress={walletAddress}
        balanceUsd={effectiveBalance}
        onSuccess={() => {
          onDeposit?.();
          setModalMode(null);
        }}
      />

      <Withdraw
        open={modalMode === "withdraw"}
        onOpenChange={(open) => !open && setModalMode(null)}
        walletAddress={walletAddress}
        balanceUsd={effectiveBalance}
        onSuccess={() => {
          onWithdraw?.();
          setModalMode(null);
        }}
      />

      <Transfer
        open={transferOpen}
        onOpenChange={(open) => {
          setTransferOpen(open);
          if (!open) onTransfer?.();
        }}
        walletAddress={walletAddress}
        balanceUsd={effectiveBalance}
        onSuccess={() => {
          onTransfer?.();
          setTransferOpen(false);
        }}
      />
    </>
  );
}
