// hooks/useAmplifyCoingecko.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AmplifyTokenSymbol,
  ChartMode,
  ChartTimeframe,
  OHLCPoint,
  VolumePoint,
} from "@/components/amplify/types";
import { findTokenBySymbol } from "@/lib/tokenConfig";

type HistoryPoint = { t: number; price: number }; // USD from API

type SpotResp = {
  prices: Record<
    string,
    { priceUsd: number; priceChange24hPct: number | null }
  >;
};

type HistResp = { id: string; prices: HistoryPoint[]; volumes?: VolumePoint[] };
type OHLCResp = { id: string; ohlc: OHLCPoint[] };

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

function getWindowMs(tf: ChartTimeframe): number {
  if (tf === "1H") return 60 * 60 * 1000;
  if (tf === "1D") return 24 * 60 * 60 * 1000;
  return 0;
}

function filterWindow(tf: ChartTimeframe, pts: HistoryPoint[]) {
  if (!pts.length) return pts;

  const windowMs = getWindowMs(tf);
  if (!windowMs) return pts;

  const cutoff = Date.now() - windowMs;
  const filtered = pts.filter((p) => p.t >= cutoff);
  if (filtered.length >= 2) return filtered;
  return pts.slice(Math.max(0, pts.length - 24));
}

function filterOhlcWindow(tf: ChartTimeframe, pts: OHLCPoint[]) {
  if (!pts.length) return pts;

  const windowMs = getWindowMs(tf);
  if (!windowMs) return pts;

  const cutoff = Date.now() - windowMs;
  const filtered = pts.filter((p) => p.t >= cutoff);
  if (filtered.length >= 2) return filtered;
  return pts.slice(Math.max(0, pts.length - 4));
}

/**
 * Aggregate fine-grained volume data to match OHLC candle boundaries.
 * Each candle spans from its timestamp to the next candle's timestamp.
 * Volume points within that range are summed.
 */
function aggregateVolumeToCandles(
  candles: OHLCPoint[],
  volumes: VolumePoint[]
): VolumePoint[] {
  if (!candles.length || !volumes.length) return [];

  const result: VolumePoint[] = [];
  const lastIndex = candles.length - 1;
  const lastInterval =
    candles.length >= 2 ? candles[lastIndex].t - candles[lastIndex - 1].t : null;
  const lastEnd =
    lastInterval && lastInterval > 0
      ? candles[lastIndex].t + lastInterval
      : candles[lastIndex].t + 1;
  const boundedVolumes = volumes.filter(
    (v) => v.t >= candles[0].t && v.t < lastEnd
  );

  for (let i = 0; i < candles.length; i++) {
    const start = candles[i].t;
    const end = i < lastIndex ? candles[i + 1].t : lastEnd;

    let totalVol = 0;
    for (const v of boundedVolumes) {
      if (v.t >= start && v.t < end) {
        totalVol += v.volume;
      }
    }

    result.push({ t: start, volume: totalVol });
  }

  return result;
}

function filterVolumeWindow(tf: ChartTimeframe, pts: VolumePoint[]) {
  if (!pts.length) return pts;

  const windowMs = getWindowMs(tf);
  if (!windowMs) return pts;

  const cutoff = Date.now() - windowMs;
  const filtered = pts.filter((p) => p.t >= cutoff);
  if (filtered.length >= 2) return filtered;
  return pts.slice(Math.max(0, pts.length - 24));
}

