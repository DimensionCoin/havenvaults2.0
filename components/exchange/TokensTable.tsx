// components/exchange/TokensTable.tsx
"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import type { Token, PriceEntry } from "./types";

import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
  type TokenCategory,
} from "@/lib/tokenConfig";

const PAGE_SIZE = 25;
const CLUSTER = getCluster();

/**
 * Mint -> TokenMeta map so we can derive slugs (id / symbol) from tokenConfig
 */
const MINT_TO_META: Record<string, TokenMeta> = (() => {
  const map: Record<string, TokenMeta> = {};
  TOKENS.forEach((meta: TokenMeta) => {
    const mint = getMintFor(meta, CLUSTER);
    if (!mint) return;
    map[mint] = meta;
  });
  return map;
})();

// ⭐ Currency formatter
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

/**
 * Slug strategy:
 *  - Prefer tokenConfig.id
 *  - else tokenConfig.symbol
 *  - else API token.symbol or mint
 */
const getTokenSlug = (token: Token) => {
  const meta = MINT_TO_META[token.mint];
  if (meta?.id) return meta.id.toLowerCase();
  if (meta?.symbol) return meta.symbol.toLowerCase();
  return (token.symbol || token.mint).toLowerCase();
};

type TokensTableProps = {
  tokens: Token[]; // raw page tokens
  displayedTokens: Token[]; // already filtered in parent (wishlist + server category/search)
  prices: Record<string, PriceEntry>;
  wishlistSet: Set<string>;
  wishlistCount: number;
  total: number;
  onlyWishlist: boolean;
  loadingTokens: boolean;
  loadingPrices: boolean;
  error: string | null;

  page: number;
  totalPages: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;

  onToggleWishlist: (mint: string, isCurrentlyWishlisted: boolean) => void;

  // kept for compatibility (parent is the source of truth)
  category: "all" | TokenCategory;
  onCategoryChange: (category: "all" | TokenCategory) => void;

  displayCurrency: string;
  fxRate: number; // USD -> displayCurrency
};

