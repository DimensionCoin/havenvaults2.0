// components/exchange/types.ts

import { type TokenCategory } from "@/lib/tokenConfig";

export type Token = {
  _id?: string;
  mint: string;
  symbol?: string;
  name?: string;
  logoURI?: string;
  category?: string;
  kind?: "crypto" | "stock";
  tags?: string[];
  categories?: TokenCategory[];
};

export type PriceEntry = {
  price: number;
  priceChange24hPct: number | null;
  volume24h?: number;
  marketCap?: number;
  sparkline?: number[]; // Last 24h prices for mini chart
};

// API response from /api/tokens
export type TokensApiResponse = {
  tokens: Token[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};

// API response from /api/prices/jup
export type PricesResponse = {
  prices: Record<string, PriceEntry>;
};

// Base tabs that are always shown
export type BaseTab = "all" | "favorites";

// MarketTab can be a base tab or any TokenCategory
export type MarketTab = BaseTab | TokenCategory;

// Helper to check if a tab is a category
export function isCategory(tab: MarketTab): tab is TokenCategory {
  return tab !== "all" && tab !== "favorites";
}
