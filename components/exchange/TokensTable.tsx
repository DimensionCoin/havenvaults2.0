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
  type TokenCategory,
  type TokenMeta,
} from "@/lib/tokenConfig";

const PAGE_SIZE = 25;

// ───────── mint → categories map + category list ─────────

const CLUSTER = getCluster();

const MINT_TO_CATEGORIES: Record<string, TokenCategory[]> = (() => {
  const map: Record<string, TokenCategory[]> = {};

  TOKENS.forEach((meta: TokenMeta) => {
    const mint = getMintFor(meta, CLUSTER);
    if (!mint) return;
    map[mint] = meta.categories ?? [];
  });

  return map;
})();

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

const CATEGORY_OPTIONS: TokenCategory[] = Array.from(
  new Set(Object.values(MINT_TO_CATEGORIES).flat())
);

// ───────── helpers ─────────

// ⭐ NEW: generic currency formatter
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
 * 🔑 Slug strategy:
 *  - Prefer tokenConfig.id (your CoinGecko id)
 *  - else tokenConfig.symbol
 *  - else API token.symbol or mint
 *
 * /invest/[id] page already resolves by id | symbol | mint,
 * so all of these will work.
 */
const getTokenSlug = (token: Token) => {
  const meta = MINT_TO_META[token.mint];

  if (meta?.id) {
    return meta.id.toLowerCase();
  }

  if (meta?.symbol) {
    return meta.symbol.toLowerCase();
  }

  return (token.symbol || token.mint).toLowerCase();
};

// ───────── props ─────────

type TokensTableProps = {
  tokens: Token[];
  displayedTokens: Token[]; // already filtered by search / wishlist from parent
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

  // 🔑 Controlled category filter
  category: "all" | TokenCategory;
  onCategoryChange: (category: "all" | TokenCategory) => void;

  // ⭐ NEW: FX/display currency
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
  onCategoryChange,
  displayCurrency,
  fxRate,
}) => {
  const isLoading = loadingTokens || (tokens.length > 0 && loadingPrices);

  // central handler so we always:
  // - update category (in parent)
  // - reset page to 1
  const handleCategoryClick = (next: "all" | TokenCategory) => {
    onCategoryChange(next);
    onPageChange(1);
  };

  // category filter on top of parent filters
  const categoryFilteredTokens = React.useMemo(() => {
    if (category === "all") return displayedTokens;

    return displayedTokens.filter((t) => {
      const cats = MINT_TO_CATEGORIES[t.mint];
      if (!cats?.length) return false;
      return cats.includes(category);
    });
  }, [displayedTokens, category]);

  // sort by price desc (still in USD; fxRate is constant factor)
  const sortedTokens = React.useMemo(() => {
    return [...categoryFilteredTokens].sort((a, b) => {
      const priceA = prices[a.mint]?.price ?? 0; // USD
      const priceB = prices[b.mint]?.price ?? 0; // USD
      return priceB - priceA;
    });
  }, [categoryFilteredTokens, prices]);

  // Pagination visibility — same logic as before
  const shouldShowPagination =
    totalPages > 1 && (page > 1 || sortedTokens.length >= PAGE_SIZE);

  return (
    <>
      {/* Meta row + category tabs */}
      <div className="mb-3 flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: summary */}
        <span>
          {total > 0 ? (
            <>
              Showing{" "}
              <span className="text-zinc-200">{sortedTokens.length}</span> of{" "}
              <span className="text-zinc-200">
                {onlyWishlist ? wishlistCount : total}
              </span>{" "}
              tokens
              {category !== "all" && (
                <>
                  {" "}
                  · <span className="text-emerald-300">{category}</span>
                </>
              )}
            </>
          ) : loadingTokens ? (
            "Loading tokens..."
          ) : (
            "No tokens found"
          )}
        </span>

        {/* Right: category pills from tokenConfig */}
        {CATEGORY_OPTIONS.length > 0 && (
          <div className="flex flex-wrap gap-1 sm:justify-end">
            {/* All */}
            <button
              type="button"
              onClick={() => handleCategoryClick("all")}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                category === "all"
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                  : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-200"
              }`}
            >
              All
            </button>

            {CATEGORY_OPTIONS.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => handleCategoryClick(cat)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                  category === cat
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                    : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table header (desktop) */}
      <div className="hidden border-b border-zinc-800/70 pb-2 text-[11px] text-zinc-500 sm:grid sm:grid-cols-[minmax(0,2fr)_100px_100px] sm:gap-4">
        <div className="text-left">Token</div>
        <div className="text-right">
          Price{" "}
          <span className="text-[10px] text-zinc-500">({displayCurrency})</span>
        </div>
        <div className="text-right">24h Change</div>
      </div>

      {/* Content */}
      <div className="mt-1 space-y-2">
        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {isLoading && !tokens.length ? (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex animate-pulse flex-col rounded-2xl border border-zinc-900 bg-zinc-950/90 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,2fr)_100px_100px] sm:items-center sm:gap-4"
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
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/80 px-4 py-6 text-center text-sm text-zinc-500">
            No tokens available to trade yet.
          </div>
        ) : (
          sortedTokens.map((token) => {
            const priceEntry = prices[token.mint];
            const rawPriceUsd = priceEntry?.price; // USD
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

            // ⭐ NEW: convert for display
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
                <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,2fr)_100px_100px] sm:items-center sm:gap-4">
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
                        <p className="truncate text-sm font-medium">
                          {token.name || token.symbol || "Unknown token"}
                        </p>
                        {token.symbol && (
                          <span className="truncate text-[11px] uppercase text-zinc-500">
                            {token.symbol}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Wishlist star button */}
                    <button
                      type="button"
                      onClick={handleStarClick}
                      className={`ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
                        isWishlisted
                          ? "border-emerald-500/70 bg-emerald-500/10"
                          : "border-zinc-800 bg-zinc-950 hover:border-emerald-500/60"
                      }`}
                    >
                      <Star
                        className={`h-3.5 w-3.5 ${
                          isWishlisted
                            ? "fill-emerald-400 text-emerald-400"
                            : "text-zinc-400"
                        }`}
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
                          ? "Loading..."
                          : formatCurrency(priceDisplay, displayCurrency)}
                      </span>
                    </div>
                  </div>

                  {/* 24h change */}
                  <div className="sm:text-right">
                    <div className="flex items-center justify-between sm:block">
                      <span className="text-[11px] text-zinc-500 sm:hidden">
                        24h
                      </span>
                      <span
                        className={`text-sm font-medium ${changeColor} sm:block`}
                      >
                        {formatPct(pctChange)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mobile hint */}
                <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500 sm:hidden">
                  <span>Tap to open buy flow</span>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300">
                    Buy
                  </span>
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
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 transition ${
              page <= 1
                ? "cursor-not-allowed border-zinc-800 text-zinc-600"
                : "border-zinc-700 hover:border-emerald-500/60 hover:text-emerald-200"
            }`}
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
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 transition ${
              !hasMore || page >= totalPages
                ? "cursor-not-allowed border-zinc-800 text-zinc-600"
                : "border-zinc-700 hover:border-emerald-500/60 hover:text-emerald-200"
            }`}
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
