"use client";

import React, { useMemo, useState, useCallback } from "react";
import { Sparkles } from "lucide-react";

import AmplifyHeader from "@/components/amplify/AmplifyHeader";
import PriceChartPanel from "@/components/amplify/PriceChartPanel";
import MultiplierPanel from "@/components/amplify/MultiplierPanel";
import PositionsPanel from "@/components/amplify/PositionsPanel";
import PredictionMarketsPanel from "@/components/amplify/PredictionMarketsPanel";
import PredictionPositions from "@/components/amplify/PredictionPositions";
import type { PredictionPositionRow } from "@/components/amplify/PredictionPositions";

import type {
  AmplifyTokenSymbol,
  ChartTimeframe,
  MultiplierPosition,
  PredictionTimeframe,
  PredictionPosition,
} from "@/components/amplify/types";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { findTokenBySymbol } from "@/lib/tokenConfig";
import { useAmplifyCoingecko } from "@/hooks/useAmplifyCoingecko";
import { useBoosterPositions } from "@/hooks/useBoosterPositions";

/* ---------- constants ---------- */

const TOP_TOKENS: AmplifyTokenSymbol[] = ["SOL", "ETH", "BTC"];
const CHART_TFS: ChartTimeframe[] = ["1H", "1D", "1W", "1M", "1Y", "LIVE"];
const PREDICTION_TFS: PredictionTimeframe[] = [
  "hourly",
  "daily",
  "monthly",
  "yearly",
];

type AmplifyTab = "multiplier" | "predict";

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

  // Token & chart state
  const [activeSymbol, setActiveSymbol] = useState<AmplifyTokenSymbol>("SOL");
  const [chartTf, setChartTf] = useState<ChartTimeframe>("1D");

  // Tab state
  const [activeTab, setActiveTab] = useState<AmplifyTab>("multiplier");

  // Prediction state
  const [predictionTf, setPredictionTf] =
    useState<PredictionTimeframe>("daily");
  const [predictionPositions] = useState<PredictionPositionRow[]>([]);

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

  // Mock handler - disabled since predict is coming soon
  const handleOpenPrediction = useCallback((_pos: PredictionPosition) => {
    // No-op - predictions are disabled
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
          {/* Price Chart - always visible */}
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

          {/* Tab Selector */}
          <div className="flex items-center gap-1 rounded-2xl border border-border bg-card/40 p-1">
            <button
              onClick={() => setActiveTab("multiplier")}
              className={[
                "flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition border",
                activeTab === "multiplier"
                  ? "bg-primary text-black border-primary shadow-[0_0_18px_rgba(16,185,129,0.25)]"
                  : "bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-card/60",
              ].join(" ")}
            >
              Multiplier
            </button>
            <button
              onClick={() => setActiveTab("predict")}
              className={[
                "flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition border relative",
                activeTab === "predict"
                  ? "bg-primary text-black border-primary shadow-[0_0_18px_rgba(16,185,129,0.25)]"
                  : "bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-card/60",
              ].join(" ")}
            >
              Predict
              <span className="absolute -top-1 -right-1 inline-flex items-center rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-black">
                SOON
              </span>
            </button>
          </div>

          {/* Multiplier Tab Content */}
          {activeTab === "multiplier" && (
            <>
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
            </>
          )}

          {/* Predict Tab Content - with Coming Soon Overlay */}
          {activeTab === "predict" && (
            <div className="relative">
              {/* Blurred content underneath */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 lg:gap-4 pointer-events-none select-none blur-[6px] opacity-60">
                <PredictionMarketsPanel
                  tokenSymbol={activeSymbol}
                  displayCurrency={displayCurrency}
                  price={safePriceDisplay}
                  timeframes={PREDICTION_TFS}
                  activeTimeframe={predictionTf}
                  onChangeTimeframe={setPredictionTf}
                  onOpenMock={handleOpenPrediction}
                />

                <PredictionPositions
                  displayCurrency={displayCurrency}
                  fxRate={fxRate}
                  loading={false}
                  rows={predictionPositions}
                />
              </div>

              {/* Coming Soon Overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 rounded-3xl border border-primary/20 bg-card/95 backdrop-blur-sm px-8 py-6 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
                    <Sparkles className="h-7 w-7 text-primary" />
                  </div>

                  <div className="text-center">
                    <h3 className="text-lg font-bold text-foreground">
                      Predict is Coming Soon
                    </h3>
                    <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                      Bet on price movements with binary outcomes. Launching
                      soon.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2">
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-xs font-semibold text-foreground">
                      In Development
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
