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
    <div className="inline-flex items-center gap-1 rounded-2xl border border-border/60 bg-card/40 p-1 backdrop-blur">
      {timeframes.map((tf) => {
        const isActive = tf === active;
        const isLive = tf === "LIVE";

        return (
          <button
            key={tf}
            onClick={() => onChange(tf)}
            className={[
              "px-2.5 py-1.5 text-[11px] font-semibold rounded-xl transition flex items-center gap-1.5",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              isActive
                ? isLive
                  ? "bg-primary/15 text-primary border border-primary/25 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
                  : "bg-foreground/10 text-foreground border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
            ].join(" ")}
          >
            {isLive && (
              <span className="relative flex h-2 w-2">
                <span
                  className={[
                    "absolute inline-flex h-full w-full rounded-full opacity-75",
                    isActive
                      ? "bg-primary animate-ping"
                      : "bg-muted-foreground/30",
                  ].join(" ")}
                />
                <span
                  className={[
                    "relative inline-flex h-2 w-2 rounded-full",
                    isActive ? "bg-primary" : "bg-muted-foreground/60",
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
