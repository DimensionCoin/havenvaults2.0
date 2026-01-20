"use client";

import React from "react";
import { Loader2, ChevronDown, ChevronUp, Info } from "lucide-react";
import { getCluster } from "@/lib/tokenConfig";
import type {
  PaymentAccount,
  ReceiveAccount,
  TradeCalculations,
} from "./types";
import { SWAP_FEE_PCT_DISPLAY } from "./constants";
import { formatMoneyNoCode, formatQty } from "./utils";
import {
  PaymentAccountSelector,
  ReceiveAccountSelector,
} from "./Accountselector";

const CLUSTER = getCluster();

type TradePanelProps = {
  // Token info
  name: string;
  symbol: string;
  mint: string;
  coingeckoId: string;
  hasCoingeckoId: boolean;
  priceSource: "coingecko" | "jupiter" | null;

  // Trade state
  side: "buy" | "sell";
  onSideChange: (side: "buy" | "sell") => void;
  paymentAccount: PaymentAccount;
  onPaymentAccountChange: (account: PaymentAccount) => void;
  receiveAccount: ReceiveAccount;
  onReceiveAccountChange: (account: ReceiveAccount) => void;

  // Input state
  inputUnit: "cash" | "asset";
  onInputUnitChange: (unit: "cash" | "asset") => void;
  cashAmount: string;
  assetAmount: string;
  onAmountChange: (value: string, unit: "cash" | "asset") => void;
  lastEdited: "cash" | "asset";

  // Balances
  cashBalanceDisplay: number;
  cashBalanceInternal: number;
  plusBalanceDisplay: number;
  plusBalanceInternal: number;
  plusReady: boolean;
  tokenBalance: number;
  tokenValueDisplay: number;
  activeBalanceDisplay: number;

  // Calculations
  tradeCalculations: TradeCalculations;
  spotPriceDisplay: number | null;
  assetNum: number;

  // UI State
  swapBusy: boolean;
  inputsDisabled: boolean;
  primaryDisabled: boolean;
  showBreakdown: boolean;
  onShowBreakdownChange: (show: boolean) => void;
  showDetails: boolean;
  onShowDetailsChange: (show: boolean) => void;
  errorToShow: string | null | undefined;

  // Actions
  onSetQuickCash: (pct: number) => void;
  onSetSellMax: () => void;
  onExecuteTrade: () => void;
};

