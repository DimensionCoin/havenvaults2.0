export type AmplifyTokenSymbol = "SOL" | "ETH" | "BTC";

export type ChartTimeframe = "1H" | "1D" | "1W" | "1M" | "1Y" | "ALL";
export type PredictionTimeframe = "hourly" | "daily" | "monthly" | "yearly";

export type LeverageOption = 1.5 | 2;

export type MultiplierPosition = {
  id: string;
  tokenSymbol: AmplifyTokenSymbol;
  leverage: LeverageOption;
  buyIn: number; // in display currency
  entryPrice: number; // in display currency
  estTokenQty: number;
  estLiquidationPrice: number; // in display currency
  createdAt: string;
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
  stake: number; // in display currency
  createdAt: string;
};
