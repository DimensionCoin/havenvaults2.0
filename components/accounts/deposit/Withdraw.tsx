// components/accounts/deposit/Withdraw.tsx
"use client";

import React, { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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

const Withdraw: React.FC<WithdrawProps> = ({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}) => {
  const [tab, setTab] = useState<"crypto" | "offramp">("crypto");
  const [toAddress, setToAddress] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          "p-0 overflow-hidden flex flex-col",
          "border border-border bg-card text-card-foreground text-foreground shadow-fintech-lg",
          "sm:w-[min(92vw,520px)] sm:max-w-[520px]",
          "sm:max-h-[90vh] sm:rounded-[28px]",
          "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
          "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
          "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",
        ].join(" ")}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Scrollable body */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar overscroll-contain px-3 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] sm:px-5 sm:pb-5 sm:pt-5">
            <DialogHeader className="pb-3">
              <DialogTitle className="text-base font-semibold">
                Withdraw funds
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[11px] text-muted-foreground">
                Withdraw from your Deposit Account to another wallet. Network
                fees are covered.
              </DialogDescription>
            </DialogHeader>

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

              {/* Crypto withdraw tab */}
              <TabsContent value="crypto" className="mt-2 space-y-3">
                <div className="haven-card-soft px-3.5 py-3.5">
                  <label className="text-[11px] text-muted-foreground">
                    Recipient wallet address
                  </label>
                  <input
                    className="haven-input mt-1 px-3 py-2 text-[12px]"
                    placeholder="Enter Solana wallet address"
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
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
                          maxDisplay > 0
                            ? Math.floor(maxDisplay * 100) / 100
                            : 0;
                        setAmountInput(safe > 0 ? String(safe) : "");
                      }}
                      className="haven-pill haven-pill-positive hover:bg-primary/15 disabled:opacity-40"
                      disabled={laneBalanceDisplay <= feeDisplay}
                    >
                      Max
                    </button>
                  </div>

                  <input
                    className="mt-2 w-full bg-transparent text-left text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
                    placeholder="0.00"
                    inputMode="decimal"
                    value={amountInput}
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

                {/* Breakdown (DISPLAY currency only) */}
                <div className="haven-card-soft px-3.5 py-3.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You withdraw</span>
                    <span className="text-foreground/90">
                      {formatDisplayAmount(amountDisplay)}
                    </span>
                  </div>

                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">
                      Processing fee
                    </span>
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

              {/* Off-ramp tab (placeholder for now) */}
              <TabsContent value="offramp" className="mt-2">
                <div className="haven-card-soft px-3.5 py-3.5 text-[11px] text-muted-foreground">
                  Off-ramp withdrawals are coming soon. You’ll be able to
                  withdraw to your bank account directly from here.
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Pinned footer */}
          <div className="shrink-0 border-t border-border bg-card/95 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+14px)] sm:px-5 sm:pb-5">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={sending}
                className="w-full rounded-2xl border border-border bg-background/40 py-3 text-[12px] font-semibold text-foreground/90 hover:bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleCryptoWithdraw}
                disabled={sendDisabled}
                className="haven-btn-primary w-full text-black"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Withdraw;
