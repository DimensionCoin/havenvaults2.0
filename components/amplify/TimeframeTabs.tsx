// components/amplify/TimeframeTabs.tsx
"use client";

import React from "react";
import type { ChartTimeframe } from "./types";

type Props = {
  timeframes: ChartTimeframe[];
  active: ChartTimeframe;
  onChange: (tf: ChartTimeframe) => void;
};

export default function TimeframeTabs({ timeframes, active, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-black/30 p-1">
      {timeframes.map((tf) => {
        const isActive = tf === active;
        const isLive = tf === "LIVE";

        return (
          <button
            key={tf}
            onClick={() => onChange(tf)}
            className={[
              "px-2.5 py-1.5 text-[11px] font-semibold rounded-xl transition flex items-center gap-1.5",
              isActive
                ? isLive
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-white/10 text-white/90 border border-white/10"
                : "text-white/50 hover:text-white/80",
            ].join(" ")}
          >
            {isLive && (
              <span className="relative flex h-2 w-2">
                <span
                  className={[
                    "absolute inline-flex h-full w-full rounded-full opacity-75",
                    isActive ? "bg-emerald-400 animate-ping" : "bg-white/30",
                  ].join(" ")}
                />
                <span
                  className={[
                    "relative inline-flex h-2 w-2 rounded-full",
                    isActive ? "bg-emerald-400" : "bg-white/50",
                  ].join(" ")}
                />
              </span>
            )}
            {tf}
          </button>
        );
      })}
    </div>
  );
}
