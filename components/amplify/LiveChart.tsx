// components/amplify/LiveChart.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatMoney } from "./utils";

type Props = {
  symbol: "BTC" | "ETH" | "SOL";
  height?: number;
  displayCurrency: string;
  fxRate?: number;
};

type PricePoint = {
  t: number;
  y: number;
};

const MAX_POINTS = 60; // Keep last 60 data points (~3 minutes at 3s intervals)

export default function LiveChart({
  symbol,
  height = 210,
  displayCurrency,
  fxRate = 1,
}: Props) {
  const width = 640;
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to live price from Convex
  const priceData = useQuery(api.prices.getLatestOne, { symbol });

  // Store historical points for the live chart
  const [points, setPoints] = useState<PricePoint[]>([]);
  const lastPriceRef = useRef<number | null>(null);
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);

  // When price updates, add to history
  useEffect(() => {
    if (!priceData?.lastPrice || !priceData?.lastPublishTime) return;

    const price = priceData.lastPrice * fxRate;
    const timestamp = priceData.lastPublishTime * 1000; // Convert to ms

    // Check if price changed for flash animation
    if (lastPriceRef.current !== null && lastPriceRef.current !== price) {
      setPriceFlash(price > lastPriceRef.current ? "up" : "down");
      setTimeout(() => setPriceFlash(null), 300);
    }
    lastPriceRef.current = price;

    setPoints((prev) => {
      // Avoid duplicate timestamps
      if (prev.length > 0 && prev[prev.length - 1].t === timestamp) {
        return prev;
      }

      const next = [...prev, { t: timestamp, y: price }];

      // Keep only last MAX_POINTS
      if (next.length > MAX_POINTS) {
        return next.slice(-MAX_POINTS);
      }
      return next;
    });
  }, [priceData?.lastPrice, priceData?.lastPublishTime, fxRate]);

  // Compute chart path
  const computed = useMemo(() => {
    if (!points || points.length < 2) {
      return {
        pathD: "",
        minY: 0,
        maxY: 0,
        min: 0,
        max: 1,
        scaleX: (_i: number) => 0,
        scaleY: (_y: number) => height,
        lastX: width,
        lastY: height / 2,
      };
    }

    const ys = points.map((d) => d.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Add padding to prevent line hitting edges
    const range = maxY - minY;
    const pad = range > 0 ? range * 0.15 : maxY * 0.01;
    const min = minY - pad;
    const max = maxY + pad;

    const scaleX = (i: number) => (i / (points.length - 1)) * width;
    const scaleY = (y: number) => {
      const t = (y - min) / (max - min);
      return height - t * height;
    };

    const pathD = points
      .map((p, i) => {
        const x = scaleX(i);
        const y = scaleY(p.y);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    const lastX = scaleX(points.length - 1);
    const lastY = scaleY(points[points.length - 1].y);

    return { pathD, minY, maxY, min, max, scaleX, scaleY, lastX, lastY };
  }, [points, height]);

  // Current price display
  const currentPrice = points.length > 0 ? points[points.length - 1].y : null;
  const prevPrice = priceData?.prevPrice ? priceData.prevPrice * fxRate : null;

  // Price change from previous
  const priceChange = useMemo(() => {
    if (currentPrice === null || prevPrice === null || prevPrice === 0) {
      return null;
    }
    return ((currentPrice - prevPrice) / prevPrice) * 100;
  }, [currentPrice, prevPrice]);

  const isUp = (priceChange ?? 0) >= 0;

  // Loading state
  if (!priceData) {
    return (
      <div
        ref={wrapRef}
        className="relative flex w-full items-center justify-center"
        style={{ height }}
      >
        <div className="text-xs text-muted-foreground">
          Connecting to live feed…
        </div>
      </div>
    );
  }

  // Waiting for enough data
  if (points.length < 2) {
    return (
      <div
        ref={wrapRef}
        className="relative w-full rounded-3xl border bg-card/40"
        style={{ height }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="h-3 w-3 rounded-full bg-primary" />
              <div className="absolute inset-0 h-3 w-3 rounded-full bg-primary animate-ping" />
            </div>
            <span className="text-sm text-foreground/70">Live</span>
          </div>

          {currentPrice !== null && (
            <div className="mt-3 text-2xl font-semibold text-foreground">
              {formatMoney(currentPrice, displayCurrency)}
            </div>
          )}

          <div className="mt-2 text-xs text-muted-foreground">
            Collecting data points…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      {/* Live indicator */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <div className="relative">
          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
          <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-primary animate-ping opacity-75" />
        </div>
        <span className="text-[11px] font-medium text-primary">LIVE</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[210px] w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="liveLineFade" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--chart-1, rgb(16 185 129))"
              stopOpacity="0.28"
            />
            <stop
              offset="100%"
              stopColor="var(--chart-1, rgb(16 185 129))"
              stopOpacity="0.02"
            />
          </linearGradient>

          {/* Glow filter for the current price dot */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle grid */}
        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1="0"
            x2={width}
            y1={height * t}
            y2={height * t}
            stroke="currentColor"
            className="text-border"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        ))}

        {/* Area fill */}
        {computed.pathD && (
          <path
            d={`${computed.pathD} L ${computed.lastX} ${height} L 0 ${height} Z`}
            fill="url(#liveLineFade)"
          />
        )}

        {/* Main line */}
        {computed.pathD && (
          <path
            d={computed.pathD}
            fill="none"
            stroke="var(--chart-1, rgb(16 185 129))"
            strokeOpacity="0.9"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Current price dot with glow */}
        <circle
          cx={computed.lastX}
          cy={computed.lastY}
          r="6"
          fill="var(--chart-1, rgb(16 185 129))"
          filter="url(#glow)"
          className={priceFlash ? "animate-pulse" : ""}
        />

        {/* Inner dot */}
        <circle
          cx={computed.lastX}
          cy={computed.lastY}
          r="3"
          fill="hsl(var(--background))"
        />

        {/* Horizontal price line */}
        <line
          x1={0}
          x2={computed.lastX - 10}
          y1={computed.lastY}
          y2={computed.lastY}
          stroke="var(--chart-1, rgb(16 185 129))"
          strokeOpacity="0.3"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>

      {/* Current price label */}
      <div
        className={[
          "absolute right-3 top-1/2 -translate-y-1/2 rounded-2xl border px-3 py-2 shadow-fintech-sm backdrop-blur transition-colors duration-200",
          priceFlash === "up"
            ? "border-primary/40 bg-primary/10"
            : priceFlash === "down"
              ? "border-destructive/40 bg-destructive/10"
              : "border-border bg-card/70",
        ].join(" ")}
      >
        <div
          className={[
            "text-lg font-semibold transition-colors duration-200",
            priceFlash === "up"
              ? "text-primary"
              : priceFlash === "down"
                ? "text-destructive"
                : "text-foreground",
          ].join(" ")}
        >
          {currentPrice !== null
            ? formatMoney(currentPrice, displayCurrency)
            : "—"}
        </div>

        {priceChange !== null && (
          <div
            className={[
              "text-[11px] font-medium",
              isUp ? "text-primary" : "text-destructive",
            ].join(" ")}
          >
            {isUp ? "+" : ""}
            {priceChange.toFixed(3)}%
          </div>
        )}
      </div>

      {/* Low/High display */}
      <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-muted-foreground">
        <span>
          Low:{" "}
          {computed.minY ? formatMoney(computed.minY, displayCurrency) : "—"}
        </span>

        <span className="text-muted-foreground/70">
          {points.length} points • ~{Math.round((points.length * 3) / 60)}min
        </span>

        <span>
          High:{" "}
          {computed.maxY ? formatMoney(computed.maxY, displayCurrency) : "—"}
        </span>
      </div>
    </div>
  );
}
