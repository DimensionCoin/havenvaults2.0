"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ChartTimeframe } from "./types";
import { formatMoney } from "./utils";
import TimeframeTabs from "./TimeframeTabs";
import LineOnlyChart from "./LineOnlyChart";

type Point = { t: number; y: number };

type Props = {
  tokenSymbol: string;
  tokenName: string;
  tokenLogo: string | null;
  displayCurrency: string;

  price: number | null;
  pctChange: number | null;

  timeframes: ChartTimeframe[];
  activeTimeframe: ChartTimeframe;
  onChangeTimeframe: (tf: ChartTimeframe) => void;

  chartData: Point[];
  loading: boolean;
  error: string | null;
};

export default function PriceChartPanel({
  tokenSymbol,
  tokenName,
  tokenLogo,
  displayCurrency,
  price,
  pctChange,
  timeframes,
  activeTimeframe,
  onChangeTimeframe,
  chartData,
  loading,
  error,
}: Props) {
  const pct = typeof pctChange === "number" ? pctChange : null;
  const isUp = (pct ?? 0) >= 0;

  return (
    <div className="glass-panel bg-white/10 px-4 pb-4 pt-5 sm:px-5 sm:pb-5 sm:pt-6">
      {/* Centered header (matches reference) */}
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2">
          {tokenLogo ? (
            <img
              src={tokenLogo}
              alt={tokenName}
              className="h-6 w-6 rounded-full border border-white/10"
            />
          ) : (
            <div className="h-6 w-6 rounded-full border border-white/10 bg-white/5" />
          )}

          <div className="text-[12px] font-semibold tracking-[0.28em] text-white/55">
            {tokenSymbol}
          </div>
        </div>

        <div className="mt-2 flex items-baseline justify-center gap-2">
          <span className="text-[44px] font-semibold leading-none tracking-tight text-white/92 sm:text-5xl">
            {price === null ? "…" : formatMoney(price, displayCurrency)}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-1 text-sm font-semibold",
              pct === null
                ? "text-white/40"
                : isUp
                ? "text-emerald-300"
                : "text-rose-300",
            ].join(" ")}
          >
            {pct === null ? null : isUp ? (
              <ArrowUpRight className="h-4 w-4" />
            ) : (
              <ArrowDownRight className="h-4 w-4" />
            )}

            {pct === null ? "—" : `${pct.toFixed(2)}%`}
          </span>

          <span className="text-xs text-white/35">({activeTimeframe})</span>
        </div>
      </div>

      {/* Chart area (sleek like reference) */}
      <div className="relative mt-4 overflow-hidden rounded-3xl border border-white/10 bg-black/45 shadow-[0_18px_55px_rgba(0,0,0,0.55)] -mx-4 sm:mx-0">
        {/* soft top fade */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent" />

        {/* Timeframes overlay (top-right like trading apps) */}
        <div className="absolute right-3 top-3 z-10">
          <TimeframeTabs
            timeframes={timeframes}
            active={activeTimeframe}
            onChange={onChangeTimeframe}
          />
        </div>

        {/* Main chart */}
        <div className="px-3 pb-3 pt-12 sm:px-4 sm:pb-4">
          {loading && !chartData.length ? (
            <div className="flex h-[210px] items-center justify-center text-xs text-white/40">
              Loading chart…
            </div>
          ) : error ? (
            <div className="flex h-[210px] items-center justify-center text-xs text-white/40">
              {error}
            </div>
          ) : !chartData.length ? (
            <div className="flex h-[210px] items-center justify-center text-xs text-white/40">
              No chart data.
            </div>
          ) : (
            <LineOnlyChart
              data={chartData}
              displayCurrency={displayCurrency}
              timeframe={activeTimeframe}
            />
          )}
        </div>
      </div>
    </div>
  );
}
