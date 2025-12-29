// components/accounts/deposit/Withdraw.tsx
"use client";

import React, { useState } from "react";
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
  balanceUsd: number; // ~USDC balance in USD
  /**
   * Optional callback for parent after a successful withdraw
   * (e.g. to refresh other state).
   */
  onSuccess?: () => void;
};

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
  const { refresh: refreshBalances } = useBalance();

  // 🔹 our hook – builds + signs tx and calls /api/user/wallet/transfer
  const {
    send,
    loading: sending,
    lastSig,
    error: transferError,
    feeUsdc,
  } = useSponsoredUsdcTransfer();

  const parsedAmount = (() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const effectiveFee = feeUsdc ?? 0;
  const totalDebited = parsedAmount + effectiveFee;

  const handleCryptoWithdraw = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!walletAddress) {
      setErrorMsg("No wallet connected.");
      return;
    }

    // Basic validation
    if (!toAddress || toAddress.trim().length < 32) {
      setErrorMsg("Enter a valid wallet address.");
      return;
    }

    if (!parsedAmount || parsedAmount <= 0) {
      setErrorMsg("Enter a valid USDC amount.");
      return;
    }

    // Rough check vs. available balance (USDC ~ USD)
    if (totalDebited > balanceUsd) {
      setErrorMsg("Insufficient balance for amount + fee.");
      return;
    }

    try {
      // 🧠 Button press = consent → Privy signs → backend co-signs + sends
      const sig = await send({
        fromOwnerBase58: walletAddress,
        toOwnerBase58: toAddress.trim(),
        amountUi: parsedAmount,
      });

      const txId = sig || lastSig || "";
      const shortSig =
        typeof txId === "string" && txId.length > 12
          ? `${txId.slice(0, 6)}…${txId.slice(-6)}`
          : txId;

      setSuccessMsg(
        txId ? `Withdrawal sent on-chain. Tx: ${shortSig}` : "Withdrawal sent."
      );

      // 🔄 small delay so RPC indexes, then refresh balances
      try {
        await new Promise((r) => setTimeout(r, 1200));
        await refreshBalances();
      } catch (e) {
        console.error("[Withdraw] balance refresh failed:", e);
      }

      // Clear form
      setAmountInput("");
      setToAddress("");

      // Let parent also react if it wants (optional)
      if (onSuccess) onSuccess();
      // If you want to auto-close the drawer, you can do it via parent
      // by controlling Drawer open state.
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
    !parsedAmount ||
    parsedAmount <= 0 ||
    !toAddress.trim();

  return (
    <DrawerContent className="border-t border-zinc-800 bg-[#03180051] backdrop-blur-xl text-zinc-50">
      <DrawerHeader>
        <DrawerTitle className="text-base font-semibold">
          Withdraw funds
        </DrawerTitle>
        <DrawerDescription className="text-[10px] text-zinc-400">
          Withdraw from your Deposit Account to another crypto wallet.
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
              <label className="text-[11px] font-medium text-zinc-300">
                Amount (USDC)
              </label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-50 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                placeholder="0.00"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
              <p className="text-[11px] text-zinc-500">
                Available: ~{balanceUsd.toFixed(2)} USDC
              </p>
            </div>

            {/* Breakdown */}
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-400">You send</span>
                <span className="text-zinc-100">
                  {parsedAmount.toFixed(2)} USDC
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-zinc-400">Processing fee</span>
                <span className="text-zinc-100">
                  {effectiveFee.toFixed(2)} USDC
                </span>
              </div>
              <div className="mt-2 border-t border-zinc-800 pt-2 flex justify-between">
                <span className="font-medium text-zinc-200">Total debited</span>
                <span className="font-semibold text-emerald-300">
                  {totalDebited.toFixed(2)} USDC
                </span>
              </div>
            </div>

            {/* Errors from local validation OR hook */}
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
                {sending ? "Sending…" : "Send USDC"}
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
