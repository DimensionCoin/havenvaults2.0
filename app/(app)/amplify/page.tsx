"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";

import AmplifyHeader from "@/components/amplify/AmplifyHeader";
import PriceChartPanel from "@/components/amplify/PriceChartPanel";
import MultiplierPanel from "@/components/amplify/MultiplierPanel";
import PredictionMarketsPanel from "@/components/amplify/PredictionMarketsPanel";
import PositionsPanel from "@/components/amplify/PositionsPanel";

import type {
  AmplifyTokenSymbol,
  ChartTimeframe,
  MultiplierPosition,
  PredictionTimeframe,
} from "@/components/amplify/types";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { findTokenBySymbol } from "@/lib/tokenConfig";
import { useAmplifyCoingecko } from "@/hooks/useAmplifyCoingecko";
import { useBoosterPositions } from "@/hooks/useBoosterPositions";

import { Layers, Bot, Sparkles, BarChart3 } from "lucide-react";

const TOP_TOKENS: AmplifyTokenSymbol[] = ["SOL", "ETH", "BTC"];
const CHART_TFS: ChartTimeframe[] = ["1H", "1D", "1W", "1M", "1Y", "LIVE"];

const PREDICT_TFS: PredictionTimeframe[] = [
  "hourly",
  "daily",
  "monthly",
  "yearly",
];

type AmplifyTab = "multiplier" | "bundles" | "robo" | "predict";

const TAB_META: Record<
  AmplifyTab,
  { label: string; icon: React.ReactNode; badge?: string }
> = {
  multiplier: {
    label: "Multiplier",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
  },
  bundles: { label: "Bundles", icon: <Layers className="h-3.5 w-3.5" /> },
  robo: { label: "Robo Invest", icon: <Bot className="h-3.5 w-3.5" /> },
  predict: { label: "Predict", icon: <Sparkles className="h-3.5 w-3.5" /> },
};

function TabBar({
  active,
  onChange,
}: {
  active: AmplifyTab;
  onChange: (t: AmplifyTab) => void;
}) {
  return (
    <div className="glass-panel-soft px-3 py-2">
      <div className="no-scrollbar -mx-2 flex gap-2 overflow-x-auto px-2">
        {(Object.keys(TAB_META) as AmplifyTab[]).map((key) => {
          const t = TAB_META[key];
          const isActive = key === active;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={[
                "shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition",
                "border",
                isActive
                  ? "bg-primary text-primary-foreground border-emerald-300/30 shadow-[0_0_0_1px_rgba(63,243,135,0.85)]"
                  : "border-white/10 bg-black/40 text-slate-200 hover:bg-white/5 hover:text-emerald-300",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex items-center justify-center",
                  isActive ? "text-black" : "text-slate-200",
                ].join(" ")}
              >
                {t.icon}
              </span>
              <span>{t.label}</span>
              {t.badge ? (
                <span
                  className={[
                    "ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    isActive
                      ? "bg-black/20 text-black"
                      : "bg-white/10 text-white/60",
                  ].join(" ")}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlaceholderPanel({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="glass-panel-soft p-5">
      <div className="glass-pill">{title}</div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 p-4">
        <div className="text-sm font-semibold text-white/85">{subtitle}</div>
        <div className="mt-1 text-xs text-white/45">
          Replace this panel with the real components/layout for this tab.
        </div>
      </div>
    </div>
  );
}

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

  const [tab, setTab] = useState<AmplifyTab>("multiplier");

  // ✅ FIX: these hooks MUST be inside the component
  const [predictTf, setPredictTf] = useState<PredictionTimeframe>("daily");

  const activeMeta = useMemo(
    () => findTokenBySymbol(activeSymbol),
    [activeSymbol]
  );

  // multiplier + predict share the same layout
  const isTradingStyleTab = tab === "multiplier" || tab === "predict";

  const market = useAmplifyCoingecko({
    symbol: activeSymbol,
    timeframe: chartTf,
    fxRate,
    enabled: isTradingStyleTab,
  });

  const [refreshKey, setRefreshKey] = useState(0);

  const booster = useBoosterPositions({
    ownerBase58,
    refreshKey,
    enabled: !!ownerBase58 && isTradingStyleTab,
  });

  const [multiplierPositions, setMultiplierPositions] = useState<
    MultiplierPosition[]
  >([]);

  const handleAfterAction = useCallback(() => {
    setTimeout(() => setRefreshKey((k) => k + 1), 1500);
  }, []);

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

  const safeChartData = useMemo(() => {
    return Array.isArray(market.chartData) ? market.chartData : [];
  }, [market.chartData]);

  const safePct24h = Number.isFinite(market.pct24h ?? NaN)
    ? (market.pct24h as number)
    : 0;

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
        <div className="mb-3 space-y-3">
          <TabBar active={tab} onChange={setTab} />

          {isTradingStyleTab && (
            <AmplifyHeader
              tokens={TOP_TOKENS}
              activeToken={activeSymbol}
              onChangeToken={setActiveSymbol}
            />
          )}
        </div>

        {isTradingStyleTab ? (
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

            {tab === "multiplier" ? (
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
            ) : (
              <PredictionMarketsPanel
                tokenSymbol={activeSymbol}
                displayCurrency={displayCurrency}
                price={safePriceDisplay}
                timeframes={PREDICT_TFS}
                activeTimeframe={predictTf}
                onChangeTimeframe={setPredictTf}
                onOpenMock={(pos) => {
                  handleAfterAction();
                }}
              />
            )}

            {/* NOTE: This still shows booster positions.
               If Predict needs its own positions UI, we should swap this too later. */}
            <PositionsPanel
              ownerBase58={ownerBase58}
              displayCurrency={displayCurrency}
              fxRate={fxRate}
              rows={safeBoosterRows}
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
        ) : tab === "bundles" ? (
          <div className="space-y-4">
            <PlaceholderPanel
              title="Bundles"
              subtitle="Pre-built portfolios you can buy in one tap."
            />
          </div>
        ) : (
          <div className="space-y-4">
            <PlaceholderPanel
              title="Robo Invest"
              subtitle="Set a risk level and let Haven auto-rebalance."
            />
          </div>
        )}
      </div>
    </div>
  );
}
