// components/amplify/hooks/useAmplifyCoingecko.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type { AmplifyTokenSymbol, ChartTimeframe } from "@/components/amplify/types";
import { findTokenBySymbol } from "@/lib/tokenConfig";

type HistoryPoint = { t: number; price: number }; // USD from API

type SpotResp = {
  prices: Record<
    string,
    { priceUsd: number; priceChange24hPct: number | null }
  >;
};

type HistResp = { id: string; prices: HistoryPoint[] };

function tfConfig(tf: ChartTimeframe): {
  days: string;
  interval: "hourly" | "daily";
} {
  switch (tf) {
    case "1H":
    case "1D":
      return { days: "1", interval: "hourly" };
    case "1W":
      return { days: "7", interval: "hourly" };
    case "1M":
      return { days: "30", interval: "daily" };
    case "1Y":
      return { days: "365", interval: "daily" };
    case "ALL":
      return { days: "max", interval: "daily" };
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
}) {
  const { symbol, timeframe, fxRate } = opts;

  const meta = useMemo(() => findTokenBySymbol(symbol), [symbol]);
  const cgId = (meta?.id || "").trim();

  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [pct24h, setPct24h] = useState<number | null>(null);

  const [historyUsd, setHistoryUsd] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cgId) {
      setPriceUsd(null);
      setPct24h(null);
      setHistoryUsd([]);
      setError("No CoinGecko id for this token.");
      return;
    }

    const controller = new AbortController();
    const cfg = tfConfig(timeframe);

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
          setError("Couldn’t load chart data.");
          return;
        }

        const h = (await histRes.json()) as HistResp;
        const raw = Array.isArray(h?.prices) ? h.prices : [];
        setHistoryUsd(filterWindow(timeframe, raw));
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError("Couldn’t load price data.");
        setHistoryUsd([]);
      } finally {
        setLoading(false);
      }
    };

    void run();
    return () => controller.abort();
  }, [cgId, timeframe]);

  const priceDisplay = useMemo(() => {
    if (!priceUsd || !Number.isFinite(fxRate) || fxRate <= 0) return null;
    return priceUsd * fxRate;
  }, [priceUsd, fxRate]);

  // ✅ return timestamps + y in display currency
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
  };
}
