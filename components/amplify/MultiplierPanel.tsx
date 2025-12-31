"use client";

import React, { useMemo, useState } from "react";
import type {
  AmplifyTokenSymbol,
  LeverageOption,
  MultiplierPosition,
} from "./types";
import { estimateLiquidationPrice, formatMoney } from "./utils";
import { ArrowUpRight } from "lucide-react";

type Props = {
  tokenSymbol: AmplifyTokenSymbol;
  displayCurrency: string;
  depositBalance: number; // ✅ useBalance().usdcUsd (display currency)
  balanceLoading: boolean;
  price: number; // display currency
  onOpenMock: (pos: MultiplierPosition) => void;
};

const leverageOptions: LeverageOption[] = [1.5, 2];

export default function MultiplierPanel({
  tokenSymbol,
  displayCurrency,
  depositBalance,
  balanceLoading,
  price,
  onOpenMock,
}: Props) {
  const [buyIn, setBuyIn] = useState<string>("");
  const [lev, setLev] = useState<LeverageOption>(1.5);

  const buyInNum = useMemo(() => {
    const n = Number(buyIn);
    return Number.isFinite(n) ? n : 0;
  }, [buyIn]);

  const estTokenQty = useMemo(() => {
    if (!price || buyInNum <= 0) return 0;
    return (buyInNum * lev) / price;
  }, [buyInNum, lev, price]);

  const liq = useMemo(() => estimateLiquidationPrice(price, lev), [price, lev]);

  const canSubmit = buyInNum > 0 && buyInNum <= depositBalance;

  return (
    <div className="glass-panel bg-white/10 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white/90">Multiplier</div>
          <div className="text-xs text-white/45">
            Increase exposure with clear liquidation risk.
          </div>
        </div>

        <div className="text-xs text-white/45">
          Available:{" "}
          <span className="text-white/80 font-semibold">
            {balanceLoading
              ? "…"
              : formatMoney(depositBalance, displayCurrency)}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs text-white/50">Buy-in</label>
          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
            <span className="text-xs text-white/50 px-2">
              {displayCurrency}
            </span>
            <input
              value={buyIn}
              onChange={(e) => setBuyIn(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full bg-transparent text-sm text-white/90 outline-none"
            />
            <button
              onClick={() => setBuyIn(String(Math.min(depositBalance, 50)))}
              className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white/90"
            >
              Quick
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-white/50">Multiplier</label>
          <div className="mt-1 flex gap-2">
            {leverageOptions.map((opt) => {
              const active = opt === lev;
              return (
                <button
                  key={opt}
                  onClick={() => setLev(opt)}
                  className={[
                    "flex-1 rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                      : "border-white/10 bg-black/25 text-white/70 hover:text-white/90",
                  ].join(" ")}
                >
                  {opt}x
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-white/45">
                You receive (est.)
              </div>
              <div className="mt-0.5 text-sm font-semibold text-white/85">
                {estTokenQty ? `${estTokenQty.toFixed(6)} ${tokenSymbol}` : `—`}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-white/45">
                Liquidation (est.)
              </div>
              <div className="mt-0.5 text-sm font-semibold text-white/85">
                {liq ? formatMoney(liq, displayCurrency) : "—"}
              </div>
            </div>
          </div>

          <div className="mt-3 text-[11px] text-white/35">
            Placeholder math — replace with real perp engine values later.
          </div>
        </div>

        <button
          disabled={!canSubmit}
          onClick={() => {
            const pos: MultiplierPosition = {
              id: `mp_${Date.now()}`,
              tokenSymbol,
              leverage: lev,
              buyIn: buyInNum,
              entryPrice: price,
              estTokenQty,
              estLiquidationPrice: liq,
              createdAt: new Date().toISOString(),
            };
            onOpenMock(pos);
            setBuyIn("");
          }}
          className={[
            "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2",
            canSubmit
              ? "bg-emerald-500/20 border border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25"
              : "bg-white/5 border border-white/10 text-white/35 cursor-not-allowed",
          ].join(" ")}
        >
          Open position <ArrowUpRight className="h-4 w-4" />
        </button>

        {!canSubmit && buyInNum > 0 && buyInNum > depositBalance && (
          <div className="text-xs text-rose-200/80">
            Buy-in exceeds your available balance.
          </div>
        )}
      </div>
    </div>
  );
}
