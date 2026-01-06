"use client";

import React, { useMemo, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useBalance } from "@/providers/BalanceProvider";
import { findTokenBySymbol } from "@/lib/tokenConfig";

/* ───────── TYPES ───────── */

type PositionView = {
  id?: string | null;
  symbol?: string | null;
  isLong?: boolean | null;

  // Value fields (USD)
  spotValueUsd?: number | string | null;
  sizeUsd?: number | string | null;
  collateralUsd?: number | string | null;
  pnlUsd?: number | string | null;
  entryUsd?: number | string | null;

  // Token qty (preferred)
  sizeTokens?: number | string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asPositionView(row: unknown): PositionView {
  if (!isRecord(row)) return {};
  const r = row;

  return {
    id: typeof r.id === "string" ? r.id : null,
    symbol: typeof r.symbol === "string" ? r.symbol : null,
    isLong: typeof r.isLong === "boolean" ? r.isLong : null,

    spotValueUsd:
      typeof r.spotValueUsd === "number" || typeof r.spotValueUsd === "string"
        ? (r.spotValueUsd as number | string)
        : null,

    sizeUsd:
      typeof r.sizeUsd === "number" || typeof r.sizeUsd === "string"
        ? (r.sizeUsd as number | string)
        : null,

    collateralUsd:
      typeof r.collateralUsd === "number" || typeof r.collateralUsd === "string"
        ? (r.collateralUsd as number | string)
        : null,

    pnlUsd:
      typeof r.pnlUsd === "number" || typeof r.pnlUsd === "string"
        ? (r.pnlUsd as number | string)
        : null,

    entryUsd:
      typeof r.entryUsd === "number" || typeof r.entryUsd === "string"
        ? (r.entryUsd as number | string)
        : null,

    sizeTokens:
      typeof r.sizeTokens === "number" || typeof r.sizeTokens === "string"
        ? (r.sizeTokens as number | string)
        : null,
  };
}

/**
 * ✅ Formats like "$15.00" / "€15.00" / "£15.00"
 * ❌ Never shows "CA$" or "USD" etc.
 *
 * Uses Intl parts, keeps the currency SYMBOL only.
 */
function formatMoneyNoCode(n: number, currency: string) {
  const c = (currency || "USD").toUpperCase();
  const value = Number.isFinite(n) ? n : 0;

  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      currencyDisplay: "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).formatToParts(value);

    // Keep "$", "€", "£", etc. Remove longer currency displays like "CA$"
    return parts
      .filter((p) => p.type !== "currency" || p.value.length <= 2)
      .map((p) => p.value)
      .join("")
      .trim();
  } catch {
    const abs = Number.isFinite(value) ? value : 0;
    return `$${abs.toFixed(2)}`;
  }
}

function calcSizeTokensFromEntry(positionValueUsd: number, entryUsd: number) {
  if (!Number.isFinite(positionValueUsd) || !Number.isFinite(entryUsd))
    return 0;
  if (positionValueUsd <= 0 || entryUsd <= 0) return 0;
  return positionValueUsd / entryUsd;
}

/* ───────── COMPONENT ───────── */

const OpenPositionsMini: React.FC = () => {
  const balance = useBalance();
  const bal: Record<string, unknown> = isRecord(balance) ? balance : {};

  const boosterPositionsCount = safeNum(bal.boosterPositionsCount, 0);
  const boosterPositions = bal.boosterPositions;

  const displayCurrency = safeStr(bal.displayCurrency, "USD").trim() || "USD";
  const fxRate = safeNum(bal.fxRate, 1) || 1;

  const usdToLocal = useCallback(
    (usd: number) => safeNum(usd, 0) * fxRate,
    [fxRate]
  );

  const rows = useMemo(() => {
    if (!Array.isArray(boosterPositions)) return [];
    return boosterPositions.map(asPositionView);
  }, [boosterPositions]);

  const hasPositions = boosterPositionsCount > 0 && rows.length > 0;

  const takeHomeUsd = useMemo(() => {
    return rows.reduce((sum, r) => {
      const collateral = safeNum(r.collateralUsd, 0);
      const pnl = safeNum(r.pnlUsd, 0);
      return sum + collateral + pnl;
    }, 0);
  }, [rows]);

  const takeHomeLocal = usdToLocal(takeHomeUsd);

  const topRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const aVal = safeNum(a.spotValueUsd, safeNum(a.sizeUsd, 0));
      const bVal = safeNum(b.spotValueUsd, safeNum(b.sizeUsd, 0));
      return bVal - aVal;
    });
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
                {formatMoneyNoCode(takeHomeLocal, displayCurrency)}
              </p>
            </div>

            <div className="border-t border-white/8" />

            {topRows.map((p, idx) => {
              const symbol = safeStr(p.symbol, "SOL").toUpperCase();
              const meta = findTokenBySymbol(symbol);

              const positionValueUsd = safeNum(
                p.spotValueUsd,
                safeNum(p.sizeUsd, 0)
              );

              const collateralUsd = safeNum(p.collateralUsd, 0);
              const pnlUsd = safeNum(p.pnlUsd, 0);
              const entryUsd = safeNum(p.entryUsd, 0);

              const positionValueLocal = usdToLocal(positionValueUsd);
              const collateralLocal = usdToLocal(collateralUsd);
              const pnlLocal = usdToLocal(pnlUsd);

              const sizeTokens = safeNum(
                p.sizeTokens,
                calcSizeTokensFromEntry(positionValueUsd, entryUsd)
              );

              const pnlClass =
                pnlLocal > 0
                  ? "text-emerald-300"
                  : pnlLocal < 0
                    ? "text-red-300"
                    : "text-zinc-400";

              return (
                <div
                  key={safeStr(p.id, `${symbol}-${idx}`)}
                  className={[
                    "flex items-start justify-between gap-3 px-4 py-4 text-white",
                    idx !== 0 ? "border-t border-white/8" : "",
                  ].join(" ")}
                >
                  {/* LEFT */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <Image
                        src={meta?.logo || "/placeholder.svg"}
                        alt={`${symbol} logo`}
                        width={22}
                        height={22}
                        className="h-5 w-5 rounded-full border border-white/15 bg-white/5"
                      />

                      <span className="text-[13px] font-semibold">
                        {symbol}
                      </span>

                      <span className="text-[13px] font-semibold text-white/90">
                        {formatMoneyNoCode(positionValueLocal, displayCurrency)}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] text-zinc-400">
                      {sizeTokens > 0
                        ? `${sizeTokens.toFixed(6)} ${symbol}`
                        : "—"}
                    </p>
                  </div>

                  {/* RIGHT */}
                  <div className="shrink-0 text-right">
                    {/* Collateral */}
                    <p className="text-[13px] font-semibold text-white">
                      {formatMoneyNoCode(collateralLocal, displayCurrency)}
                    </p>

                    {/* P&L label LEFT of value */}
                    <div className="mt-2 inline-flex items-baseline gap-2">
                      <span className="text-[11px] text-zinc-400">P&amp;L</span>
                      <span
                        className={["text-[13px] font-semibold", pnlClass].join(
                          " "
                        )}
                      >
                        {pnlLocal >= 0 ? "+" : ""}
                        {formatMoneyNoCode(pnlLocal, displayCurrency)}
                      </span>
                    </div>
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
