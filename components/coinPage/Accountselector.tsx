"use client";

import React from "react";
import { Landmark, TrendingUp } from "lucide-react";
import type { PaymentAccount, ReceiveAccount } from "./types";
import { formatMoneyNoCode } from "./utils";

type PaymentAccountSelectorProps = {
  paymentAccount: PaymentAccount;
  onPaymentAccountChange: (account: PaymentAccount) => void;
  cashBalanceDisplay: number;
  cashBalanceInternal: number;
  plusBalanceDisplay: number;
  plusBalanceInternal: number;
  plusReady: boolean;
  swapBusy: boolean;
};

export function PaymentAccountSelector({
  paymentAccount,
  onPaymentAccountChange,
  cashBalanceDisplay,
  cashBalanceInternal,
  plusBalanceDisplay,
  plusBalanceInternal,
  plusReady,
  swapBusy,
}: PaymentAccountSelectorProps) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-[11px] text-muted-foreground">Pay from</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={swapBusy || cashBalanceInternal <= 0}
          onClick={() => onPaymentAccountChange("cash")}
          className={[
            "flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition",
            paymentAccount === "cash"
              ? "border-primary/50 bg-primary/10"
              : "border-border bg-card/60 hover:bg-secondary",
            (swapBusy || cashBalanceInternal <= 0) && "opacity-50",
          ].join(" ")}
        >
          <div
            className={[
              "flex h-8 w-8 items-center justify-center rounded-xl",
              paymentAccount === "cash" ? "bg-primary/20" : "bg-muted/40",
            ].join(" ")}
          >
            <Landmark
              className={[
                "h-4 w-4",
                paymentAccount === "cash"
                  ? "text-primary"
                  : "text-muted-foreground",
              ].join(" ")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-foreground">Cash</p>
            <p className="text-[11px] text-muted-foreground">
              {formatMoneyNoCode(cashBalanceDisplay)}
            </p>
          </div>
          {paymentAccount === "cash" && (
            <div className="h-2 w-2 rounded-full bg-primary" />
          )}
        </button>

        <button
          type="button"
          disabled={swapBusy || !plusReady || plusBalanceInternal <= 0}
          onClick={() => onPaymentAccountChange("plus")}
          className={[
            "flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition",
            paymentAccount === "plus"
              ? "border-primary/50 bg-primary/10"
              : "border-border bg-card/60 hover:bg-secondary",
            (swapBusy || !plusReady || plusBalanceInternal <= 0) &&
              "opacity-50",
          ].join(" ")}
        >
          <div
            className={[
              "flex h-8 w-8 items-center justify-center rounded-xl",
              paymentAccount === "plus" ? "bg-primary/20" : "bg-muted/40",
            ].join(" ")}
          >
            <TrendingUp
              className={[
                "h-4 w-4",
                paymentAccount === "plus"
                  ? "text-primary"
                  : "text-muted-foreground",
              ].join(" ")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-foreground">Plus</p>
            <p className="text-[11px] text-muted-foreground">
              {!plusReady
                ? "Loading..."
                : formatMoneyNoCode(plusBalanceDisplay)}
            </p>
          </div>
          {paymentAccount === "plus" && (
            <div className="h-2 w-2 rounded-full bg-primary" />
          )}
        </button>
      </div>
    </div>
  );
}

type ReceiveAccountSelectorProps = {
  receiveAccount: ReceiveAccount;
  onReceiveAccountChange: (account: ReceiveAccount) => void;
  plusReady: boolean;
  swapBusy: boolean;
};

export function ReceiveAccountSelector({
  receiveAccount,
  onReceiveAccountChange,
  plusReady,
  swapBusy,
}: ReceiveAccountSelectorProps) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-[11px] text-muted-foreground">Receive to</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={swapBusy}
          onClick={() => onReceiveAccountChange("cash")}
          className={[
            "flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition",
            receiveAccount === "cash"
              ? "border-primary/50 bg-primary/10"
              : "border-border bg-card/60 hover:bg-secondary",
            swapBusy && "opacity-50",
          ].join(" ")}
        >
          <div
            className={[
              "flex h-8 w-8 items-center justify-center rounded-xl",
              receiveAccount === "cash" ? "bg-primary/20" : "bg-muted/40",
            ].join(" ")}
          >
            <Landmark
              className={[
                "h-4 w-4",
                receiveAccount === "cash"
                  ? "text-primary"
                  : "text-muted-foreground",
              ].join(" ")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-foreground">Cash</p>
            <p className="text-[11px] text-muted-foreground">USDC</p>
          </div>
          {receiveAccount === "cash" && (
            <div className="h-2 w-2 rounded-full bg-primary" />
          )}
        </button>

        <button
          type="button"
          disabled={swapBusy || !plusReady}
          onClick={() => onReceiveAccountChange("plus")}
          className={[
            "flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition",
            receiveAccount === "plus"
              ? "border-primary/50 bg-primary/10"
              : "border-border bg-card/60 hover:bg-secondary",
            (swapBusy || !plusReady) && "opacity-50",
          ].join(" ")}
        >
          <div
            className={[
              "flex h-8 w-8 items-center justify-center rounded-xl",
              receiveAccount === "plus" ? "bg-primary/20" : "bg-muted/40",
            ].join(" ")}
          >
            <TrendingUp
              className={[
                "h-4 w-4",
                receiveAccount === "plus"
                  ? "text-primary"
                  : "text-muted-foreground",
              ].join(" ")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-foreground">Plus</p>
            <p className="text-[11px] text-muted-foreground">Earn yield</p>
          </div>
          {receiveAccount === "plus" && (
            <div className="h-2 w-2 rounded-full bg-primary" />
          )}
        </button>
      </div>
    </div>
  );
}
