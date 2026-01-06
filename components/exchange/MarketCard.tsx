// components/exchange/MarketCard.tsx
"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import type { Token, PriceEntry } from "./types";
import MiniSparkline from "./MiniSparkline";

type MarketCardProps = {
  token: Token;
  price?: PriceEntry;
  slug: string;
  isWishlisted: boolean;
  onToggleWishlist: () => void;
  displayCurrency: string;
  fxRate: number;
  loading?: boolean;
};

const formatPrice = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const decimals = value < 0.01 ? 6 : value < 1 ? 4 : 2;

  // ✅ always "$", never "CA$"
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  })}`;
};

const formatChange = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

const MarketCard: React.FC<MarketCardProps> = ({
  token,
  price,
  slug,
  isWishlisted,
  onToggleWishlist,
  fxRate,
  loading = false,
}) => {
  const priceDisplay = useMemo(() => {
    if (!price?.price || !fxRate) return undefined;
    return price.price * fxRate;
  }, [price?.price, fxRate]);

  const change = price?.priceChange24hPct ?? null;
  const isPositive = (change ?? 0) >= 0;
  const isNegative = (change ?? 0) < 0;

  const changeColor = isPositive
    ? "text-emerald-300"
    : isNegative
      ? "text-rose-300"
      : "text-white/50";

  const changeBg = isPositive
    ? "bg-emerald-500/15 border-emerald-300/20"
    : isNegative
      ? "bg-rose-500/15 border-rose-300/20"
      : "bg-white/5 border-white/10";

  if (loading) {
    return (
      <div className="flex items-center gap-4 rounded-3xl border border-white/10 bg-black/25 p-4 backdrop-blur-2xl">
        <div className="h-12 w-12 animate-pulse rounded-full bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
        </div>
        <div className="text-right space-y-2">
          <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-14 animate-pulse rounded bg-white/10" />
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/invest/${slug}`}
      className={[
        "group relative flex items-center gap-4 rounded-3xl border p-4 transition",
        "border-white/10 bg-black/25 backdrop-blur-2xl",
        "hover:bg-white/5 hover:border-emerald-300/25 active:scale-[0.99]",
        isWishlisted ? "shadow-[0_0_0_1px_rgba(63,243,135,0.25)]" : "",
      ].join(" ")}
    >
      {/* Logo (✅ badge no longer clipped) */}
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
        <div className="h-12 w-12 overflow-hidden rounded-full border border-white/12 bg-white/5">
          {token.logoURI ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={token.logoURI}
              alt={token.name || token.symbol || "Token"}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-sm font-semibold text-white/50">
                {(token.symbol || "?").slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Stock badge (✅ overlays and doesn't clip) */}
        {token.kind === "stock" && (
          <span className="absolute -bottom-1 -right-1 rounded-full border border-white/15 bg-black/70 px-1.5 py-0.5 text-[7px] font-bold tracking-wider text-emerald-200 shadow">
            Stock
          </span>
        )}
      </div>

      {/* Name & Symbol + Star */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-white/90">
            {token.name || token.symbol || "Unknown"}
          </h3>

          {/* ⭐ better wishlist control (no overlap with price) */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleWishlist();
            }}
            className={[
              "ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition",
              isWishlisted
                ? "border-amber-300/25 bg-amber-500/15"
                : "border-white/10 bg-white/5 hover:bg-white/10",
            ].join(" ")}
            aria-label={
              isWishlisted ? "Remove from favorites" : "Add to favorites"
            }
          >
            <Star
              className={[
                "h-4 w-4 transition-colors",
                isWishlisted
                  ? "fill-amber-300 text-amber-300"
                  : "text-white/45 group-hover:text-amber-300",
              ].join(" ")}
            />
          </button>
        </div>

        <p className="text-[12px] text-white/45">{token.symbol}</p>
      </div>

      {/* Sparkline */}
      {price?.sparkline && price.sparkline.length > 1 && (
        <div className="hidden w-24 sm:block">
          <MiniSparkline
            data={price.sparkline}
            isPositive={isPositive}
            height={32}
          />
        </div>
      )}

      {/* Price & Change */}
      <div className="shrink-0 text-right">
        <p className="text-[15px] font-semibold text-white/90">
          {formatPrice(priceDisplay)}
        </p>

        <span
          className={[
            "mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            changeBg,
            changeColor,
          ].join(" ")}
        >
          {formatChange(change)}
        </span>
      </div>
    </Link>
  );
};

export default MarketCard;
