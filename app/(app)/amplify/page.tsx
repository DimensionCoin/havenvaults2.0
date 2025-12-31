"use client";

import React, { useMemo, useState } from "react";
import AmplifyHeader from "@/components/amplify/AmplifyHeader";
import PriceChartPanel from "@/components/amplify/PriceChartPanel";
import MultiplierPanel from "@/components/amplify/MultiplierPanel";
import PredictionMarketsPanel from "@/components/amplify/PredictionMarketsPanel";
import PositionsPanel from "@/components/amplify/PositionsPanel";

import type {
  AmplifyTokenSymbol,
  ChartTimeframe,
  PredictionTimeframe,
  MultiplierPosition,
  PredictionPosition,
} from "@/components/amplify/types";

import { useBalance } from "@/providers/BalanceProvider";
import { findTokenBySymbol } from "@/lib/tokenConfig";
import { useAmplifyCoingecko } from "@/hooks/useAmplifyCoingecko";

const TOP_TOKENS: AmplifyTokenSymbol[] = ["SOL", "ETH", "BTC"];
const CHART_TFS: ChartTimeframe[] = ["1H", "1D", "1W", "1M", "1Y", "ALL"];
const PRED_TFS: PredictionTimeframe[] = [
  "hourly",
  "daily",
  "monthly",
  "yearly",
];

export default function AmplifyPage() {
  const {
    loading: balanceLoading,
    displayCurrency,
    fxRate, // ✅ USD -> display currency
    usdcUsd,
  } = useBalance();

  const [activeSymbol, setActiveSymbol] = useState<AmplifyTokenSymbol>("SOL");
  const [chartTf, setChartTf] = useState<ChartTimeframe>("1D");
  const [predTf, setPredTf] = useState<PredictionTimeframe>("daily");

  const activeMeta = useMemo(
    () => findTokenBySymbol(activeSymbol),
    [activeSymbol]
  );

  const market = useAmplifyCoingecko({
    symbol: activeSymbol,
    timeframe: chartTf,
    fxRate,
  });

  const [multiplierPositions, setMultiplierPositions] = useState<
    MultiplierPosition[]
  >([]);
  const [predictionPositions, setPredictionPositions] = useState<
    PredictionPosition[]
  >([]);

  return (
    <div className="min-h-screen text-foreground">
      <div className="mx-auto w-full max-w-5xl px-3 pb-10 pt-4 sm:px-4 space-y-3">
        <AmplifyHeader
          tokens={TOP_TOKENS}
          activeToken={activeSymbol}
          onChangeToken={setActiveSymbol}
        />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-3">
            <PriceChartPanel
              tokenSymbol={activeSymbol}
              tokenName={activeMeta?.name ?? activeSymbol}
              tokenLogo={activeMeta?.logo ?? null}
              displayCurrency={displayCurrency}
              price={market.priceDisplay}
              pctChange={market.pct24h}
              timeframes={CHART_TFS}
              activeTimeframe={chartTf}
              onChangeTimeframe={setChartTf}
              chartData={market.chartData}
              loading={market.loading}
              error={market.error}
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <MultiplierPanel
                tokenSymbol={activeSymbol}
                displayCurrency={displayCurrency}
                depositBalance={usdcUsd}
                balanceLoading={balanceLoading}
                price={market.priceDisplay ?? 0}
                onOpenMock={(pos) =>
                  setMultiplierPositions((prev) => [pos, ...prev])
                }
              />

              <PredictionMarketsPanel
                tokenSymbol={activeSymbol}
                displayCurrency={displayCurrency}
                price={market.priceDisplay ?? 0}
                timeframes={PRED_TFS}
                activeTimeframe={predTf}
                onChangeTimeframe={setPredTf}
                onOpenMock={(pos) =>
                  setPredictionPositions((prev) => [pos, ...prev])
                }
              />
            </div>
          </div>

          <div className="lg:col-span-4">
            <PositionsPanel
              displayCurrency={displayCurrency}
              multiplierPositions={multiplierPositions}
              predictionPositions={predictionPositions}
              onClearMultiplier={() => setMultiplierPositions([])}
              onClearPredictions={() => setPredictionPositions([])}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
