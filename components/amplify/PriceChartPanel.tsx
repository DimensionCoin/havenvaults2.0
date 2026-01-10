// components/amplify/PriceChartPanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUser } from "@/providers/UserProvider";
import type { ChartTimeframe } from "./types";
import { formatMoney } from "./utils";
import TimeframeTabs from "./TimeframeTabs";
import LineOnlyChart from "./LineOnlyChart";
import LiveChart from "./LiveChart";
import Image from "next/image";

type Point = { t: number; y: number };

type Props = {
  tokenSymbol: string;
  tokenName: string;
  tokenLogo: string | null;

  // For non-BTC/ETH/SOL tokens (static price in USD)
  price: number | null;
  pctChange: number | null;

  timeframes: ChartTimeframe[];
  activeTimeframe: ChartTimeframe;
  onChangeTimeframe: (tf: ChartTimeframe) => void;

  chartData: Point[]; // Already in display currency from useAmplifyCoingecko
  loading: boolean;
  error: string | null;
};

const ORACLE_SYMBOLS = new Set(["BTC", "ETH", "SOL"]);

function calcTimeframePct(data: Point[]): number | null {
  if (!Array.isArray(data) || data.length < 2) return null;

  const firstValid = data.find((p) => Number.isFinite(p?.y) && p.y > 0);
  const lastValid = [...data]
    .reverse()
    .find((p) => Number.isFinite(p?.y) && p.y > 0);

  if (!firstValid || !lastValid) return null;

  const first = firstValid.y;
  const last = lastValid.y;

  if (first <= 0) return null;

  return ((last - first) / first) * 100;
}

