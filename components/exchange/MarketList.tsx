// components/exchange/MarketList.tsx
"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
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
  const remaining = Math.max(0, tokens.length - visibleCount);

  const handleShowMore = () => {
    setVisibleCount((prev) => Math.min(prev + LOAD_MORE_COUNT, tokens.length));
  };

  const handleCollapse = () => {
    setVisibleCount(INITIAL_COUNT);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Loading skeleton (MarketCard already themed after you restyle it)
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
            loading
          />
        ))}
      </div>
    );
  }

  // Empty state (Haven look)
  if (tokens.length === 0) {
    return (
      <div className="haven-card-soft px-4 py-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background/60 shadow-fintech-sm">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>

        <p className="mt-4 text-sm font-semibold text-foreground">
          {emptyMessage}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          Try adjusting your search or filters.
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

      {/* Show more / Collapse */}
      {(hasMore || isExpanded) && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {hasMore && (
            <button
              type="button"
              onClick={handleShowMore}
              className="haven-btn-primary w-auto px-4 py-2 text-xs"
            >
              <ChevronDown className="h-4 w-4" />
              Show more{remaining > 0 ? ` (${remaining})` : ""}
            </button>
          )}

          {isExpanded && (
            <button
              type="button"
              onClick={handleCollapse}
              className="haven-btn-secondary w-auto px-4 py-2 text-xs"
            >
              <ChevronUp className="h-4 w-4" />
              Show less
            </button>
          )}
        </div>
      )}

      {/* Count indicator */}
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.20em] text-muted-foreground">
        Showing {visibleTokens.length} of {tokens.length}
      </p>
    </div>
  );
};

export default MarketList;
