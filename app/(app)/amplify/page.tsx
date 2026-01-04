"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
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

const TOP_TOKENS: AmplifyTokenSymbol[] = ["SOL", "ETH", "BTC"];
const CHART_TFS: ChartTimeframe[] = ["1H", "1D", "1W", "1M", "1Y", "ALL"];

export default function AmplifyPage() {
  const { user } = useUser();

  // IMPORTANT:
  // Use the SAME wallet the booster system expects.
  // If booster positions are tied to deposit wallet, swap this line to:
  // const ownerBase58 = (user?.depositWallet?.address || "").trim();
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

  // clear draft positions once chain rows actually exist
  useEffect(() => {
    if ((booster.rows?.length || 0) > 0) setMultiplierPositions([]);
  }, [booster.rows]);

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      console.error("[window.error]", e.message, e.error);
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("[unhandledrejection]", e.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // HARD GUARANTEE: never pass undefined arrays into children
  // This prevents `something.slice(...)` from crashing.
  const safeChartData = useMemo(() => {
    return Array.isArray(market.chartData) ? market.chartData : [];
  }, [market.chartData]);

  const safePct24h = Number.isFinite(market.pct24h) ? market.pct24h : 0;
  const safePriceDisplay: number =
    typeof market.priceDisplay === "number" &&
    Number.isFinite(market.priceDisplay)
      ? market.priceDisplay
      : 0;

  const safeBoosterRows = useMemo(() => {
    return Array.isArray(booster.rows) ? booster.rows : [];
  }, [booster.rows]);

  return (
    <div className="min-h-screen text-foreground">
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
              displayCurrency={displayCurrency}
              price={safePriceDisplay}
              pctChange={safePct24h}
              timeframes={CHART_TFS}
              activeTimeframe={chartTf}
              onChangeTimeframe={setChartTf}
              chartData={safeChartData} // ✅ never undefined
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
              fxDisplayPerUsd={fxRate} // display per 1 USD
              positions={multiplierPositions}
              onPositionsChange={setMultiplierPositions}
              onAfterAction={handleAfterAction}
            />

            <PositionsPanel
              ownerBase58={ownerBase58}
              displayCurrency={displayCurrency}
              fxRate={fxRate} // USD -> display
              rows={safeBoosterRows} // ✅ never undefined
              loading={!!booster.loading}
              onClosed={handleAfterAction}
            />

          {!ownerBase58 && user ? (
            <div className="text-xs text-amber-200/80">
              Wallet is still loading — positions will appear in a moment.
            </div>
          ) : null}

          {booster.error ? (
            <div className="text-xs text-rose-200/80">{booster.error}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
