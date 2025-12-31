"use client";

import React, { useMemo, useState } from "react";
import type {
  AmplifyTokenSymbol,
  PredictionMarket,
  PredictionPosition,
  PredictionTimeframe,
  PredictionSide,
} from "./types";
import { formatMoney } from "./utils";

type Props = {
  tokenSymbol: AmplifyTokenSymbol;
  displayCurrency: string;
  price: number;
  timeframes: PredictionTimeframe[];
  activeTimeframe: PredictionTimeframe;
  onChangeTimeframe: (tf: PredictionTimeframe) => void;
  onOpenMock: (pos: PredictionPosition) => void;
};

export default function PredictionMarketsPanel({
  tokenSymbol,
  displayCurrency,
  price,
  timeframes,
  activeTimeframe,
  onChangeTimeframe,
  onOpenMock,
}: Props) {
  const [stake, setStake] = useState<string>("");

  const stakeNum = useMemo(() => {
    const n = Number(stake);
    return Number.isFinite(n) ? n : 0;
  }, [stake]);

  const markets = useMemo<PredictionMarket[]>(() => {
    const round = (v: number) => {
      if (v > 10000) return Math.round(v / 100) * 100;
      if (v > 1000) return Math.round(v / 10) * 10;
      return Math.round(v);
    };

    const targetUp = round(price * 1.01);
    const targetDown = round(price * 0.99);

    const base: PredictionMarket[] = [
      {
        id: `m_up_${activeTimeframe}`,
        tokenSymbol,
        timeframe: activeTimeframe,
        title: `${tokenSymbol} settles ≥ ${formatMoney(
          targetUp,
          displayCurrency
        )} by close`,
        yesPct: 58,
        noPct: 42,
        endsInLabel: activeTimeframe === "hourly" ? "48m" : "15h 41m",
      },
      {
        id: `m_dn_${activeTimeframe}`,
        tokenSymbol,
        timeframe: activeTimeframe,
        title: `${tokenSymbol} trades ≤ ${formatMoney(
          targetDown,
          displayCurrency
        )} in window`,
        yesPct: 36,
        noPct: 64,
        endsInLabel: activeTimeframe === "hourly" ? "48m" : "15h 41m",
      },
    ];

    if (activeTimeframe === "monthly") {
      base[0].yesPct = 62;
      base[0].noPct = 38;
      base[1].yesPct = 41;
      base[1].noPct = 59;
      base[0].endsInLabel = "21d 3h";
      base[1].endsInLabel = "21d 3h";
    }
    if (activeTimeframe === "yearly") {
      base[0].yesPct = 71;
      base[0].noPct = 29;
      base[1].yesPct = 49;
      base[1].noPct = 51;
      base[0].endsInLabel = "214d";
      base[1].endsInLabel = "214d";
    }

    return base;
  }, [tokenSymbol, displayCurrency, price, activeTimeframe]);

  const open = (m: PredictionMarket, side: PredictionSide) => {
    if (stakeNum <= 0) return;

    const pos: PredictionPosition = {
      id: `pp_${Date.now()}`,
      tokenSymbol,
      marketId: m.id,
      title: m.title,
      side,
      stake: stakeNum,
      createdAt: new Date().toISOString(),
    };

    onOpenMock(pos);
    setStake("");
  };

  return (
    <div className="glass-panel bg-white/10 p-4 sm:p-5">
      <div>
        <div className="text-sm font-semibold text-white/90">
          Prediction Markets
        </div>
        <div className="text-xs text-white/45">Outcomes priced like odds.</div>
      </div>

      <div className="mt-3 flex items-center gap-1 rounded-2xl border border-white/10 bg-black/30 p-1">
        {timeframes.map((tf) => {
          const active = tf === activeTimeframe;
          return (
            <button
              key={tf}
              onClick={() => onChangeTimeframe(tf)}
              className={[
                "flex-1 rounded-xl px-2 py-2 text-[11px] font-semibold capitalize transition",
                active
                  ? "bg-white/10 text-white/90 border border-white/10"
                  : "text-white/50 hover:text-white/80",
              ].join(" ")}
            >
              {tf}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <label className="text-xs text-white/50">Stake</label>
        <div className="mt-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
          <span className="text-xs text-white/50 px-2">{displayCurrency}</span>
          <input
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full bg-transparent text-sm text-white/90 outline-none"
          />
          <button
            onClick={() => setStake("10")}
            className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white/90"
          >
            10
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {markets.map((m) => (
          <div
            key={m.id}
            className="rounded-2xl border border-white/10 bg-black/25 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-white/85">
                {m.title}
              </div>
              <div className="text-xs text-white/45 whitespace-nowrap">
                Ends in {m.endsInLabel}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                disabled={stakeNum <= 0}
                onClick={() => open(m, "YES")}
                className={[
                  "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                  stakeNum > 0
                    ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20"
                    : "border-white/10 bg-white/5 text-white/35 cursor-not-allowed",
                ].join(" ")}
              >
                {m.yesPct}%{" "}
                <div className="text-[11px] font-semibold text-white/60">
                  Yes
                </div>
              </button>

              <button
                disabled={stakeNum <= 0}
                onClick={() => open(m, "NO")}
                className={[
                  "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                  stakeNum > 0
                    ? "border-rose-300/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
                    : "border-white/10 bg-white/5 text-white/35 cursor-not-allowed",
                ].join(" ")}
              >
                {m.noPct}%{" "}
                <div className="text-[11px] font-semibold text-white/60">
                  No
                </div>
              </button>
            </div>

            {stakeNum > 0 && (
              <div className="mt-2 text-[11px] text-white/35">
                Stake:{" "}
                <span className="text-white/70 font-semibold">
                  {formatMoney(stakeNum, displayCurrency)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
