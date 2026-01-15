// components/accounts/deposit/Withdraw.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalance } from "@/providers/BalanceProvider";

type WithdrawProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  walletAddress: string; // sender's Solana address (must be Privy wallet)

  /**
   * Balance in the user's DISPLAY currency for this lane
   * (e.g. 1500 CAD, 800 EUR, etc).
   */
  balanceUsd: number;

  onSuccess?: () => void | Promise<void>;
};

const sanitizeAmountInput = (s: string) => s.replace(/[^\d.]/g, "");

export default function Withdraw({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}: WithdrawProps) {
  const [tab, setTab] = useState<"crypto" | "offramp">("crypto");
  const [toAddress, setToAddress] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Portal mount guard (prevents hydration mismatch)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // 🔹 wallet balances (has refresh())
  const { refresh: refreshBalances, displayCurrency, fxRate } = useBalance();

  const normalizedDisplayCurrency =
    displayCurrency === "USDC" || !displayCurrency
      ? "USD"
      : displayCurrency.toUpperCase();

  const effectiveFx = fxRate > 0 ? fxRate : 1;

  const formatDisplayAmount = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return "—";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: normalizedDisplayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${Number(n).toFixed(2)} ${normalizedDisplayCurrency}`;
    }
  };

  // user typed amount in DISPLAY currency
  const amountDisplay = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  // backend operates in USDC (≈ USD)
  // display = USD * fx  =>  USD = display / fx  => USDC ≈ USD
  const amountUsdc = useMemo(() => {
    if (amountDisplay <= 0) return 0;
    return amountDisplay / (effectiveFx || 1);
  }, [amountDisplay, effectiveFx]);

  // 🔹 hook – builds + signs tx and calls /api/user/wallet/transfer
  const {
    send,
    loading: sending,
    lastSig,
    error: transferError,
    feeUsdc,
  } = useSponsoredUsdcTransfer();

  // fee comes back in USDC; convert it for display
  const effectiveFeeUsdc = feeUsdc ?? 0;
  const feeDisplay = effectiveFeeUsdc * effectiveFx;

  const totalDebitedUsdc = amountUsdc + effectiveFeeUsdc;
  const totalDebitedDisplay = totalDebitedUsdc * effectiveFx;

  const laneBalanceDisplay = balanceUsd || 0;

  const hasEnoughBalance =
    amountDisplay > 0 && totalDebitedDisplay <= laneBalanceDisplay + 1e-9;

  const sendDisabled =
    sending ||
    !walletAddress ||
    amountDisplay <= 0 ||
    !toAddress.trim() ||
    !hasEnoughBalance;

  const handleCryptoWithdraw = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!walletAddress) {
      setErrorMsg("No wallet connected.");
      return;
    }

    if (!toAddress || toAddress.trim().length < 32) {
      setErrorMsg("Enter a valid wallet address.");
      return;
    }

    if (!amountDisplay || amountDisplay <= 0) {
      setErrorMsg("Enter a valid amount.");
      return;
    }

    if (!hasEnoughBalance) {
      setErrorMsg("Insufficient balance for amount + fee.");
      return;
    }

    try {
      const sig = await send({
        fromOwnerBase58: walletAddress,
        toOwnerBase58: toAddress.trim(),
        amountUi: amountUsdc, // ✅ backend amount (USDC)
      });

      const txId = sig || lastSig || "";
      const shortSig =
        typeof txId === "string" && txId.length > 12
          ? `${txId.slice(0, 6)}…${txId.slice(-6)}`
          : txId;

      setSuccessMsg(
        txId ? `Withdrawal sent. Tx: ${shortSig}` : "Withdrawal sent."
      );

      try {
        await new Promise((r) => setTimeout(r, 1200));
        await refreshBalances();
      } catch (e) {
        console.error("[Withdraw] balance refresh failed:", e);
      }

      setAmountInput("");
      setToAddress("");

      if (onSuccess) await onSuccess();
    } catch (err) {
      console.error("[Withdraw] withdraw error:", err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    }
  };

  /* ───────── Lock background scroll when open (Flex-style) ───────── */
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  /* ───────── Reset when closed ───────── */
  useEffect(() => {
    if (open) return;

    setTab("crypto");
    setToAddress("");
    setAmountInput("");
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [open]);

  const canClose = !sending;

  // ✅ Fix: close on pointer-down backdrop (prevents "mouseup on backdrop" after layout shift)
  const shouldCloseOnPointerUpRef = useRef(false);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onPointerDown={(e) => {
        if (!canClose) return;
        // Only consider closing if the pointer DOWN started on the backdrop
        shouldCloseOnPointerUpRef.current = e.target === e.currentTarget;
      }}
      onPointerUp={() => {
        if (!canClose) return;
        if (shouldCloseOnPointerUpRef.current) onOpenChange(false);
        shouldCloseOnPointerUpRef.current = false;
      }}
      onPointerCancel={() => {
        shouldCloseOnPointerUpRef.current = false;
      }}
    >
      <div
        className="w-full max-w-md haven-card p-5 shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground/90">
              Withdraw funds
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Withdraw from your Deposit Account to another wallet. Network fees
              are covered.
            </div>
          </div>

          <button
            type="button"
            onClick={() => (canClose ? onOpenChange(false) : undefined)}
            disabled={!canClose}
            className="haven-pill hover:bg-accent disabled:opacity-50"
            aria-label="Close"
            title={!canClose ? "Please wait…" : "Close"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div
          className="mt-4 max-h-[70vh] overflow-y-scroll no-scrollbar overscroll-contain"
          style={{ scrollbarGutter: "stable" } as React.CSSProperties}
        >
          <Tabs
            value={tab}
            onValueChange={(val) => setTab(val as "crypto" | "offramp")}
          >
            <TabsList className="mb-3 grid w-full grid-cols-2 rounded-2xl border border-border bg-background/40 p-1">
              <TabsTrigger
                value="crypto"
                className={[
                  "text-xs rounded-xl px-3 py-2 transition-colors",
                  "bg-transparent text-muted-foreground",
                  "data-[state=active]:!bg-primary data-[state=active]:!text-black",
                  "data-[state=active]:shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                ].join(" ")}
              >
                Crypto withdraw
              </TabsTrigger>

              <TabsTrigger
                value="offramp"
                className={[
                  "text-xs rounded-xl px-3 py-2 transition-colors",
                  "bg-transparent text-muted-foreground",
                  "data-[state=active]:!bg-primary data-[state=active]:!text-black",
                  "data-[state=active]:shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                ].join(" ")}
              >
                Off-ramp
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="crypto"
              forceMount
              className={[
                "mt-2 space-y-3",
                tab === "crypto" ? "block" : "hidden",
              ].join(" ")}
            >
              <div className="haven-card-soft px-3.5 py-3.5">
                <label className="text-[11px] text-muted-foreground">
                  Recipient wallet address
                </label>
                <input
                  className="haven-input mt-1 px-3 py-2 text-[12px]"
                  placeholder="Enter Solana wallet address"
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                  disabled={sending}
                />
              </div>

              <div className="haven-card-soft px-3.5 py-3.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground">
                    Amount ({normalizedDisplayCurrency})
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      const maxDisplay = Math.max(
                        0,
                        laneBalanceDisplay - feeDisplay
                      );
                      const safe =
                        maxDisplay > 0 ? Math.floor(maxDisplay * 100) / 100 : 0;
                      setAmountInput(safe > 0 ? String(safe) : "");
                    }}
                    className="haven-pill haven-pill-positive hover:bg-primary/15 disabled:opacity-40"
                    disabled={sending || laneBalanceDisplay <= feeDisplay}
                  >
                    Max
                  </button>
                </div>

                <input
                  className="mt-2 w-full bg-transparent text-left text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
                  placeholder="0.00"
                  inputMode="decimal"
                  value={amountInput}
                  disabled={sending}
                  onChange={(e) => {
                    const next = sanitizeAmountInput(e.target.value);
                    const [, dec = ""] = next.split(".");
                    if (dec.length > 2) return;
                    setAmountInput(next);
                  }}
                />

                <p className="mt-2 text-[10px] text-muted-foreground">
                  Available:{" "}
                  <span className="text-foreground/90">
                    {formatDisplayAmount(laneBalanceDisplay)}
                  </span>
                </p>
              </div>

              <div className="haven-card-soft px-3.5 py-3.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">You withdraw</span>
                  <span className="text-foreground/90">
                    {formatDisplayAmount(amountDisplay)}
                  </span>
                </div>

                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Processing fee</span>
                  <span className="text-foreground/90">
                    {formatDisplayAmount(amountDisplay > 0 ? feeDisplay : 0)}
                  </span>
                </div>

                <div className="mt-3 flex justify-between rounded-2xl border border-border bg-background/40 px-3 py-2">
                  <span className="text-muted-foreground">Total debited</span>
                  <span className="font-semibold text-primary">
                    {formatDisplayAmount(
                      amountDisplay > 0 ? totalDebitedDisplay : 0
                    )}
                  </span>
                </div>

                {!hasEnoughBalance && amountDisplay > 0 && (
                  <div className="mt-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    Insufficient balance for amount + fee.
                  </div>
                )}

                {(errorMsg || transferError) && (
                  <div className="mt-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    {errorMsg || transferError}
                  </div>
                )}

                {successMsg && (
                  <div className="mt-2 rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2 text-[11px] text-foreground">
                    {successMsg}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent
              value="offramp"
              forceMount
              className={["mt-2", tab === "offramp" ? "block" : "hidden"].join(
                " "
              )}
            >
              <div className="haven-card-soft px-3.5 py-3.5 text-[11px] text-muted-foreground">
                Off-ramp withdrawals are coming soon. You&apos;ll be able to
                withdraw to your bank account directly from here.
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="w-full rounded-2xl border border-border bg-background/50 py-3 text-[12px] font-semibold text-foreground/90 hover:bg-accent transition disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleCryptoWithdraw}
            disabled={tab !== "crypto" || sendDisabled}
            className={[
              "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border",
              tab === "crypto" && !sendDisabled
                ? "haven-btn-primary active:scale-[0.98] text-[#0b3204]"
                : "border-border bg-background/40 text-muted-foreground cursor-not-allowed",
            ].join(" ")}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