const TokensTable: React.FC<TokensTableProps> = ({
  tokens,
  displayedTokens,
  prices,
  wishlistSet,
  wishlistCount,
  total,
  onlyWishlist,
  loadingTokens,
  loadingPrices,
  error,
  page,
  totalPages,
  hasMore,
  onPageChange,
  onToggleWishlist,
  category,
  displayCurrency,
  fxRate,
}) => {
  const isLoading = loadingTokens || (tokens.length > 0 && loadingPrices);

  // sort by price desc (USD; fx is constant multiplier)
  const sortedTokens = React.useMemo(() => {
    return [...displayedTokens].sort((a, b) => {
      const priceA = prices[a.mint]?.price ?? 0;
      const priceB = prices[b.mint]?.price ?? 0;
      return priceB - priceA;
    });
  }, [displayedTokens, prices]);

  const shouldShowPagination =
    totalPages > 1 && (page > 1 || sortedTokens.length >= PAGE_SIZE);

  return (
    <>
      {/* Meta row (clean + exchange-like) */}
      <div className="mb-3 flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {total > 0 ? (
              <>
                Showing{" "}
                <span className="text-zinc-200">{sortedTokens.length}</span> of{" "}
                <span className="text-zinc-200">
                  {onlyWishlist ? wishlistCount : total}
                </span>
                {category !== "all" && (
                  <>
                    {" "}
                    · <span className="text-emerald-300">{category}</span>
                  </>
                )}
              </>
            ) : loadingTokens ? (
              "Loading markets…"
            ) : (
              "No markets found"
            )}
          </span>

          {/* small hint like a real exchange */}
          <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-[11px] text-zinc-400">
            Sorted by price · {displayCurrency}
          </span>
        </div>

        {/* Optional right-side status */}
        <div className="flex items-center gap-2 sm:justify-end">
          {loadingPrices && (
            <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-[11px] text-zinc-400">
              Updating prices…
            </span>
          )}
        </div>
      </div>

      {/* Table header (desktop only) */}
      <div className="hidden border-b border-zinc-800/70 pb-2 text-[11px] text-zinc-500 sm:grid sm:grid-cols-[minmax(0,2fr)_120px_100px] sm:gap-4">
        <div className="text-left">Token</div>
        <div className="text-right">
          Price{" "}
          <span className="text-[10px] text-zinc-500">({displayCurrency})</span>
        </div>
        <div className="text-right">24h</div>
      </div>

      {/* Content */}
      <div className="mt-1 space-y-2">
        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* skeletons */}
        {isLoading && !tokens.length ? (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex animate-pulse flex-col rounded-2xl border border-zinc-900 bg-zinc-950/90 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,2fr)_120px_100px] sm:items-center sm:gap-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-zinc-900" />
                  <div className="space-y-1">
                    <div className="h-3 w-28 rounded bg-zinc-800" />
                    <div className="h-3 w-16 rounded bg-zinc-900" />
                  </div>
                </div>
                <div className="mt-3 h-3 w-16 rounded bg-zinc-900 sm:mt-0 sm:justify-self-end" />
                <div className="mt-3 h-3 w-16 rounded bg-zinc-900 sm:mt-0 sm:justify-self-end" />
              </div>
            ))}
          </>
        ) : sortedTokens.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/80 px-4 py-8 text-center">
            <p className="text-sm font-medium text-zinc-200">
              No markets match your filters
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Try clearing search, changing category, or turning off favorites.
            </p>
          </div>
        ) : (
          sortedTokens.map((token) => {
            const priceEntry = prices[token.mint];
            const rawPriceUsd = priceEntry?.price;
            const pctChange = priceEntry?.priceChange24hPct ?? null;

            const isUp = (pctChange ?? 0) > 0;
            const isDown = (pctChange ?? 0) < 0;

            const changeColor = isUp
              ? "text-emerald-400"
              : isDown
              ? "text-red-400"
              : "text-zinc-400";

            const isWishlisted = wishlistSet.has(token.mint);
            const slug = getTokenSlug(token);

            const priceDisplay =
              typeof rawPriceUsd === "number" && fxRate
                ? rawPriceUsd * fxRate
                : undefined;

            const handleStarClick: React.MouseEventHandler<
              HTMLButtonElement
            > = (e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleWishlist(token.mint, isWishlisted);
            };

            return (
              <Link
                key={token.mint}
                href={`/invest/${slug}`}
                className="block rounded-2xl border border-zinc-900 bg-zinc-950/80 px-3 py-3 transition hover:border-emerald-500/50 hover:bg-zinc-950 sm:px-4 sm:py-3"
              >
                <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,2fr)_120px_100px] sm:items-center sm:gap-4">
                  {/* Token info */}
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-950 text-[11px] font-semibold text-zinc-200">
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

                      {isWishlisted && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-black/80 p-0.5">
                          <Star className="h-3 w-3 fill-emerald-400 text-emerald-400" />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-zinc-50">
                          {token.name || token.symbol || "Unknown token"}
                        </p>
                        {token.symbol && (
                          <span className="truncate text-[11px] uppercase text-zinc-500">
                            {token.symbol}
                          </span>
                        )}
                      </div>

                      {/* subtle hint (mobile) */}
                      <p className="mt-0.5 text-[11px] text-zinc-500 sm:hidden">
                        Tap to buy
                      </p>
                    </div>

                    {/* Wishlist */}
                    <button
                      type="button"
                      onClick={handleStarClick}
                      aria-label={isWishlisted ? "Unfavorite" : "Favorite"}
                      className={[
                        "ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border transition",
                        isWishlisted
                          ? "border-emerald-500/70 bg-emerald-500/10"
                          : "border-zinc-800 bg-zinc-950 hover:border-emerald-500/60",
                      ].join(" ")}
                    >
                      <Star
                        className={[
                          "h-4 w-4",
                          isWishlisted
                            ? "fill-emerald-400 text-emerald-400"
                            : "text-zinc-400",
                        ].join(" ")}
                      />
                    </button>
                  </div>

                  {/* Price */}
                  <div className="sm:text-right">
                    <div className="flex items-center justify-between sm:block">
                      <span className="text-[11px] text-zinc-500 sm:hidden">
                        Price ({displayCurrency})
                      </span>
                      <span className="text-sm font-medium text-zinc-50 sm:block">
                        {loadingPrices && priceDisplay === undefined
                          ? "Loading…"
                          : formatCurrency(priceDisplay, displayCurrency)}
                      </span>
                    </div>
                  </div>

                  {/* 24h */}
                  <div className="sm:text-right">
                    <div className="flex items-center justify-between sm:block">
                      <span className="text-[11px] text-zinc-500 sm:hidden">
                        24h
                      </span>
                      <span className={`text-sm font-medium ${changeColor}`}>
                        {formatPct(pctChange)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {shouldShowPagination && (
        <div className="mt-4 flex items-center justify-between text-xs text-zinc-400">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            className={[
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 transition",
              page <= 1
                ? "cursor-not-allowed border-zinc-800 text-zinc-600"
                : "border-zinc-700 hover:border-emerald-500/60 hover:text-emerald-200",
            ].join(" ")}
          >
            <ChevronLeft className="h-3 w-3" />
            Prev
          </button>

          <div className="flex items-center gap-2">
            <span>
              Page <span className="font-semibold text-zinc-100">{page}</span>{" "}
              of{" "}
              <span className="font-semibold text-zinc-100">{totalPages}</span>
            </span>
          </div>

          <button
            type="button"
            disabled={!hasMore || page >= totalPages}
            onClick={() =>
              onPageChange(!hasMore || page >= totalPages ? page : page + 1)
            }
            className={[
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 transition",
              !hasMore || page >= totalPages
                ? "cursor-not-allowed border-zinc-800 text-zinc-600"
                : "border-zinc-700 hover:border-emerald-500/60 hover:text-emerald-200",
            ].join(" ")}
          >
            Next
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </>
  );
};

export default TokensTable;
