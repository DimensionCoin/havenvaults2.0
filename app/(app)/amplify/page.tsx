"use client";

import React, { useMemo, useState, useCallback } from "react";

import AmplifyHeader from "@/components/amplify/AmplifyHeader";
import PriceChartPanel from "@/components/amplify/PriceChartPanel";
import MultiplierPanel from "@/components/amplify/MultiplierPanel";
import PositionsPanel from "@/components/amplify/PositionsPanel";

import type {
  AmplifyTokenSymbol,
  ChartTimeframe,
  MultiplierPosition,
} from "@/components/amplify/types";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { findTokenBySymbol } from "@/lib/tokenConfig";
import { useAmplifyCoingecko } from "@/hooks/useAmplifyCoingecko";
import { useBoosterPositions } from "@/hooks/useBoosterPositions";

/* ---------- constants ---------- */

const TOP_TOKENS: AmplifyTokenSymbol[] = ["SOL", "ETH", "BTC"];
const CHART_TFS: ChartTimeframe[] = ["1H", "1D", "1W", "1M", "1Y", "LIVE"];

export default function AmplifyPage() {
  const { user } = useUser();
  const ownerBase58 = (user?.walletAddress || "").trim();

  const {
    loading: balanceLoading,
    displayCurrency,
    fxRate,
    usdcUsd,
  } = useBalance();
  const depositBalanceDisplay = (usdcUsd || 0) * (fxRate || 1);

  const [activeSymbol, setActiveSymbol] = useState<AmplifyTokenSymbol>("SOL");
  const [chartTf, setChartTf] = useState<ChartTimeframe>("1D");

  const activeMeta = useMemo(
    () => findTokenBySymbol(activeSymbol),
    [activeSymbol]
  );

  const market = useAmplifyCoingecko({
    symbol: activeSymbol,
    timeframe: chartTf,
    fxRate,
    enabled: true,
  });

  const [refreshKey, setRefreshKey] = useState(0);

  const booster = useBoosterPositions({
    ownerBase58,
    refreshKey,
    enabled: !!ownerBase58,
  });

  const [multiplierPositions, setMultiplierPositions] = useState<
    MultiplierPosition[]
  >([]);

  const handleAfterAction = useCallback(() => {
    setTimeout(() => setRefreshKey((k) => k + 1), 1500);
  }, []);

  const safeChartData = useMemo(
    () => (Array.isArray(market.chartData) ? market.chartData : []),
    [market.chartData]
  );

  const safePct24h = Number.isFinite(market.pct24h ?? NaN)
    ? (market.pct24h as number)
    : 0;
  const safePriceDisplay =
    typeof market.priceDisplay === "number" &&
    Number.isFinite(market.priceDisplay)
      ? market.priceDisplay
      : 0;

  const safeBoosterRows = useMemo(
    () => (Array.isArray(booster.rows) ? booster.rows : []),
    [booster.rows]
  );

  return (
    <div className="min-h-screen text-foreground overflow-x-hidden">
      <div className="mx-auto w-full max-w-6xl px-3 pb-12 pt-4 sm:px-4 lg:px-6">
        <div className="mb-3">
          <AmplifyHeader
            tokens={TOP_TOKENS}
            activeToken={activeSymbol}
            onChangeToken={setActiveSymbol}
          />
        </div>

        <div className="space-y-3 lg:space-y-4">
          <PriceChartPanel
            tokenSymbol={activeSymbol}
            tokenName={activeMeta?.name ?? activeSymbol}
            tokenLogo={activeMeta?.logo ?? null}
            price={safePriceDisplay}
            pctChange={safePct24h}
            timeframes={CHART_TFS}
            activeTimeframe={chartTf}
            onChangeTimeframe={setChartTf}
            chartData={safeChartData}
            loading={market.loading}
            error={market.error}
          />

          <MultiplierPanel
            ownerBase58={ownerBase58}
            tokenSymbol={activeSymbol}
            displayCurrency={displayCurrency}
            depositBalance={depositBalanceDisplay}
            balanceLoading={balanceLoading}
            price={safePriceDisplay}
            fxDisplayPerUsd={fxRate}
            positions={multiplierPositions}
            onPositionsChange={setMultiplierPositions}
            onAfterAction={handleAfterAction}
          />

          <PositionsPanel
            ownerBase58={ownerBase58}
            displayCurrency={displayCurrency}
            fxRate={fxRate}
            rows={safeBoosterRows}
            loading={!!booster.loading}
            onClosed={handleAfterAction}
          />
        </div>
      </div>
    </div>
  );
}
