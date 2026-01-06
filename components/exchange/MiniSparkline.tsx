// components/exchange/MiniSparkline.tsx
"use client";

import React, { useMemo } from "react";

type MiniSparklineProps = {
  data: number[];
  isPositive: boolean;
  width?: number;
  height?: number;
};

const MiniSparkline: React.FC<MiniSparklineProps> = ({
  data,
  isPositive,
  width = 80,
  height = 32,
}) => {
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

  const strokeColor = isPositive ? "#10b981" : "#f43f5e";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient
          id={`sparkGrad-${isPositive ? "up" : "down"}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Fill area */}
      <path
        d={`${path} L ${width - 2},${height - 2} L 2,${height - 2} Z`}
        fill={`url(#sparkGrad-${isPositive ? "up" : "down"})`}
      />

      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default MiniSparkline;
