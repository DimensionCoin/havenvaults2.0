// components/exchange/TrendingStrip.tsx
"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import type { Token, PriceEntry } from "./types";

type TrendingStripProps = {
  tokens: Token[];
  prices: Record<string, PriceEntry>;
  wishlistSet: Set<string>;
  isLoading: boolean;
  onToggleWishlist: (mint: string, isWishlisted: boolean) => void;

  // ⭐ NEW
  displayCurrency: string;
  fxRate: number; // USD -> displayCurrency
};

// ⭐ NEW: generic formatter
const formatCurrency = (
  value?: number | null,
  currency: string = "USD"
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(0);
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value < 1 ? 6 : 2,
  });
};

const formatPct = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

const getTokenSlug = (token: Token) =>
  (token.symbol || token.mint).toLowerCase();

const TrendingStrip: React.FC<TrendingStripProps> = ({
  tokens,
  prices,
  wishlistSet,
  isLoading,
  onToggleWishlist,
  displayCurrency,
  fxRate,
}) => {
  const trending = useMemo(() => {
    const scored = tokens
      .map((t) => {
        const entry = prices[t.mint];
        const change = entry?.priceChange24hPct ?? null;
        return { token: t, entry, change };
      })
      .filter((x) => typeof x.change === "number");

    scored.sort((a, b) => (b.change as number) - (a.change as number));

    return scored.slice(0, 5);
  }, [tokens, prices]);

  if (isLoading && !trending.length) {
    return (
      <div className="trending-scroll flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-20 w-40 animate-pulse rounded-2xl bg-zinc-900/80"
          />
        ))}
      </div>
    );
  }

  if (!trending.length) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs text-zinc-500">
        No trending tokens yet. Once markets move, you’ll see the top 24h movers
        here.
      </div>
    );
  }

  return (
    <div className="trending-scroll -mx-1 flex gap-2 overflow-x-auto pb-1 pl-1 pr-3">
      {trending.map(({ token, entry, change }) => {
        const priceUsd = entry?.price; // USD
        const slug = getTokenSlug(token);
        const isWishlisted = wishlistSet.has(token.mint);
        const isUp = (change ?? 0) > 0;
        const isDown = (change ?? 0) < 0;
        const changeColor = isUp
          ? "text-emerald-400"
          : isDown
          ? "text-red-400"
          : "text-zinc-400";

        // ⭐ NEW: display currency
        const priceDisplay =
          typeof priceUsd === "number" && fxRate
            ? priceUsd * fxRate
            : undefined;

        return (
          <div
            key={token.mint}
            className="relative flex w-44 shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/90 px-3 py-3"
          >
            {/* wishlist star */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onToggleWishlist(token.mint, isWishlisted);
              }}
              className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs transition ${
                isWishlisted
                  ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                  : "border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-emerald-400 hover:text-emerald-200"
              }`}
            >
              <Star
                className={`h-3 w-3 ${
                  isWishlisted ? "fill-emerald-300 text-emerald-300" : ""
                }`}
              />
            </button>

            <Link href={`/invest/${slug}`} className="block pt-1">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 text-[10px] font-semibold text-zinc-200">
                  {token.logoURI ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={token.logoURI}
                      alt={token.name || token.symbol || token.mint}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    (token.symbol || "???").slice(0, 3).toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {token.symbol || token.name || "Unknown"}
                  </p>
                  <p className={`text-[11px] ${changeColor}`}>
                    {formatPct(change)}
                  </p>
                </div>
              </div>

              <p className="text-xs text-zinc-400">
                {typeof priceDisplay === "number"
                  ? formatCurrency(priceDisplay, displayCurrency)
                  : "—"}
              </p>
            </Link>
          </div>
        );
      })}
    </div>
  );
};

export default TrendingStrip;
