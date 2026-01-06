// components/amplify/hooks/useAmplifyCoingecko.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AmplifyTokenSymbol,
  ChartTimeframe,
} from "@/components/amplify/types";
import { findTokenBySymbol } from "@/lib/tokenConfig";

type HistoryPoint = { t: number; price: number }; // USD from API

type SpotResp = {
  prices: Record<
    string,
    { priceUsd: number; priceChange24hPct: number | null }
  >;
};

type HistResp = { id: string; prices: HistoryPoint[] };

/**
 * Map timeframe to CoinGecko params.
 * NOTE: "LIVE" is NOT handled here - it comes from Convex.
 */
function tfConfig(tf: ChartTimeframe): {
  days: string;
  interval: "hourly" | "daily";
} | null {
  switch (tf) {
    case "LIVE":
      // LIVE is handled by Convex, not CoinGecko
      return null;
    case "1H":
    case "1D":
      return { days: "1", interval: "hourly" };
    case "1W":
      return { days: "7", interval: "hourly" };
    case "1M":
      return { days: "30", interval: "daily" };
    case "1Y":
      return { days: "365", interval: "daily" };
    default:
      return { days: "7", interval: "hourly" };
  }
}

function filterWindow(tf: ChartTimeframe, pts: HistoryPoint[]) {
  if (!pts.length) return pts;

  const now = Date.now();
  const windowMs =
    tf === "1H" ? 60 * 60 * 1000 : tf === "1D" ? 24 * 60 * 60 * 1000 : 0;

  if (!windowMs) return pts;

  const cutoff = now - windowMs;
  const filtered = pts.filter((p) => p.t >= cutoff);
  if (filtered.length >= 2) return filtered;
  return pts.slice(Math.max(0, pts.length - 24));
}

export function useAmplifyCoingecko(opts: {
  symbol: AmplifyTokenSymbol;
  timeframe: ChartTimeframe;
  fxRate: number; // USD -> display currency
  enabled?: boolean; // Allow skipping fetch (e.g., when LIVE is selected)
}) {
  const { symbol, timeframe, fxRate, enabled = true } = opts;

  const meta = useMemo(() => findTokenBySymbol(symbol), [symbol]);
  const cgId = (meta?.id || "").trim();

  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [pct24h, setPct24h] = useState<number | null>(null);

  const [historyUsd, setHistoryUsd] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if this timeframe uses CoinGecko
  const isLive = timeframe === "LIVE";
  const shouldFetch = enabled && !isLive;

  useEffect(() => {
    // Skip fetch for LIVE timeframe (handled by Convex)
    if (!shouldFetch) {
      setLoading(false);
      return;
    }

    if (!cgId) {
      setPriceUsd(null);
      setPct24h(null);
      setHistoryUsd([]);
      setError("No CoinGecko id for this token.");
      return;
    }

    const cfg = tfConfig(timeframe);
    if (!cfg) {
      // Shouldn't happen if shouldFetch is correct, but guard anyway
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        const spotReq = fetch("/api/prices/coingecko", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [cgId] }),
          signal: controller.signal,
          cache: "no-store",
        });

        const histUrl = `/api/prices/coingecko/historical?id=${encodeURIComponent(
          cgId
        )}&days=${encodeURIComponent(cfg.days)}&interval=${encodeURIComponent(
          cfg.interval
        )}`;

        const histReq = fetch(histUrl, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        const [spotRes, histRes] = await Promise.all([spotReq, histReq]);

        if (spotRes.ok) {
          const s = (await spotRes.json()) as SpotResp;
          const entry = s?.prices?.[cgId];
          setPriceUsd(
            typeof entry?.priceUsd === "number" ? entry.priceUsd : null
          );
          setPct24h(
            typeof entry?.priceChange24hPct === "number"
              ? entry.priceChange24hPct
              : null
          );
        }

        if (!histRes.ok) {
          setHistoryUsd([]);
          setError("Couldn't load chart data.");
          return;
        }

        const h = (await histRes.json()) as HistResp;
        const raw = Array.isArray(h?.prices) ? h.prices : [];
        setHistoryUsd(filterWindow(timeframe, raw));
      } catch (e: unknown) {
        const err = e as { name?: string };
        if (err?.name === "AbortError") return;
        setError("Couldn't load price data.");
        setHistoryUsd([]);
      } finally {
        setLoading(false);
      }
    };

    void run();
    return () => controller.abort();
  }, [cgId, timeframe, shouldFetch]);

  const priceDisplay = useMemo(() => {
    if (!priceUsd || !Number.isFinite(fxRate) || fxRate <= 0) return null;
    return priceUsd * fxRate;
  }, [priceUsd, fxRate]);

  // Return timestamps + y in display currency
  const chartData = useMemo(() => {
    if (!historyUsd.length || !Number.isFinite(fxRate) || fxRate <= 0)
      return [];
    return historyUsd.map((p) => ({
      t: p.t,
      y: p.price * fxRate,
    }));
  }, [historyUsd, fxRate]);

  return {
    cgId,
    priceDisplay,
    pct24h,
    chartData,
    loading,
    error,
    isLive, // Expose so parent knows to render LiveChart instead
  };
}
