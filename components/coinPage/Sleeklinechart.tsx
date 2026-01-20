"use client";

import React, { useMemo, useRef, useState } from "react";
import type { SleekPoint, TimeframeKey } from "./types";
import { clamp, formatMoneyNoCode, formatTimeLabel } from "./utils";

type SleekLineChartProps = {
  data: SleekPoint[];
  height?: number;
  displayCurrency: string;
  timeframe: TimeframeKey;
};

export function SleekLineChart({
  data,
  height = 210,
  timeframe,
}: SleekLineChartProps) {
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
        scaleX: () => 0,
        scaleY: () => height,
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

  const tooltip = useMemo(() => {
    if (!activePoint || activeX === null || activeY === null) return null;

    const leftPct = (activeX / width) * 100;
    const topPct = (activeY / height) * 100;

    const clampedLeft = clamp(leftPct, 6, 78);
    const clampedTop = clamp(topPct - 18, 4, 72);

    return {
      boxLeftPct: clampedLeft,
      boxTopPct: clampedTop,
      priceText: formatMoneyNoCode(activePoint.y),
      timeText: formatTimeLabel(activePoint.t, timeframe),
    };
  }, [activePoint, activeX, activeY, timeframe, height]);

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
              stopOpacity="0.22"
            />
            <stop
              offset="100%"
              stopColor="var(--chart-1, rgb(16 185 129))"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>

        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1="0"
            x2={width}
            y1={height * t}
            y2={height * t}
            stroke="currentColor"
            strokeOpacity="0.10"
            strokeWidth="1"
          />
        ))}

        {computed.pathD && (
          <path
            d={`${computed.pathD} L ${width} ${height} L 0 ${height} Z`}
            fill="url(#havenLineFade)"
          />
        )}

        {computed.pathD && (
          <path
            d={computed.pathD}
            fill="none"
            stroke="var(--chart-1, rgb(16 185 129))"
            strokeOpacity="0.9"
            strokeWidth="2.2"
          />
        )}

        {isHovering && activeX !== null && activeY !== null && (
          <>
            <line
              x1={activeX}
              x2={activeX}
              y1={0}
              y2={height}
              stroke="currentColor"
              strokeOpacity="0.12"
              strokeWidth="1"
            />
            <circle
              cx={activeX}
              cy={activeY}
              r="4.5"
              fill="var(--background)"
              fillOpacity="0.95"
              stroke="var(--chart-1, rgb(16 185 129))"
              strokeWidth="2"
            />
          </>
        )}

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

      {tooltip && isHovering && (
        <div
          className="pointer-events-none absolute rounded-2xl border bg-popover/80 px-3 py-2 text-popover-foreground shadow-fintech-lg backdrop-blur"
          style={{
            left: `${tooltip.boxLeftPct}%`,
            top: `${tooltip.boxTopPct}%`,
            maxWidth: "72%",
          }}
        >
          <div className="text-sm text-primary font-semibold">{tooltip.priceText}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {tooltip.timeText}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Low: {computed.minY ? formatMoneyNoCode(computed.minY) : "—"}
        </span>
        <span>
          High: {computed.maxY ? formatMoneyNoCode(computed.maxY) : "—"}
        </span>
      </div>
    </div>
  );
}
