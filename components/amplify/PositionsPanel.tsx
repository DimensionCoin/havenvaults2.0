"use client";

import React from "react";
import type { MultiplierPosition, PredictionPosition } from "./types";
import { formatMoney } from "./utils";
import { Trash2 } from "lucide-react";

type Props = {
  displayCurrency: string;
  multiplierPositions: MultiplierPosition[];
  predictionPositions: PredictionPosition[];
  onClearMultiplier: () => void;
  onClearPredictions: () => void;
};

export default function PositionsPanel({
  displayCurrency,
  multiplierPositions,
  predictionPositions,
  onClearMultiplier,
  onClearPredictions,
}: Props) {
  return (
    <div className="glass-panel bg-white/10 p-4 sm:p-5 lg:sticky lg:top-3">
      <div>
        <div className="text-sm font-semibold text-white/90">
          Your Positions
        </div>
        <div className="text-xs text-white/45">Multiplier + predictions</div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold tracking-wide text-white/70">
            MULTIPLIER
          </div>
          {multiplierPositions.length > 0 && (
            <button
              onClick={onClearMultiplier}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/60 hover:text-white/85"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        <div className="mt-2 space-y-2">
          {multiplierPositions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
              No multiplier positions yet.
            </div>
          ) : (
            multiplierPositions.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-white/10 bg-black/25 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white/85">
                    {p.tokenSymbol} • {p.leverage}x
                  </div>
                  <div className="text-[11px] text-white/45 whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleString()}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="text-white/50">
                    Buy-in
                    <div className="text-white/80 font-semibold">
                      {formatMoney(p.buyIn, displayCurrency)}
                    </div>
                  </div>
                  <div className="text-white/50">
                    Receive (est.)
                    <div className="text-white/80 font-semibold">
                      {p.estTokenQty.toFixed(6)} {p.tokenSymbol}
                    </div>
                  </div>
                  <div className="text-white/50">
                    Entry
                    <div className="text-white/80 font-semibold">
                      {formatMoney(p.entryPrice, displayCurrency)}
                    </div>
                  </div>
                  <div className="text-white/50">
                    Liquidation (est.)
                    <div className="text-white/80 font-semibold">
                      {formatMoney(p.estLiquidationPrice, displayCurrency)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold tracking-wide text-white/70">
            PREDICTIONS
          </div>
          {predictionPositions.length > 0 && (
            <button
              onClick={onClearPredictions}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/60 hover:text-white/85"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        <div className="mt-2 space-y-2">
          {predictionPositions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
              No prediction positions yet.
            </div>
          ) : (
            predictionPositions.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-white/10 bg-black/25 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white/85">
                    {p.side} • {p.tokenSymbol}
                  </div>
                  <div className="text-[11px] text-white/45 whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleString()}
                  </div>
                </div>

                <div className="mt-2 text-xs text-white/55">{p.title}</div>

                <div className="mt-2 text-xs text-white/50">
                  Stake
                  <div className="text-white/80 font-semibold">
                    {formatMoney(p.stake, displayCurrency)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
