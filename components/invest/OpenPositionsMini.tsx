// components/invest/OpenPositionsMini.tsx
"use client";

import React, { useMemo, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useBalance } from "@/providers/BalanceProvider";
import { findTokenBySymbol } from "@/lib/tokenConfig";

/* ───────── TYPES ───────── */

type PositionView = {
  id?: string | null;
  symbol?: string | null;
  isLong?: boolean | null;

  spotValueUsd?: number | string | null;
  sizeUsd?: number | string | null;
  collateralUsd?: number | string | null;
  pnlUsd?: number | string | null;
  entryUsd?: number | string | null;

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
 * "$15.00" / "€15.00" / "£15.00"
 * never "CA$" etc.
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

    return parts
      .filter((p) => p.type !== "currency" || p.value.length <= 2)
      .map((p) => p.value)
      .join("")
      .trim();
  } catch {
    return `$${value.toFixed(2)}`;
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
  const router = useRouter();

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

  const targetUrl = "/amplify?tab=multiplier";

  const goToMultiplier = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(targetUrl);
  };

  return (
    <div className="mt-6">
      {/* Header matches Invest page style */}
      <div className="mb-2 flex items-end justify-between gap-3 px-1">
        <div>
          <div className="haven-kicker">Multiplier positions</div>
          <div className="text-sm font-semibold text-foreground">
            {hasPositions ? "Open positions" : "No open positions"}
          </div>
        </div>

        <span className="haven-pill">
          {boosterPositionsCount} position
          {boosterPositionsCount === 1 ? "" : "s"}
        </span>
      </div>

      {/* Whole card is one tappable target (simple UX) */}
      <button
        type="button"
        onClick={goToMultiplier}
        className="block w-full text-left"
        aria-label="Open Amplify (Multiplier tab)"
      >
        {!hasPositions ? (
          <div className="haven-card-soft p-6 text-center transition hover:bg-accent">
            <p className="text-sm font-semibold text-foreground">
              Nothing open yet
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Boosted positions will show here when you open one.
            </p>
          </div>
        ) : (
          <div className="haven-card-soft overflow-hidden">
            {/* Summary row */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[12px] text-muted-foreground">
                  Take home <span className="text-[10px]">(T/H)</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Top {topRows.length} positions
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[13px] font-semibold text-foreground">
                  {formatMoneyNoCode(takeHomeLocal, displayCurrency)}
                </div>
                <div className="text-[11px] text-muted-foreground">Total</div>
              </div>
            </div>

            <div className="border-t border-border/70" />

            {/* Rows */}
            <div className="flex flex-col gap-2 p-2">
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
                    ? "text-primary"
                    : pnlLocal < 0
                      ? "text-destructive"
                      : "text-muted-foreground";

                const rowTakeHomeLocal = collateralLocal + pnlLocal;

                return (
                  <div
                    key={safeStr(p.id, `${symbol}-${idx}`)}
                    className="haven-row px-3 py-3"
                  >
                    {/* LEFT */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative h-9 w-9 overflow-hidden rounded-full border border-border bg-background/60">
                        <Image
                          src={meta?.logo || "/placeholder.svg"}
                          alt={`${symbol} logo`}
                          fill
                          sizes="36px"
                          className="object-cover"
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {symbol}
                          </span>
                        </div>

                        <div className="mt-0.5 flex items-baseline gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {sizeTokens > 0
                              ? `(${sizeTokens.toFixed(3)})`
                              : "(—)"}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatMoneyNoCode(
                              positionValueLocal,
                              displayCurrency
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT */}
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] text-muted-foreground">
                        T/H
                      </div>
                      <div className="text-sm font-semibold text-foreground">
                        {formatMoneyNoCode(rowTakeHomeLocal, displayCurrency)}
                      </div>

                      <div className="mt-1 flex items-baseline justify-end gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          P&amp;L
                        </span>
                        <span
                          className={[
                            "text-[12px] font-semibold",
                            pnlClass,
                          ].join(" ")}
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

            {/* Footer hint */}
            <div className="px-4 pb-4 pt-1">
              <div className="text-[11px] text-muted-foreground">
                Tap to manage positions in Amplify.
              </div>
            </div>
          </div>
        )}
      </button>
    </div>
  );
};

export default OpenPositionsMini;