export function TradePanel({
  name,
  symbol,
  mint,
  coingeckoId,
  hasCoingeckoId,
  priceSource,
  side,
  onSideChange,
  paymentAccount,
  onPaymentAccountChange,
  receiveAccount,
  onReceiveAccountChange,
  inputUnit,
  onInputUnitChange,
  cashAmount,
  assetAmount,
  onAmountChange,
  lastEdited,
  cashBalanceDisplay,
  cashBalanceInternal,
  plusBalanceDisplay,
  plusBalanceInternal,
  plusReady,
  tokenBalance,
  tokenValueDisplay,
  activeBalanceDisplay,
  tradeCalculations,
  spotPriceDisplay,
  assetNum,
  swapBusy,
  inputsDisabled,
  primaryDisabled,
  showBreakdown,
  onShowBreakdownChange,
  showDetails,
  onShowDetailsChange,
  errorToShow,
  onSetQuickCash,
  onSetSellMax,
  onExecuteTrade,
}: TradePanelProps) {
  const {
    feeDisplay,
    netDisplay,
    receiveAsset,
    receiveCashDisplay,
    payCashDisplay,
  } = tradeCalculations;

  const assetLine = `You own: ${formatQty(tokenBalance, 6)} ${symbol || "ASSET"} · ${formatMoneyNoCode(tokenValueDisplay)}`;

  return (
    <section className="min-w-0 space-y-3">
      <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Trade</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Buy or sell {symbol || name}.
            </p>
          </div>

          <div className="inline-flex rounded-full border bg-card/60 p-0.5 text-[11px]">
            <button
              type="button"
              disabled={swapBusy}
              onClick={() => onSideChange("buy")}
              className={[
                "rounded-full px-3 py-1 font-semibold transition disabled:opacity-50",
                side === "buy"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/80 hover:bg-secondary",
              ].join(" ")}
            >
              Buy
            </button>
            <button
              type="button"
              disabled={swapBusy}
              onClick={() => onSideChange("sell")}
              className={[
                "rounded-full px-3 py-1 font-semibold transition disabled:opacity-50",
                side === "sell"
                  ? "bg-destructive text-destructive-foreground"
                  : "text-foreground/80 hover:bg-secondary",
              ].join(" ")}
            >
              Sell
            </button>
          </div>
        </div>

        {/* Payment Account Selector (only for BUY) */}
        {side === "buy" && (
          <PaymentAccountSelector
            paymentAccount={paymentAccount}
            onPaymentAccountChange={onPaymentAccountChange}
            cashBalanceDisplay={cashBalanceDisplay}
            cashBalanceInternal={cashBalanceInternal}
            plusBalanceDisplay={plusBalanceDisplay}
            plusBalanceInternal={plusBalanceInternal}
            plusReady={plusReady}
            swapBusy={swapBusy}
          />
        )}

        {/* Receive Account Selector (only for SELL) */}
        {side === "sell" && (
          <ReceiveAccountSelector
            receiveAccount={receiveAccount}
            onReceiveAccountChange={onReceiveAccountChange}
            plusReady={plusReady}
            swapBusy={swapBusy}
          />
        )}

        {/* Context (for sell side) */}
        {side === "sell" && (
          <div className="mt-3 rounded-2xl border bg-card/60 px-3 py-2 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Asset balance</span>
              <span className="font-medium text-foreground">{assetLine}</span>
            </div>
          </div>
        )}

        {/* Amount input + unit toggle */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {side === "buy"
                ? "Choose how you want to buy"
                : "Choose how you want to sell"}
            </span>

            <button
              type="button"
              disabled={inputsDisabled}
              onClick={() => onShowBreakdownChange(!showBreakdown)}
              className="inline-flex items-center gap-1 text-[11px] text-foreground/80 hover:text-foreground disabled:opacity-50"
            >
              Fees
              {showBreakdown ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-hidden rounded-2xl border bg-card/60 px-3 py-2 sm:px-3.5 sm:py-2.5">
            <input
              value={inputUnit === "cash" ? cashAmount : assetAmount}
              disabled={inputsDisabled}
              onChange={(e) => {
                onAmountChange(e.target.value, inputUnit);
              }}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent text-right text-xl font-semibold text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />

            {side === "sell" && inputUnit === "asset" && tokenBalance > 0 && (
              <button
                type="button"
                disabled={inputsDisabled}
                onClick={onSetSellMax}
                className="shrink-0 rounded-full border bg-card/80 px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
              >
                Max
              </button>
            )}

            <div className="inline-flex rounded-full border bg-card/60 p-0.5 text-[11px]">
              <button
                type="button"
                disabled={inputsDisabled}
                onClick={() => onInputUnitChange("cash")}
                className={[
                  "rounded-full px-2.5 py-1 font-semibold transition disabled:opacity-50",
                  inputUnit === "cash"
                    ? "bg-secondary text-foreground"
                    : "text-foreground/80 hover:bg-secondary",
                ].join(" ")}
              >
                Cash
              </button>
              <button
                type="button"
                disabled={inputsDisabled}
                onClick={() => onInputUnitChange("asset")}
                className={[
                  "rounded-full px-2.5 py-1 font-semibold transition disabled:opacity-50",
                  inputUnit === "asset"
                    ? "bg-secondary text-foreground"
                    : "text-foreground/80 hover:bg-secondary",
                ].join(" ")}
              >
                {symbol || "Asset"}
              </button>
            </div>
          </div>

          {/* Quick actions for buys */}
          {side === "buy" && inputUnit === "cash" && (
            <div className="mt-2 flex gap-2">
              {[0.25, 0.5, 0.75, 1].map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={inputsDisabled || activeBalanceDisplay <= 0}
                  onClick={() => onSetQuickCash(p)}
                  className="flex-1 rounded-2xl border bg-card/60 px-3 py-2 text-[11px] font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
                >
                  {p === 1 ? "Max" : `${Math.round(p * 100)}%`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bank-style preview */}
        <div className="mt-3 rounded-2xl border bg-card/60 px-3 py-3 text-[12px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {side === "buy" ? "You pay" : "You sell"}
            </span>
            <span className="font-semibold text-foreground">
              {side === "buy"
                ? formatMoneyNoCode(payCashDisplay)
                : `${formatQty(lastEdited === "asset" ? assetNum : tradeCalculations.payAsset, 6)} ${symbol || "ASSET"}`}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-muted-foreground">
              You receive
              {lastEdited === "asset" && side === "buy" ? "" : " (approx.)"}
              {side === "sell" && (
                <span className="ml-1 text-[10px]">
                  → {receiveAccount === "cash" ? "Cash" : "Plus"}
                </span>
              )}
            </span>
            <span className="font-semibold text-foreground">
              {side === "buy"
                ? `${formatQty(receiveAsset, 6)} ${symbol || "ASSET"}`
                : formatMoneyNoCode(receiveCashDisplay)}
            </span>
          </div>

          {side === "buy" && lastEdited === "asset" && assetNum > 0 && (
            <div className="mt-2 text-[11px] text-primary">
              ✓ You&apos;ll receive exactly {formatQty(assetNum, 6)} {symbol}
            </div>
          )}

          {side === "sell" &&
            receiveAccount === "plus" &&
            receiveCashDisplay > 0 && (
              <div className="mt-2 text-[11px] text-primary">
                ✓ Proceeds will be deposited to Plus and start earning yield
              </div>
            )}

          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Rate</span>
            <span>
              1 {symbol || "ASSET"} ≈ {formatMoneyNoCode(spotPriceDisplay)}
            </span>
          </div>
        </div>

        {/* Fee breakdown */}
        {showBreakdown && (
          <div className="mt-2 rounded-2xl border bg-card/60 px-3 py-2 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Haven fee</span>
              <span className="font-medium text-foreground">
                {formatMoneyNoCode(feeDisplay)}{" "}
                <span className="text-muted-foreground">
                  ({SWAP_FEE_PCT_DISPLAY.toFixed(2)}%)
                </span>
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Net amount</span>
              <span className="font-semibold text-foreground">
                {formatMoneyNoCode(netDisplay)}
              </span>
            </div>

            <div className="mt-2 text-[11px] text-muted-foreground">
              {side === "buy" && lastEdited === "asset"
                ? "Fee is added to your payment to ensure you receive the exact amount."
                : "Fees are taken from the order amount."}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="mt-4 space-y-2">
          <button
            type="button"
            className="haven-btn-primary w-full rounded-2xl py-3 text-sm font-semibold"
            disabled={primaryDisabled}
            onClick={onExecuteTrade}
          >
            {swapBusy ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </span>
            ) : side === "buy" ? (
              `Buy ${symbol || "asset"}`
            ) : (
              `Sell ${symbol || "asset"}`
            )}
          </button>

          {errorToShow && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-foreground">
              {errorToShow}
            </div>
          )}
        </div>

        {/* Details toggle */}
        <button
          type="button"
          onClick={() => onShowDetailsChange(!showDetails)}
          className="mt-4 inline-flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3 w-3" />
          {showDetails ? "Hide details" : "Show details"}
          {showDetails ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        {showDetails && (
          <div className="mt-2 rounded-2xl border bg-card/60 px-3 py-3 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Mint</span>
              <span className="max-w-[220px] truncate font-mono text-[11px] text-foreground">
                {mint}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Fee</span>
              <span className="font-medium text-foreground">
                {SWAP_FEE_PCT_DISPLAY.toFixed(2)}%
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Cluster</span>
              <span className="font-medium text-foreground">{CLUSTER}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground">Price source</span>
              <span className="font-medium text-foreground">
                {priceSource === "jupiter"
                  ? "Jupiter"
                  : priceSource === "coingecko"
                    ? "CoinGecko"
                    : "—"}
              </span>
            </div>
            {side === "buy" && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">Payment source</span>
                <span className="font-medium text-foreground">
                  {paymentAccount === "cash"
                    ? "Cash (USDC)"
                    : "Plus (JLJupUSD)"}
                </span>
              </div>
            )}
            {side === "sell" && (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">Receive to</span>
                <span className="font-medium text-foreground">
                  {receiveAccount === "cash"
                    ? "Cash (USDC)"
                    : "Plus (JLJupUSD)"}
                </span>
              </div>
            )}

            {hasCoingeckoId ? (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">CoinGecko</span>
                <span className="font-medium text-foreground">
                  {coingeckoId}
                </span>
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-amber-500">
                This token has no CoinGecko id — price via Jupiter, chart
                unavailable.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
