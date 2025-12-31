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
        return (
          <button
            key={tf}
            onClick={() => onChange(tf)}
            className={[
              "px-2.5 py-1.5 text-[11px] font-semibold rounded-xl transition",
              isActive
                ? "bg-white/10 text-white/90 border border-white/10"
                : "text-white/50 hover:text-white/80",
            ].join(" ")}
          >
            {tf}
          </button>
        );
      })}
    </div>
  );
}
