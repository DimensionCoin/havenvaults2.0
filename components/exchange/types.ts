// components/exchange/types.ts

export type Token = {
  _id?: string;
  mint: string;
  symbol?: string;
  name?: string;
  logoURI?: string;
  category?: string; 
};

export type PriceEntry = {
  price: number;
  priceChange24hPct: number | null;
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
