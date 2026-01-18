// components/exchange/types.ts
import type { TokenCategory, TokenKind } from "@/lib/tokenConfig";

export type ExchangeKind = TokenKind;

export type Asset = {
  mint: string;
  symbol: string;
  name: string;
  logoURI: string;
  kind: ExchangeKind;
  categories: TokenCategory[];
  tags?: string[];
};

export type AssetQuote = {
  priceUsd?: number;
  changePct24h?: number;
  volumeUsd24h?: number;
  marketCapUsd?: number;
};

export type AssetRow = Asset & AssetQuote;

export type Movers = {
  gainers: AssetRow[];
  losers: AssetRow[];
};

export type PriceFilterMode =
  | "all"
  | "under1"
  | "1to10"
  | "10to100"
  | "over100";
export type SortMode =
  | "featured"
  | "price_desc"
  | "price_asc"
  | "change_desc"
  | "change_asc"
  | "volume_desc";
