// components/exchange/MarketList.tsx
"use client";

import React from "react";
import type { Token, PriceEntry } from "./types";
import MarketCard from "./MarketCard";
import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokenConfig";

const CLUSTER = getCluster();

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

  if (tokens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-zinc-900/30 py-16 text-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
          <svg
            className="h-8 w-8 text-zinc-500"
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
        <p className="text-base font-medium text-zinc-300">{emptyMessage}</p>
        <p className="mt-1 text-sm text-zinc-500">
          Try adjusting your search or filters
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tokens.map((token) => {
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
            onToggleWishlist={() => onToggleWishlist(token.mint, isWishlisted)}
            displayCurrency={displayCurrency}
            fxRate={fxRate}
          />
        );
      })}
    </div>
  );
};

export default MarketList;
