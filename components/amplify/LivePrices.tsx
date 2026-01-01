"use client";

import React, { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

function money(n: number) {
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : 2,
  });
}

type Row = {
  symbol: string;
  lastPrice: number;
  prevPrice: number;
  lastPublishTime: number;
  updatedAt: number;
};

export default function LivePrices() {
  const rows = useQuery(api.prices.getLatest);

  const bySymbol = useMemo(() => {
    const map = new Map<string, Row>();
    (rows ?? []).forEach((r) => map.set(r.symbol, r as unknown as Row));
    return map;
  }, [rows]);

  const order = ["BTC", "ETH", "SOL"];

  return (
    <div className="glass-panel bg-white/10 px-4 py-4 sm:px-5 sm:py-5">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
        Live oracle prices
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {order.map((sym) => {
          const r = bySymbol.get(sym);
          const last = r?.lastPrice ?? 0;
          const prev = r?.prevPrice ?? last;
          const diff = last - prev;
          const pct = prev > 0 ? (diff / prev) * 100 : 0;
          const up = diff >= 0;

          return (
            <div
              key={sym}
              className="rounded-3xl border border-white/10 bg-black/45 px-4 py-3 shadow-[0_18px_55px_rgba(0,0,0,0.45)]"
            >
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold tracking-[0.22em] text-white/60">
                  {sym}
                </div>

                <div
                  className={[
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    up
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-rose-500/15 text-rose-200",
                  ].join(" ")}
                >
                  {up ? "+" : "-"}
                  {Math.abs(pct).toFixed(2)}%
                </div>
              </div>

              <div className="mt-2 text-2xl font-semibold tracking-tight text-white/92">
                {rows === undefined ? "…" : money(last)}
              </div>

              <div className="mt-1 text-[11px] text-white/45">
                {rows === undefined
                  ? "Connecting…"
                  : `Δ ${up ? "+" : "-"}${money(Math.abs(diff))}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
