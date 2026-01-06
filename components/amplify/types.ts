export type AmplifyTokenSymbol = "SOL" | "ETH" | "BTC";

export type ChartTimeframe = "LIVE" | "1H" | "1D" | "1W" | "1M" | "1Y";
export type PredictionTimeframe = "hourly" | "daily" | "monthly" | "yearly";

export type LeverageOption = 1.5 | 2;

export type MultiplierPosition = {
  id: string;
  tokenSymbol: AmplifyTokenSymbol;
  leverage: LeverageOption;
  buyIn: number;
  entryPrice: number;
  estTokenQty: number;
  estLiquidationPrice: number;
  createdAt: string;
  side?: "long" | "short";
  openSignature?: string | null;
  sweepSignature?: string | null;
};

export type PredictionSide = "YES" | "NO";

export type PredictionMarket = {
  id: string;
  tokenSymbol: AmplifyTokenSymbol;
  title: string;
  timeframe: PredictionTimeframe;
  yesPct: number;
  noPct: number;
  endsInLabel: string;
};

export type PredictionPosition = {
  id: string;
  tokenSymbol: AmplifyTokenSymbol;
  marketId: string;
  title: string;
  side: PredictionSide;
  stake: number;
  createdAt: string;
};