export default function PriceChartPanel({
  tokenSymbol,
  tokenName,
  tokenLogo,
  price,
  pctChange,
  timeframes,
  activeTimeframe,
  onChangeTimeframe,
  chartData,
  loading,
  error,
}: Props) {
  const { user } = useUser();

  const sym = tokenSymbol.toUpperCase();
  const isOracleSymbol = useMemo(() => ORACLE_SYMBOLS.has(sym), [sym]);
  const isLive = activeTimeframe === "LIVE";

  // Get user's display currency
  const displayCurrency = useMemo(() => {
    const currency = user?.displayCurrency;
    return typeof currency === "string" && currency.trim()
      ? currency.trim().toUpperCase()
      : "USD";
  }, [user?.displayCurrency]);

  // Fetch FX rate from API (cached for 5 minutes)
  const [fxRate, setFxRate] = useState<number>(1);
  const [fxLoading, setFxLoading] = useState(false);

  useEffect(() => {
    // Skip if USD (no conversion needed)
    if (displayCurrency === "USD" || displayCurrency === "USDC") {
      setFxRate(1);
      return;
    }

    let cancelled = false;

    const fetchFx = async () => {
      // Check session cache first
      const cacheKey = `fx_rate_${displayCurrency}`;
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const { rate, at } = JSON.parse(cached);
          // Use cache if less than 5 minutes old
          if (
            Date.now() - at < 5 * 60 * 1000 &&
            Number.isFinite(rate) &&
            rate > 0
          ) {
            if (!cancelled) setFxRate(rate);
            return;
          }
        }
      } catch {
        // Invalid cache, continue to fetch
      }

      setFxLoading(true);

      try {
        const res = await fetch(
          `/api/fx?currency=${encodeURIComponent(displayCurrency)}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          }
        );

        if (!res.ok) {
          console.warn("[PriceChartPanel] FX fetch failed:", res.status);
          return;
        }

        const data = await res.json();
        const rate = Number(data?.rate);

        if (Number.isFinite(rate) && rate > 0) {
          if (!cancelled) {
            setFxRate(rate);
            // Cache the rate
            try {
              sessionStorage.setItem(
                cacheKey,
                JSON.stringify({ rate, at: Date.now() })
              );
            } catch {
              // sessionStorage might not be available
            }
          }
        }
      } catch (e) {
        console.warn("[PriceChartPanel] FX fetch error:", e);
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    };

    fetchFx();

    return () => {
      cancelled = true;
    };
  }, [displayCurrency]);

  // Subscribe to Convex for live price (only for BTC/ETH/SOL)
  const convexPrice = useQuery(
    api.prices.getLatestOne,
    isOracleSymbol ? { symbol: sym as "BTC" | "ETH" | "SOL" } : "skip"
  );

  const safeChartData: Point[] = useMemo(() => {
    return Array.isArray(chartData) ? chartData : [];
  }, [chartData]);

  // Determine the price to display in header
  // Convex prices are in USD, so we multiply by fxRate
  const headerPrice = useMemo(() => {
    if (isOracleSymbol && convexPrice?.lastPrice) {
      return convexPrice.lastPrice * fxRate;
    }
    // For non-oracle tokens, price prop is in USD
    if (price !== null && Number.isFinite(price)) {
      return price * fxRate;
    }
    return null;
  }, [isOracleSymbol, convexPrice?.lastPrice, fxRate, price]);

  // Determine % change
  const chartTimeframePct = useMemo(() => {
    if (loading || error) return null;
    return calcTimeframePct(safeChartData);
  }, [safeChartData, loading, error]);

  // For LIVE mode, calculate % from prevPrice
  const livePct = useMemo(() => {
    if (!isLive || !convexPrice?.lastPrice || !convexPrice?.prevPrice) {
      return null;
    }
    if (convexPrice.prevPrice === 0) return null;
    return (
      ((convexPrice.lastPrice - convexPrice.prevPrice) /
        convexPrice.prevPrice) *
      100
    );
  }, [isLive, convexPrice?.lastPrice, convexPrice?.prevPrice]);

  const finalPct = isLive
    ? livePct
    : isOracleSymbol
      ? chartTimeframePct
      : pctChange;

  const pct =
    typeof finalPct === "number" && Number.isFinite(finalPct) ? finalPct : null;
  const isUp = (pct ?? 0) >= 0;

  const isConnecting = isOracleSymbol && !convexPrice;

  return (
    <div className="glass-panel-soft px-4 pb-4 pt-5 sm:px-5 sm:pb-5 sm:pt-6">
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2">
          {tokenLogo ? (
            <Image
              src={tokenLogo}
              alt={tokenName}
              width={32}
              height={32}
              className="h-8 w-8 rounded-full border border-border/60 bg-card/40"
            />
          ) : (
            <div className="h-8 w-8 rounded-full border border-border/60 bg-card/40" />
          )}

          <div className="text-[12px] font-semibold tracking-[0.28em] text-muted-foreground">
            {tokenSymbol}
          </div>

          {/* Live indicator in header when LIVE mode */}
          {isLive && isOracleSymbol && (
            <div className="ml-2 flex items-center gap-1.5">
              <div className="relative">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <div className="absolute inset-0 h-2 w-2 rounded-full bg-primary animate-ping opacity-75" />
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-baseline justify-center gap-2">
          <span className="text-[44px] font-semibold leading-none tracking-tight text-foreground sm:text-5xl">
            {isConnecting || fxLoading
              ? "…"
              : headerPrice === null
                ? "…"
                : formatMoney(headerPrice, displayCurrency)}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-center gap-2">
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

          <span className="text-xs text-muted-foreground/80">
            ({isLive ? "vs prev" : activeTimeframe})
          </span>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative mt-4 overflow-hidden rounded-3xl border border-border/60 bg-card/40 shadow-[0_18px_55px_rgba(0,0,0,0.35)] -mx-4 sm:mx-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background/40 to-transparent" />

        <div className="absolute right-3 top-3 z-10">
          <TimeframeTabs
            timeframes={timeframes}
            active={activeTimeframe}
            onChange={onChangeTimeframe}
          />
        </div>

        <div className="px-3 pb-3 pt-12 sm:px-4 sm:pb-4">
          {isLive && isOracleSymbol ? (
            <LiveChart
              symbol={sym as "BTC" | "ETH" | "SOL"}
              displayCurrency={displayCurrency}
              fxRate={fxRate}
            />
          ) : loading && !safeChartData.length ? (
            <div className="flex h-[210px] items-center justify-center text-xs text-muted-foreground">
              Loading chart…
            </div>
          ) : error ? (
            <div className="flex h-[210px] items-center justify-center text-xs text-muted-foreground">
              {error}
            </div>
          ) : !safeChartData.length ? (
            <div className="flex h-[210px] items-center justify-center text-xs text-muted-foreground">
              No chart data.
            </div>
          ) : (
            <LineOnlyChart
              data={safeChartData}
              displayCurrency={displayCurrency}
              timeframe={activeTimeframe}
            />
          )}
        </div>
      </div>
    </div>
  );
}
