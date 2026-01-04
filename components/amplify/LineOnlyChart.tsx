"use client";

import React, { useMemo, useRef, useState } from "react";
import type { ChartTimeframe } from "./types";
import { formatMoney } from "./utils";

type Point = { t: number; y: number };

type Props = {
  data: Point[];
  height?: number;
  displayCurrency: string;
  timeframe: ChartTimeframe;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatTimeLabel(t: number, tf: ChartTimeframe) {
  const d = new Date(t);

  if (tf === "1H" || tf === "1D") {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (tf === "1W" || tf === "1M") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  if (tf === "1Y" || tf === "ALL") {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
  }

  return d.toLocaleString();
}

export default function LineOnlyChart({
  data,
  height = 210,
  displayCurrency,
  timeframe,
}: Props) {
  const width = 640;
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  const computed = useMemo(() => {
    if (!data || data.length < 2) {
      return {
        pathD: "",
        minY: 0,
        maxY: 0,
        min: 0,
        max: 1,
        scaleX: (_i: number) => 0,
        scaleY: (_y: number) => height,
      };
    }

    const ys = data.map((d) => d.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const pad = (maxY - minY) * 0.15 || 1;
    const min = minY - pad;
    const max = maxY + pad;

    const scaleX = (i: number) => (i / (data.length - 1)) * width;
    const scaleY = (y: number) => {
      const t = (y - min) / (max - min);
      return height - t * height;
    };

    const pathD = data
      .map((p, i) => {
        const x = scaleX(i);
        const y = scaleY(p.y);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    return { pathD, minY, maxY, min, max, scaleX, scaleY };
  }, [data, height]);

  const activeIdx =
    hoverIdx === null ? null : clamp(hoverIdx, 0, Math.max(0, data.length - 1));

  const activePoint = activeIdx !== null ? data[activeIdx] : null;

  const activeX = activeIdx !== null ? computed.scaleX(activeIdx) : null;

  const activeY = activePoint ? computed.scaleY(activePoint.y) : null;

  const onPointerMove = (e: React.PointerEvent) => {
    if (!wrapRef.current || data.length < 2) return;

    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = rect.width > 0 ? px / rect.width : 0;
    const idx = Math.round(frac * (data.length - 1));

    setIsHovering(true);
    setHoverIdx(clamp(idx, 0, data.length - 1));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onPointerMove(e);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {}
  };

  const onLeave = () => {
    setIsHovering(false);
    setHoverIdx(null);
  };

  // tooltip positioning (in % so it scales)
  const tooltip = useMemo(() => {
    if (!activePoint || activeX === null || activeY === null) return null;

    const leftPct = (activeX / width) * 100;
    const topPct = (activeY / height) * 100;

    // clamp tooltip in a “nice” zone (so it doesn’t go off screen)
    const clampedLeft = clamp(leftPct, 6, 78);
    const clampedTop = clamp(topPct - 18, 4, 72);

    return {
      leftPct,
      topPct,
      boxLeftPct: clampedLeft,
      boxTopPct: clampedTop,
      priceText: formatMoney(activePoint.y, displayCurrency),
      timeText: formatTimeLabel(activePoint.t, timeframe),
    };
  }, [activePoint, activeX, activeY, displayCurrency, timeframe]);

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[210px] w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="havenLineFade" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--chart-1, rgb(16 185 129))"
              stopOpacity="0.26"
            />
            <stop
              offset="100%"
              stopColor="var(--chart-1, rgb(16 185 129))"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>

        {/* subtle grid */}
        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1="0"
            x2={width}
            y1={height * t}
            y2={height * t}
            stroke="white"
            strokeOpacity="0.06"
            strokeWidth="1"
          />
        ))}

        {/* area fill */}
        {computed.pathD && (
          <path
            d={`${computed.pathD} L ${width} ${height} L 0 ${height} Z`}
            fill="url(#havenLineFade)"
          />
        )}

        {/* line */}
        {computed.pathD && (
          <path
            d={computed.pathD}
            fill="none"
            stroke="var(--chart-1, rgb(16 185 129))"
            strokeOpacity="0.85"
            strokeWidth="2.2"
          />
        )}

        {/* crosshair + dot */}
        {isHovering && activeX !== null && activeY !== null && (
          <>
            <line
              x1={activeX}
              x2={activeX}
              y1={0}
              y2={height}
              stroke="white"
              strokeOpacity="0.10"
              strokeWidth="1"
            />
            <circle
              cx={activeX}
              cy={activeY}
              r="4.5"
              fill="black"
              fillOpacity="0.9"
              stroke="var(--chart-1, rgb(16 185 129))"
              strokeWidth="2"
            />
          </>
        )}

        {/* capture layer (mouse + touch) */}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onLeave}
          onPointerCancel={onLeave}
        />
      </svg>

      {/* tooltip overlay */}
      {tooltip && isHovering && (
        <>
          {/* pointer dot helper (optional) */}
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${tooltip.leftPct}%`,
              top: `${tooltip.topPct}%`,
              transform: "translate(-50%, -50%)",
            }}
          />

          <div
            className="pointer-events-none absolute rounded-2xl border border-white/10 bg-black/85 px-3 py-2 shadow-xl backdrop-blur-sm"
            style={{
              left: `${tooltip.boxLeftPct}%`,
              top: `${tooltip.boxTopPct}%`,
              transform: "translate(-0%, -0%)",
              maxWidth: "72%",
            }}
          >
            <div className="text-sm font-semibold text-white/90">
              {tooltip.priceText}
            </div>
            <div className="mt-0.5 text-[11px] text-white/45">
              {tooltip.timeText}
            </div>
          </div>
        </>
      )}

      <div className="mt-2 px-2 flex items-center justify-between text-[11px] text-white/35">
        <span>Low: {computed.minY ? computed.minY.toFixed(2) : "—"}</span>
        <span>High: {computed.maxY ? computed.maxY.toFixed(2) : "—"}</span>
      </div>
    </div>
  );
}
