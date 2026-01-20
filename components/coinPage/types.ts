import type { TokenMeta, TokenCategory } from "@/lib/tokenConfig";
import type { UsdcSwapStatus } from "@/hooks/useServerSponsoredUsdcSwap";

export type ResolvedToken = {
  meta: TokenMeta;
  mint: string;
};

export type HistoricalPoint = { t: number; price: number };
export type HistoricalApiResponse = { id: string; prices: HistoricalPoint[] };

export type SpotResp = {
  prices: Record<
    string,
    { priceUsd: number; priceChange24hPct: number | null }
  >;
};

export type JupPriceResp = {
  prices: Record<
    string,
    {
      price: number;
      priceChange24hPct: number | null;
      mcap: number | null;
      fdv: number | null;
      liquidity: number | null;
      volume24h: number | null;
      marketCapRank: number | null;
    }
  >;
};

export type TimeframeKey = "1D" | "7D" | "30D" | "90D";

export type PaymentAccount = "cash" | "plus";
export type ReceiveAccount = "cash" | "plus";

export type ModalKind = "processing" | "success" | "error";

export type ModalState = {
  kind: ModalKind;
  signature?: string | null;
  errorMessage?: string;
  side?: "buy" | "sell";
  symbol?: string;
} | null;

export type SleekPoint = { t: number; y: number };

export type TradeCalculations = {
  grossUsd: number;
  feeUsd: number;
  netUsd: number;
  grossDisplay: number;
  feeDisplay: number;
  netDisplay: number;
  receiveAsset: number;
  receiveCashDisplay: number;
  payAsset: number;
  payCashDisplay: number;
};

export type StageConfig = {
  title: string;
  subtitle: string;
  progress: number;
  icon: "spinner" | "wallet" | "success" | "error";
};

export { TokenMeta, TokenCategory, UsdcSwapStatus };
