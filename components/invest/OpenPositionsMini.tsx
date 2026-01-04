// components/invest/OpenPositionsMini.tsx
"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useBalance } from "@/providers/BalanceProvider";

const formatUsd = (n?: number | null) =>
  n === undefined || n === null || Number.isNaN(n)
    ? "$0.00"
    : `$${Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const calcSizeTokens = (sizeUsd?: number, entryUsd?: number) => {
  const s = typeof sizeUsd === "number" ? sizeUsd : 0;
  const e = typeof entryUsd === "number" ? entryUsd : 0;
  if (!Number.isFinite(s) || !Number.isFinite(e) || s <= 0 || e <= 0) return 0;
  return s / e;
};

const OpenPositionsMini: React.FC = () => {
  const { boosterTakeHomeUsd, boosterPositionsCount, boosterPositions } =
    useBalance();

  // ✅ FIX: memoize rows so it’s a stable reference for deps
  const rows = useMemo(() => {
    return Array.isArray(boosterPositions) ? boosterPositions : [];
  }, [boosterPositions]);

  const hasPositions = boosterPositionsCount > 0 && rows.length > 0;

  const topRows = useMemo(() => {
    const sorted = [...rows].sort(
      (a, b) => (b.sizeUsd || 0) - (a.sizeUsd || 0)
    );
    return sorted.slice(0, 3);
  }, [rows]);

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
          Multiplier positions
        </p>

        <span className="text-[11px] text-zinc-500">
          {boosterPositionsCount} position
          {boosterPositionsCount === 1 ? "" : "s"}
        </span>
      </div>

      {!hasPositions ? (
        <Link href="/amplify" className="block" aria-label="Open Amplify page">
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/25 py-6 text-center transition hover:bg-white/5">
            <p className="text-sm font-medium text-zinc-200">
              No open positions
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">
              Boosted positions will show here when you open one.
            </p>
          </div>
        </Link>
      ) : (
        <Link href="/amplify" className="block" aria-label="Open Amplify page">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 transition hover:bg-white/5">
            {/* take-home summary */}
            <div className="flex items-center justify-between px-4 py-3 text-white">
              <p className="text-[12px] text-zinc-400">Take-home</p>
              <p className="text-[13px] font-semibold text-white">
                {formatUsd(boosterTakeHomeUsd)}
              </p>
            </div>

            <div className="border-t border-white/8" />

            {/* mini list (no inner links — whole card is clickable) */}
            {topRows.map((p, idx) => {
              const sideLabel = p.isLong ? "LONG" : "SHORT";
              const sizeTokens = calcSizeTokens(p.sizeUsd, p.entryUsd);

              return (
                <div
                  key={p.id}
                  className={[
                    "flex items-center justify-between gap-3 px-4 py-4 text-white",
                    idx !== 0 ? "border-t border-white/8" : "",
                  ].join(" ")}
                >
                  {/* Left */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">
                        {p.symbol}
                      </span>
                      <span
                        className={[
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          p.isLong
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                            : "border-red-500/25 bg-red-500/10 text-red-200",
                        ].join(" ")}
                      >
                        {sideLabel}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] text-zinc-400">
                      {sizeTokens > 0
                        ? `${sizeTokens.toFixed(6)} ${p.symbol}`
                        : `Size ${formatUsd(p.sizeUsd)} · Entry ${formatUsd(
                            p.entryUsd
                          )}`}
                    </p>
                  </div>

                  {/* Right */}
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold text-white">
                      {formatUsd(p.sizeUsd)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Collateral {formatUsd(p.collateralUsd)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Link>
      )}
    </div>
  );
};

export default OpenPositionsMini;
