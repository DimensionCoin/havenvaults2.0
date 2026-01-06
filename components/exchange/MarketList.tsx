// components/exchange/MarketList.tsx
"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Token, PriceEntry } from "./types";
import MarketCard from "./MarketCard";
import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokenConfig";

const CLUSTER = getCluster();
const INITIAL_COUNT = 12;
const LOAD_MORE_COUNT = 12;

// Build mint -> meta lookup
const MINT_TO_META: Record<string, TokenMeta> = (() => {
  const map: Record<string, TokenMeta> = {};
  TOKENS.forEach((meta: TokenMeta) => {
    const mint = getMintFor(meta, CLUSTER);
    if (!mint) return;
    map[mint] = meta;
  });
  return map;
})();

const getTokenSlug = (token: Token) => {
  const meta = MINT_TO_META[token.mint];
  if (meta?.id) return meta.id.toLowerCase();
  if (meta?.symbol) return meta.symbol.toLowerCase();
  return (token.symbol || token.mint).toLowerCase();
};

type MarketListProps = {
  tokens: Token[];
  prices: Record<string, PriceEntry>;
  wishlistSet: Set<string>;
  onToggleWishlist: (mint: string, isWishlisted: boolean) => void;
  displayCurrency: string;
  fxRate: number;
  loading?: boolean;
  emptyMessage?: string;
};

const MarketList: React.FC<MarketListProps> = ({
  tokens,
  prices,
  wishlistSet,
  onToggleWishlist,
  displayCurrency,
  fxRate,
  loading = false,
  emptyMessage = "No markets found",
}) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);

  // Reset to initial count when tokens change (filter/search changed)
  useEffect(() => {
    setVisibleCount(INITIAL_COUNT);
  }, [tokens.length]);

  const visibleTokens = tokens.slice(0, visibleCount);
  const hasMore = visibleCount < tokens.length;
  const isExpanded = visibleCount > INITIAL_COUNT;
  const remaining = tokens.length - visibleCount;

  const handleShowMore = () => {
    setVisibleCount((prev) => Math.min(prev + LOAD_MORE_COUNT, tokens.length));
  };

  const handleCollapse = () => {
    setVisibleCount(INITIAL_COUNT);
    // Scroll back to top of list smoothly
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Loading skeleton
  if (loading && tokens.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <MarketCard
            key={i}
            token={{ mint: `loading-${i}`, symbol: "", name: "" }}
            slug=""
            isWishlisted={false}
            onToggleWishlist={() => {}}
            displayCurrency={displayCurrency}
            fxRate={fxRate}
            loading={true}
          />
        ))}
      </div>
    );
  }

  // Empty state
  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-zinc-900/30 py-12 text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800">
          <svg
            className="h-7 w-7 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-zinc-300">{emptyMessage}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Try adjusting your search or filters
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Token list */}
      <div className="space-y-2">
        {visibleTokens.map((token) => {
          const slug = getTokenSlug(token);
          const isWishlisted = wishlistSet.has(token.mint);
          const priceEntry = prices[token.mint];

          return (
            <MarketCard
              key={token.mint}
              token={token}
              price={priceEntry}
              slug={slug}
              isWishlisted={isWishlisted}
              onToggleWishlist={() =>
                onToggleWishlist(token.mint, isWishlisted)
              }
              displayCurrency={displayCurrency}
              fxRate={fxRate}
            />
          );
        })}
      </div>

      {/* Show more / Collapse buttons */}
      {(hasMore || isExpanded) && (
        <div className="flex items-center justify-center gap-3 pt-2">
          {hasMore && (
            <button
              type="button"
              onClick={handleShowMore}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
            >
              <ChevronDown className="h-4 w-4" />
              Show more ({remaining})
            </button>
          )}

          {isExpanded && (
            <button
              type="button"
              onClick={handleCollapse}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-800/50 px-5 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              <ChevronUp className="h-4 w-4" />
              Show less
            </button>
          )}
        </div>
      )}

      {/* Count indicator */}
      <p className="text-center text-xs text-zinc-600">
        Showing {visibleTokens.length} of {tokens.length}
      </p>
    </div>
  );
};

export default MarketList;
