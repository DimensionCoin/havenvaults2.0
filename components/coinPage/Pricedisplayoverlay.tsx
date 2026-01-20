"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Info, Loader2 } from "lucide-react";
import { formatMoneyNoCode, formatPct } from "./utils";

type PriceDisplayOverlayProps = {
  price: number | null;
  priceChange24hPct: number | null;
  symbol: string;
  loading: boolean;
};

export function PriceDisplayOverlay({
  price,
  priceChange24hPct,
  symbol,
  loading,
}: PriceDisplayOverlayProps) {
  const isUp = (priceChange24hPct ?? 0) >= 0;

  return (
    <div className="flex h-[210px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-muted/10">
      {loading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Loading price...
          </span>
        </div>
      ) : price !== null ? (
        <div className="flex flex-col items-center gap-3">
          <div className="text-4xl font-bold tracking-tight text-foreground">
            {formatMoneyNoCode(price)}
          </div>
          {priceChange24hPct !== null && (
            <div
              className={[
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold",
                isUp
                  ? "bg-primary/10 text-primary"
                  : "bg-destructive/10 text-destructive",
              ].join(" ")}
            >
              {isUp ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              {formatPct(priceChange24hPct)}
              <span className="text-xs opacity-70">(24h)</span>
            </div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {symbol} · Live price from Jupiter
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Info className="h-5 w-5" />
          <span className="text-xs">Price unavailable</span>
        </div>
      )}
    </div>
  );
}
