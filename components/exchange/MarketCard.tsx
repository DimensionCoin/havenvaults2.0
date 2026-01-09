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

  const changePillClass = isPositive
    ? "haven-pill-positive"
    : "haven-pill-negative";

  if (loading) {
    return (
      <div className="haven-row p-4">
        <div className="h-12 w-12 animate-pulse rounded-full bg-border/60" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-36 animate-pulse rounded bg-border/60" />
          <div className="h-3 w-20 animate-pulse rounded bg-border/60" />
        </div>
        <div className="text-right space-y-2">
          <div className="h-4 w-20 animate-pulse rounded bg-border/60" />
          <div className="h-3 w-14 animate-pulse rounded bg-border/60" />
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/invest/${slug}`}
      className={[
        // Base row
        "group haven-row",
        // Make it feel tappable
        "transition active:scale-[0.99] hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // A tiny extra highlight when favorited
        isWishlisted ? "glow-mint" : "",
      ].join(" ")}
    >
      {/* Logo + badge */}
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
        <div className="h-12 w-12 overflow-hidden rounded-full border border-border bg-background/60">
          {token.logoURI ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={token.logoURI}
              alt={token.name || token.symbol || "Token"}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-sm font-semibold text-muted-foreground">
                {(token.symbol || "?").slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {token.kind === "stock" && (
          <span className="absolute -bottom-1 -right-1 rounded-full border border-border bg-card/90 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-foreground shadow-fintech-sm">
            STOCK
          </span>
        )}
      </div>

      {/* Name + symbol */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground">
            {token.name || token.symbol || "Unknown"}
          </h3>

          {/* Wishlist */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleWishlist();
            }}
            className={[
              "ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition",
              "bg-card/80 backdrop-blur-xl shadow-fintech-sm",
              "hover:bg-secondary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isWishlisted ? "border-primary/25" : "border-border",
            ].join(" ")}
            aria-label={
              isWishlisted ? "Remove from favorites" : "Add to favorites"
            }
            title={isWishlisted ? "Remove favorite" : "Add favorite"}
          >
            <Star
              className={[
                "h-4 w-4 transition-colors",
                isWishlisted
                  ? "fill-primary text-primary"
                  : "text-muted-foreground group-hover:text-primary",
              ].join(" ")}
            />
          </button>
        </div>

        <p className="text-[12px] text-muted-foreground">{token.symbol}</p>
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

      {/* Price + Change */}
      <div className="shrink-0 text-right">
        <p className="text-[15px] font-semibold text-foreground">
          {formatPrice(priceDisplay)}
        </p>

        <span
          className={[
            "mt-1 inline-flex px-2 py-0.5 text-[11px] font-semibold",
            "rounded-full border",
            changePillClass,
          ].join(" ")}
        >
          {formatChange(change)}
        </span>
      </div>
    </Link>
  );
};

export default MarketCard;
