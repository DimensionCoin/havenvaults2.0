"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AmplifyHeader from "@/components/amplify/AmplifyHeader";
import PriceChartPanel from "@/components/amplify/PriceChartPanel";
import MultiplierPanel from "@/components/amplify/MultiplierPanel";
import PredictionMarketsPanel from "@/components/amplify/PredictionMarketsPanel";
import PositionsPanel from "@/components/amplify/PositionsPanel";
import BundlesPanel from "@/components/bundles/BundlesPanel";
import Chat from "@/components/robo/Chat";
import PredictionPositions from "@/components/amplify/PredictionPositions";

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

/* ---------- constants ---------- */

export type AmplifyTab = "multiplier" | "bundles" | "robo" | "predict";
const DEFAULT_TAB: AmplifyTab = "bundles";

const TOP_TOKENS: AmplifyTokenSymbol[] = ["SOL", "ETH", "BTC"];
const CHART_TFS: ChartTimeframe[] = ["1H", "1D", "1W", "1M", "1Y", "LIVE"];
const PREDICT_TFS: PredictionTimeframe[] = [
  "hourly",
  "daily",
  "monthly",
  "yearly",
];

const TAB_META: Record<
  AmplifyTab,
  { label: string; shortLabel: string; icon: React.ReactNode }
> = {
  bundles: {
    label: "Bundles",
    shortLabel: "Bundles",
    icon: <Layers className="h-3.5 w-3.5" />,
  },
  robo: {
    label: "Robo Invest",
    shortLabel: "Robo",
    icon: <Bot className="h-3.5 w-3.5" />,
  },
  multiplier: {
    label: "Multiplier",
    shortLabel: "Multi",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
  },
  predict: {
    label: "Predict",
    shortLabel: "Predict",
    icon: <Sparkles className="h-3.5 w-3.5" />,
  },
};

function isAmplifyTab(v: unknown): v is AmplifyTab {
  return (
    v === "multiplier" || v === "bundles" || v === "robo" || v === "predict"
  );
}

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: AmplifyTab;
  onTabChange: (t: AmplifyTab) => void;
}) {
  const tabs = useMemo(
    () =>
      (Object.keys(TAB_META) as AmplifyTab[]).map((id) => ({
        id,
        label: TAB_META[id].label,
        shortLabel: TAB_META[id].shortLabel,
        icon: TAB_META[id].icon,
      })),
    []
  );

  return (
    <div className="w-full">
      <div className="grid w-full grid-cols-4 gap-1.5">
        {tabs.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={[
                "w-full min-w-0",
                "inline-flex items-center justify-center gap-1.5 rounded-full",
                "flex-col px-2 py-2 text-[11px] sm:flex-row sm:px-3 sm:py-1.5 sm:text-xs",
                "font-semibold transition-all border",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
                isActive
                  ? "bg-primary text-primary-foreground border-primary/25"
                  : "bg-card/40 text-muted-foreground border-border/60 hover:bg-card/60 hover:text-foreground",
              ].join(" ")}
            >
              {t.icon}
              <span className="min-w-0 truncate leading-none">
                <span className="sm:hidden">{t.shortLabel}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AmplifyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ✅ read from URL
  const urlTab = searchParams.get("tab");
  const derivedTab: AmplifyTab = isAmplifyTab(urlTab) ? urlTab : DEFAULT_TAB;

  // ✅ local state for instant UI
  const [tab, setTab] = useState<AmplifyTab>(derivedTab);

  // ✅ keep state synced when URL changes
  useEffect(() => {
    setTab(derivedTab);
  }, [derivedTab]);

  // ✅ change tab by updating query string
  const setTabAndUrl = useCallback(
    (next: AmplifyTab) => {
      setTab(next);

      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_TAB) params.delete("tab");
      else params.set("tab", next);

      const qs = params.toString();
      router.replace(qs ? `/amplify?${qs}` : "/amplify", { scroll: false });
    },
    [router, searchParams]
  );

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
  const [predictTf, setPredictTf] = useState<PredictionTimeframe>("daily");

  const activeMeta = useMemo(
    () => findTokenBySymbol(activeSymbol),
    [activeSymbol]
  );

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
        <div className="mb-3 space-y-3">
          <TabBar activeTab={tab} onTabChange={setTabAndUrl} />

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
              <div className="relative">
                <div className="pointer-events-none select-none blur-[1px] opacity-70">
                  <PredictionMarketsPanel
                    tokenSymbol={activeSymbol}
                    displayCurrency={displayCurrency}
                    price={safePriceDisplay}
                    timeframes={PREDICT_TFS}
                    activeTimeframe={predictTf}
                    onChangeTimeframe={setPredictTf}
                    onOpenMock={() => {}}
                  />
                </div>
                <div className="absolute inset-0 rounded-3xl border border-border/60 bg-background/40 backdrop-blur-sm" />
              </div>
            )}

            {tab === "multiplier" ? (
              <PositionsPanel
                ownerBase58={ownerBase58}
                displayCurrency={displayCurrency}
                fxRate={fxRate}
                rows={safeBoosterRows}
                loading={!!booster.loading}
                onClosed={handleAfterAction}
              />
            ) : (
              <PredictionPositions
                displayCurrency={displayCurrency}
                fxRate={fxRate}
                loading={false}
                rows={[]}
              />
            )}
          </div>
        ) : tab === "bundles" ? (
          <div className="space-y-4">
            <BundlesPanel ownerBase58={ownerBase58} />
          </div>
        ) : tab === "robo" ? (
          <div className="h-[calc(100dvh-180px)] min-h-[500px]">
            <Chat />
          </div>
        ) : null}
      </div>
    </div>
  );
}
