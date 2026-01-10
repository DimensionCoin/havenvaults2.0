// components/amplify/PredictionPositions.tsx
"use client";

import React, { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { formatMoney, safeNum } from "./utils";

export type PredictionPositionRow = {
  id: string;
  title: string;
  side: "YES" | "NO";
  stakeUsd: number;
  createdAt: string; // iso string
  status: "open" | "settled" | "canceled";
  pnlUsd?: number;
};

type Props = {
  displayCurrency: string;
  fxRate: number; // USD -> display
  loading?: boolean;
  rows?: PredictionPositionRow[];
};

export default function PredictionPositions({
  displayCurrency,
  fxRate,
  loading = false,
  rows = [],
}: Props) {
  const toLocal = (usd: number) => safeNum(usd, 0) * (safeNum(fxRate, 1) || 1);

  const safeRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);

  return (
    <div className="glass-panel-soft p-4 sm:p-5 lg:sticky lg:top-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            Your Predictions
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Positions will appear here once Predict launches.
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border bg-card/50 px-3 py-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold text-foreground/80">
            Coming soon
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="rounded-2xl border bg-card/40 p-3 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : safeRows.length === 0 ? (
          <div className="rounded-2xl border bg-card/40 p-3 text-xs text-muted-foreground">
            No prediction positions yet.
          </div>
        ) : (
          safeRows.map((p) => {
            const stakeLocal = toLocal(p.stakeUsd);
            const pnlLocal = toLocal(p.pnlUsd ?? 0);

            const pnlClass =
              pnlLocal > 0
                ? "text-primary"
                : pnlLocal < 0
                  ? "text-destructive"
                  : "text-muted-foreground";

            return (
              <div key={p.id} className="rounded-2xl border bg-card/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {p.title}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span
                        className={[
                          "inline-flex items-center rounded-full border px-2 py-0.5 font-semibold",
                          p.side === "YES"
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-destructive/30 bg-destructive/10 text-destructive",
                        ].join(" ")}
                      >
                        {p.side}
                      </span>

                      <span className="inline-flex items-center rounded-full border bg-card/50 px-2 py-0.5 font-semibold text-foreground/70">
                        {p.status}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-xs text-muted-foreground">Stake</div>
                    <div className="text-sm font-semibold text-foreground">
                      {formatMoney(stakeLocal, displayCurrency)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="text-muted-foreground">
                    P&amp;L
                    <div className={`font-semibold ${pnlClass}`}>
                      {pnlLocal >= 0 ? "+" : ""}
                      {formatMoney(pnlLocal, displayCurrency)}
                    </div>
                  </div>

                  <div className="text-muted-foreground">
                    Placed
                    <div className="font-semibold text-foreground/80">
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
