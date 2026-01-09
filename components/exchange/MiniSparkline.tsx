// components/exchange/MiniSparkline.tsx
"use client";

import React, { useMemo, useId } from "react";

type MiniSparklineProps = {
  data: number[];
  isPositive: boolean;
  width?: number;
  height?: number;
  className?: string;
};

const MiniSparkline: React.FC<MiniSparklineProps> = ({
  data,
  isPositive,
  width = 80,
  height = 32,
  className = "",
}) => {
  const uid = useId();

  const path = useMemo(() => {
    if (!data || data.length < 2) return "";

    const validData = data.filter((d) => Number.isFinite(d));
    if (validData.length < 2) return "";

    const min = Math.min(...validData);
    const max = Math.max(...validData);
    const range = max - min || 1;

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = validData.map((value, i) => {
      const x = padding + (i / (validData.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - min) / range) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return `M ${points.join(" L ")}`;
  }, [data, width, height]);

  if (!path) return null;

  // ✅ token-based colors (no hardcoded hex)
  // positive: primary mint
  // negative: destructive
  const strokeVar = isPositive ? "var(--primary)" : "var(--destructive)";
  const gradId = `sparkGrad-${uid}-${isPositive ? "up" : "down"}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={["overflow-visible", className].join(" ")}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeVar} stopOpacity="0.22" />
          <stop offset="100%" stopColor={strokeVar} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Fill area */}
      <path
        d={`${path} L ${width - 2},${height - 2} L 2,${height - 2} Z`}
        fill={`url(#${gradId})`}
      />

      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={strokeVar}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default MiniSparkline;
