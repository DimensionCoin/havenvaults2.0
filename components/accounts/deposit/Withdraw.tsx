// components/accounts/deposit/Withdraw.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalance } from "@/providers/BalanceProvider";

type WithdrawProps = {
  walletAddress: string; // sender's Solana address (must be Privy wallet)

  /**
   * Balance in the user's DISPLAY currency for this lane
   * (e.g. 1500 CAD, 800 EUR, etc).
   */
  balanceUsd: number;

  onSuccess?: () => void;
};

const sanitizeAmountInput = (s: string) => s.replace(/[^\d.]/g, "");

const Withdraw: React.FC<WithdrawProps> = ({
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

  // 🔹 our hook – builds + signs tx and calls /api/user/wallet/transfer
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
        amountUi: amountUsdc, // ✅ backend amount (USDC), user never sees it
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

      onSuccess?.();
    } catch (err) {
      console.error("[Withdraw] withdraw error:", err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    }
  };

  const sendDisabled =
    sending ||
    !walletAddress ||
    amountDisplay <= 0 ||
    !toAddress.trim() ||
    !hasEnoughBalance;

  return (
    <DrawerContent className="border-t border-zinc-800 bg-[#03180051] backdrop-blur-xl text-zinc-50">
      <DrawerHeader>
        <DrawerTitle className="text-base font-semibold">
          Withdraw funds
        </DrawerTitle>
        <DrawerDescription className="text-[10px] text-zinc-400">
          Withdraw from your Deposit Account to another wallet. Network fees are
          covered.
        </DrawerDescription>
      </DrawerHeader>

      <div className="px-4 pb-4">
        <Tabs
          value={tab}
          onValueChange={(val) => setTab(val as "crypto" | "offramp")}
        >
          <TabsList className="mb-3 grid w-full grid-cols-2 rounded-xl bg-black p-1">
            <TabsTrigger
              value="crypto"
              className="
                text-xs rounded-lg px-3 py-1.5 transition-colors
                bg-transparent text-zinc-400
                data-[state=active]:!bg-emerald-500
                data-[state=active]:!text-black
                data-[state=active]:shadow-[0_0_10px_rgba(52,211,153,0.7)]
              "
            >
              Crypto withdraw
            </TabsTrigger>

            <TabsTrigger
              value="offramp"
              className="
                text-xs rounded-lg px-3 py-1.5 transition-colors
                bg-transparent text-zinc-400
                data-[state=active]:!bg-emerald-500
                data-[state=active]:!text-black
                data-[state=active]:shadow-[0_0_10px_rgba(52,211,153,0.7)]
              "
            >
              Off-ramp
            </TabsTrigger>
          </TabsList>

          {/* Crypto withdraw tab */}
          <TabsContent value="crypto" className="mt-2 space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-zinc-300">
                Recipient wallet address
              </label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                placeholder="Enter Solana wallet address"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-zinc-300">
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
                  className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
                  disabled={laneBalanceDisplay <= feeDisplay}
                >
                  Max
                </button>
              </div>

              <input
                className="w-full rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
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

              <p className="text-[11px] text-zinc-500">
                Available: {formatDisplayAmount(laneBalanceDisplay)}
              </p>
            </div>

            {/* Breakdown (DISPLAY currency only) */}
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-400">You withdraw</span>
                <span className="text-zinc-100">
                  {formatDisplayAmount(amountDisplay)}
                </span>
              </div>

              <div className="mt-1 flex justify-between">
                <span className="text-zinc-400">Processing fee</span>
                <span className="text-zinc-100">
                  {formatDisplayAmount(amountDisplay > 0 ? feeDisplay : 0)}
                </span>
              </div>

              <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2">
                <span className="font-medium text-zinc-200">Total debited</span>
                <span className="font-semibold text-emerald-300">
                  {formatDisplayAmount(
                    amountDisplay > 0 ? totalDebitedDisplay : 0
                  )}
                </span>
              </div>
            </div>

            {!hasEnoughBalance && amountDisplay > 0 && (
              <p className="text-[11px] text-red-400">
                Insufficient balance for amount + fee.
              </p>
            )}

            {(errorMsg || transferError) && (
              <p className="text-[11px] text-red-400">
                {errorMsg || transferError}
              </p>
            )}

            {successMsg && (
              <p className="text-[11px] text-emerald-300">{successMsg}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <DrawerClose asChild>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200"
                  disabled={sending}
                >
                  Cancel
                </button>
              </DrawerClose>

              <button
                type="button"
                onClick={handleCryptoWithdraw}
                disabled={sendDisabled}
                className="rounded-lg bg-emerald-400 px-4 py-1.5 text-xs font-semibold text-black shadow-[0_0_14px_rgba(52,211,153,0.7)] transition hover:brightness-110 disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </TabsContent>

          {/* Off-ramp tab (placeholder for now) */}
          <TabsContent value="offramp" className="mt-4">
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-4 text-[11px] text-zinc-400">
              Off-ramp withdrawals are coming soon. You’ll be able to withdraw
              to your bank account directly from here.
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <DrawerFooter />
    </DrawerContent>
  );
};

export default Withdraw;
