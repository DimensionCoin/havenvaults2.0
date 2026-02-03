"use client";

import React, { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Maximize2 } from "lucide-react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { ChartTimeframe, ChartMode, OHLCPoint, VolumePoint } from "./types";

type LinePoint = { t: number; y: number };

type Props = {
  mode: ChartMode;
  lineData: LinePoint[];
  ohlcData: OHLCPoint[];
  volumeData: VolumePoint[];
  displayCurrency: string;
  timeframe: ChartTimeframe;
  height?: number;
};

type CrosshairInfo = {
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  isUp?: boolean;
} | null;

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatPrice(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    })
      .formatToParts(n)
      .map((p) => (p.type !== "currency" ? p.value : p.value.replace(/[A-Za-z]/g, "")))
      .join("")
      .trim();
  } catch {
    return n.toFixed(2);
  }
}

export default function TradingChart({
  mode,
  lineData,
  ohlcData,
  volumeData,
  displayCurrency,
  timeframe,
  height = 300,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const [crosshairInfo, setCrosshairInfo] = useState<CrosshairInfo>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  // Convert ms timestamps to UTC seconds for lightweight-charts.
  // Deduplicate by time (ms->s conversion can create dupes). Keep last value per timestamp.
  const lwcLineData = useMemo(() => {
    const map = new Map<number, { time: UTCTimestamp; value: number }>();
    for (const p of lineData) {
      const t = Math.floor(p.t / 1000) as UTCTimestamp;
      map.set(t, { time: t, value: p.y });
    }
    return [...map.values()].sort((a, b) => (a.time as number) - (b.time as number));
  }, [lineData]);

  const lwcOhlcData = useMemo(() => {
    const map = new Map<number, { time: UTCTimestamp; open: number; high: number; low: number; close: number }>();
    for (const p of ohlcData) {
      const t = Math.floor(p.t / 1000) as UTCTimestamp;
      map.set(t, { time: t, open: p.open, high: p.high, low: p.low, close: p.close });
    }
    return [...map.values()].sort((a, b) => (a.time as number) - (b.time as number));
  }, [ohlcData]);

  const lwcVolumeData = useMemo(() => {
    const map = new Map<number, { time: UTCTimestamp; value: number; color: string }>();
    const color = isDark
      ? "rgba(148, 163, 184, 0.15)"
      : "rgba(100, 116, 139, 0.12)";
    for (const p of volumeData) {
      const t = Math.floor(p.t / 1000) as UTCTimestamp;
      map.set(t, { time: t, value: p.volume, color });
    }
    return [...map.values()].sort((a, b) => (a.time as number) - (b.time as number));
  }, [volumeData, isDark]);

  const chartColors = useMemo(
    () => ({
      backgroundColor: "transparent",
      textColor: isDark ? "rgba(206, 252, 221, 0.55)" : "#64748b",
      gridColor: isDark
        ? "rgba(148, 163, 184, 0.06)"
        : "rgba(2, 6, 23, 0.05)",
      lineColor: isDark ? "#3ff387" : "#29c668",
      areaTopColor: isDark
        ? "rgba(63, 243, 135, 0.22)"
        : "rgba(41, 198, 104, 0.22)",
      areaBottomColor: isDark
        ? "rgba(63, 243, 135, 0.02)"
        : "rgba(41, 198, 104, 0.02)",
      upColor: isDark ? "#3ff387" : "#29c668",
      downColor: isDark ? "#f97373" : "#ef4444",
      crosshairColor: isDark
        ? "rgba(148, 163, 184, 0.35)"
        : "rgba(2, 6, 23, 0.25)",
      labelBg: isDark ? "#091a12" : "#ebf3ec",
    }),
    [isDark]
  );

  // Reset zoom handler
  const handleResetZoom = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
      setIsZoomed(false);
    }
  }, []);

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: {
          type: ColorType.Solid,
          color: chartColors.backgroundColor,
        },
        textColor: chartColors.textColor,
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: chartColors.gridColor },
        horzLines: { color: chartColors.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: chartColors.crosshairColor,
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: chartColors.labelBg,
        },
        horzLine: {
          color: chartColors.crosshairColor,
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: chartColors.labelBg,
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: timeframe === "1H" || timeframe === "1D",
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true },
    });

    chartRef.current = chart;

    // Track zoom/scroll state
    const onVisibleRangeChange = () => {
      setIsZoomed(true);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

    // Crosshair move handler for OHLC legend
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.seriesData || param.seriesData.size === 0) {
        setCrosshairInfo(null);
        return;
      }

      const info: CrosshairInfo = {};

      for (const [series, data] of param.seriesData.entries()) {
        if (series === volumeSeriesRef.current) {
          const d = data as { value?: number };
          info.volume = d.value;
        } else if ("open" in data) {
          // Candlestick/bar data
          const d = data as { open: number; high: number; low: number; close: number };
          info.open = d.open;
          info.high = d.high;
          info.low = d.low;
          info.close = d.close;
          info.isUp = d.close >= d.open;
        } else if ("value" in data && series !== volumeSeriesRef.current) {
          // Line/area data
          const d = data as { value: number };
          info.price = d.value;
        }
      }

      setCrosshairInfo(info);
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update chart options when theme or timeframe changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    chart.applyOptions({
      layout: {
        background: {
          type: ColorType.Solid,
          color: chartColors.backgroundColor,
        },
        textColor: chartColors.textColor,
      },
      grid: {
        vertLines: { color: chartColors.gridColor },
        horzLines: { color: chartColors.gridColor },
      },
      crosshair: {
        vertLine: {
          color: chartColors.crosshairColor,
          labelBackgroundColor: chartColors.labelBg,
        },
        horzLine: {
          color: chartColors.crosshairColor,
          labelBackgroundColor: chartColors.labelBg,
        },
      },
      timeScale: {
        timeVisible: timeframe === "1H" || timeframe === "1D",
      },
    });
  }, [chartColors, timeframe]);

  // Switch series type and set data
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove existing series
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }
    if (volumeSeriesRef.current) {
      chart.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }

    // Add volume series first (renders behind price series)
    if (lwcVolumeData.length > 0) {
      const volSeries = chart.addSeries(HistogramSeries, {
        color: isDark ? "rgba(148, 163, 184, 0.15)" : "rgba(100, 116, 139, 0.12)",
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      volSeries.setData(lwcVolumeData);
      volumeSeriesRef.current = volSeries;
    }

    // Add price series
    if (mode === "candlestick" && lwcOhlcData.length > 0) {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: chartColors.upColor,
        downColor: chartColors.downColor,
        borderDownColor: chartColors.downColor,
        borderUpColor: chartColors.upColor,
        wickDownColor: chartColors.downColor,
        wickUpColor: chartColors.upColor,
      });
      series.setData(lwcOhlcData);
      seriesRef.current = series;
    } else if (lwcLineData.length > 0) {
      const series = chart.addSeries(AreaSeries, {
        lineColor: chartColors.lineColor,
        topColor: chartColors.areaTopColor,
        bottomColor: chartColors.areaBottomColor,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: chartColors.lineColor,
        crosshairMarkerBackgroundColor: isDark ? "#060f08" : "#edfef2",
      });
      series.setData(lwcLineData);
      seriesRef.current = series;
    }

    // Fit content to view
    chart.timeScale().fitContent();
    setIsZoomed(false);
  }, [mode, lwcLineData, lwcOhlcData, lwcVolumeData, chartColors, isDark]);

  return (
    <div className="relative w-full">
      {/* OHLC Legend - shown on crosshair hover */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-0 px-1 py-0.5">
        {crosshairInfo && mode === "candlestick" && crosshairInfo.open != null && (
          <>
            <span className="text-[10px] text-muted-foreground">
              O <span className={crosshairInfo.isUp ? "text-primary" : "text-destructive"}>
                {formatPrice(crosshairInfo.open, displayCurrency)}
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              H <span className={crosshairInfo.isUp ? "text-primary" : "text-destructive"}>
                {formatPrice(crosshairInfo.high!, displayCurrency)}
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              L <span className={crosshairInfo.isUp ? "text-primary" : "text-destructive"}>
                {formatPrice(crosshairInfo.low!, displayCurrency)}
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              C <span className={crosshairInfo.isUp ? "text-primary" : "text-destructive"}>
                {formatPrice(crosshairInfo.close!, displayCurrency)}
              </span>
            </span>
          </>
        )}
        {crosshairInfo && mode === "line" && crosshairInfo.price != null && (
          <span className="text-[10px] text-muted-foreground">
            Price <span className="text-primary">
              {formatPrice(crosshairInfo.price, displayCurrency)}
            </span>
          </span>
        )}
        {crosshairInfo?.volume != null && (
          <span className="text-[10px] text-muted-foreground">
            Vol <span className="text-foreground/70">
              {formatCompact(crosshairInfo.volume)}
            </span>
          </span>
        )}
      </div>

      {/* Reset zoom button */}
      {isZoomed && (
        <button
          onClick={handleResetZoom}
          className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-lg bg-card/90 border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground active:bg-card"
          aria-label="Reset zoom"
        >
          <Maximize2 className="h-3 w-3" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      )}

      {/* Chart container */}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full"
      />
    </div>
  );
}