export function useAmplifyCoingecko(opts: {
  symbol: AmplifyTokenSymbol;
  timeframe: ChartTimeframe;
  fxRate: number; // USD -> display currency
  chartMode?: ChartMode;
  enabled?: boolean; // Allow skipping fetch (e.g., when LIVE is selected)
}) {
  const { symbol, timeframe, fxRate, chartMode = "line", enabled = true } = opts;

  const meta = useMemo(() => findTokenBySymbol(symbol), [symbol]);
  const cgId = (meta?.id || "").trim();

  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [pct24h, setPct24h] = useState<number | null>(null);

  const [historyUsd, setHistoryUsd] = useState<HistoryPoint[]>([]);
  const [ohlcUsd, setOhlcUsd] = useState<OHLCPoint[]>([]);
  const [volumeRaw, setVolumeRaw] = useState<VolumePoint[]>([]);
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
      setOhlcUsd([]);
      setVolumeRaw([]);
      setError("No CoinGecko id for this token.");
      return;
    }

    const cfg = tfConfig(timeframe);
    if (!cfg) {
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        // Always fetch spot price
        const spotReq = fetch("/api/prices/coingecko", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [cgId] }),
          signal: controller.signal,
          cache: "no-store",
        });

        // Always fetch market_chart (for line data + volume)
        const chartUrl = `/api/prices/coingecko/historical?id=${encodeURIComponent(cgId)}&days=${encodeURIComponent(cfg.days)}&interval=${encodeURIComponent(cfg.interval)}`;
        const chartReq = fetch(chartUrl, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        // Additionally fetch OHLC when in candlestick mode
        const ohlcReq = chartMode === "candlestick"
          ? fetch(`/api/prices/historical?id=${encodeURIComponent(cgId)}&days=${encodeURIComponent(cfg.days)}&mode=ohlc`, {
              method: "GET",
              signal: controller.signal,
              cache: "no-store",
            })
          : null;

        const [spotRes, chartRes, ohlcRes] = await Promise.all([
          spotReq,
          chartReq,
          ohlcReq ?? Promise.resolve(null),
        ]);

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

        if (!chartRes.ok) {
          setHistoryUsd([]);
          setVolumeRaw([]);
          setOhlcUsd([]);
          setError("Couldn't load chart data.");
          return;
        }

        const h = (await chartRes.json()) as HistResp;
        const rawPrices = Array.isArray(h?.prices) ? h.prices : [];
        const rawVolumes = Array.isArray(h?.volumes) ? h.volumes : [];

        setHistoryUsd(filterWindow(timeframe, rawPrices));

        // Handle OHLC data for candlestick mode
        if (ohlcRes && ohlcRes.ok) {
          const o = (await ohlcRes.json()) as OHLCResp;
          const rawOhlc = Array.isArray(o?.ohlc) ? o.ohlc : [];
          const filteredOhlc = filterOhlcWindow(timeframe, rawOhlc);
          setOhlcUsd(filteredOhlc);
          // Aggregate volume to match candle boundaries
          setVolumeRaw(aggregateVolumeToCandles(filteredOhlc, rawVolumes));
        } else {
          setOhlcUsd([]);
          // Line mode: use raw volume filtered to window
          setVolumeRaw(filterVolumeWindow(timeframe, rawVolumes));
        }
      } catch (e: unknown) {
        const err = e as { name?: string };
        if (err?.name === "AbortError") return;
        setError("Couldn't load price data.");
        setHistoryUsd([]);
        setOhlcUsd([]);
        setVolumeRaw([]);
      } finally {
        setLoading(false);
      }
    };

    void run();
    return () => controller.abort();
  }, [cgId, timeframe, chartMode, shouldFetch]);

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

  // OHLC data in display currency
  const ohlcData = useMemo(() => {
    if (!ohlcUsd.length || !Number.isFinite(fxRate) || fxRate <= 0) return [];
    return ohlcUsd.map((p) => ({
      t: p.t,
      open: p.open * fxRate,
      high: p.high * fxRate,
      low: p.low * fxRate,
      close: p.close * fxRate,
    }));
  }, [ohlcUsd, fxRate]);

  // Volume data (no FX conversion - volume is in USD)
  const volumeData = useMemo(() => {
    return volumeRaw;
  }, [volumeRaw]);

  return {
    cgId,
    priceDisplay,
    pct24h,
    chartData,
    ohlcData,
    volumeData,
    loading,
    error,
    isLive,
  };
}
