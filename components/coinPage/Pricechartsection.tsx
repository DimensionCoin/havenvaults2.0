"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { TimeframeKey, SleekPoint } from "./types";
import { TIMEFRAMES } from "./constants";
import { formatMoneyNoCode, formatPct } from "./utils";
import { SleekLineChart } from "./Sleeklinechart";
import { PriceDisplayOverlay } from "./Pricedisplayoverlay";

type PriceChartSectionProps = {
  // Token info
  name: string;
  symbol: string;
  logo: string | null;
  category: string;
  priceSource: "coingecko" | "jupiter" | null;

  // Price data
  spotPriceDisplay: number | null;
  priceChange24hPct: number | null;
  priceLoading: boolean;

  // Chart data
  hasCoingeckoId: boolean;
  chartData: SleekPoint[];
  historyLoading: boolean;
  historyError: string | null;
  timeframe: TimeframeKey;
  onTimeframeChange: (tf: TimeframeKey) => void;
  displayCurrency: string;
  perfPct: number;

  // State
  swapBusy: boolean;
};

export function PriceChartSection({
  name,
  symbol,
  logo,
  category,
  priceSource,
  spotPriceDisplay,
  priceChange24hPct,
  priceLoading,
  hasCoingeckoId,
  chartData,
  historyLoading,
  historyError,
  timeframe,
  onTimeframeChange,
  displayCurrency,
  perfPct,
  swapBusy,
}: PriceChartSectionProps) {
  const pct = typeof priceChange24hPct === "number" ? priceChange24hPct : null;
  const isUp = (pct ?? 0) >= 0;
  const showChart = hasCoingeckoId && chartData.length > 0;

  return (
    <section className="min-w-0 space-y-3">
      <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={name}
              className="h-10 w-10 rounded-full border bg-card/60 object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-full border bg-card/60" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">
                {name}
              </p>
              {!!category && <span className="haven-pill">{category}</span>}
              {priceSource === "jupiter" && (
                <span className="haven-pill bg-amber-500/10 text-amber-600">
                  Jupiter
                </span>
              )}
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight text-foreground">
                {priceLoading && spotPriceDisplay === null
                  ? "…"
                  : formatMoneyNoCode(spotPriceDisplay)}
              </span>

              <span
                className={[
                  "inline-flex items-center gap-1 text-sm font-semibold",
                  pct === null
                    ? "text-muted-foreground"
                    : isUp
                      ? "text-primary"
                      : "text-destructive",
                ].join(" ")}
              >
                {pct === null ? null : isUp ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
                {pct === null ? "—" : `${pct.toFixed(2)}%`}
              </span>

              <span className="text-xs text-muted-foreground">(24h)</span>
            </div>

            {hasCoingeckoId && chartData.length > 0 && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {TIMEFRAMES[timeframe].label} perf{" "}
                <span
                  className={
                    perfPct > 0
                      ? "text-primary"
                      : perfPct < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {formatPct(perfPct)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Chart Container */}
        <div className="mt-3 overflow-hidden rounded-3xl border bg-card/60">
          {hasCoingeckoId && (
            <div className="flex items-center justify-between border-b bg-card/60 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                {showChart ? "Price chart" : "Price"}
              </p>

              {showChart && (
                <div className="flex gap-1 rounded-full border bg-card/60 p-0.5 text-[11px]">
                  {(Object.keys(TIMEFRAMES) as TimeframeKey[]).map((tf) => {
                    const active = tf === timeframe;
                    return (
                      <button
                        key={tf}
                        type="button"
                        disabled={swapBusy}
                        onClick={() => onTimeframeChange(tf)}
                        className={[
                          "rounded-full px-2.5 py-1 font-semibold transition disabled:opacity-50",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground/80 hover:bg-secondary",
                        ].join(" ")}
                      >
                        {TIMEFRAMES[tf].label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {!hasCoingeckoId && (
            <div className="flex items-center justify-between border-b bg-card/60 px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                Live price
              </p>
              <span className="text-[10px] text-amber-600">
                Chart unavailable
              </span>
            </div>
          )}

          <div className="px-3 pb-3 pt-3 sm:px-4">
            {showChart ? (
              <SleekLineChart
                data={chartData}
                displayCurrency={displayCurrency}
                timeframe={timeframe}
              />
            ) : historyLoading && hasCoingeckoId ? (
              <div className="flex h-[210px] items-center justify-center text-xs text-muted-foreground">
                Loading chart…
              </div>
            ) : historyError && hasCoingeckoId ? (
              <div className="flex h-[210px] items-center justify-center text-xs text-muted-foreground">
                {historyError}
              </div>
            ) : (
              <PriceDisplayOverlay
                price={spotPriceDisplay}
                priceChange24hPct={priceChange24hPct}
                symbol={symbol}
                loading={priceLoading}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
