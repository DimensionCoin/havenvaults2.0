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
    <div className="glass-panel bg-white/10 p-4 sm:p-5 lg:sticky lg:top-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white/90">
            Your Predictions
          </div>
          <div className="text-xs text-white/45">
            Positions will appear here once Predict launches.
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
          <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
          <span className="text-[11px] font-semibold text-white/70">
            Coming soon
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
            Loading…
          </div>
        ) : safeRows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
            No prediction positions yet.
          </div>
        ) : (
          safeRows.map((p) => {
            const stakeLocal = toLocal(p.stakeUsd);
            const pnlLocal = toLocal(p.pnlUsd ?? 0);

            const pnlClass =
              pnlLocal > 0
                ? "text-emerald-300"
                : pnlLocal < 0
                  ? "text-rose-300"
                  : "text-white/70";

            return (
              <div
                key={p.id}
                className="rounded-2xl border border-white/10 bg-black/25 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white/85 truncate">
                      {p.title}
                    </div>
                    <div className="mt-1 text-[11px] text-white/45">
                      {p.side} • {p.status}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/50">Stake</div>
                    <div className="text-sm font-semibold text-white/85">
                      {formatMoney(stakeLocal, displayCurrency)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="text-white/50">
                    P&amp;L
                    <div className={`font-semibold ${pnlClass}`}>
                      {pnlLocal >= 0 ? "+" : ""}
                      {formatMoney(pnlLocal, displayCurrency)}
                    </div>
                  </div>
                  <div className="text-white/50">
                    Placed
                    <div className="font-semibold text-white/80">
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
