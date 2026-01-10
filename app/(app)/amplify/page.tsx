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
import PredictionPositions from "@/components/amplify/PredictionPositions";

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
  { label: string; shortLabel: string; icon: React.ReactNode; badge?: string }
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

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: AmplifyTab;
  onTabChange: (t: AmplifyTab) => void;
}) {
  const tabs = useMemo(() => {
    return (Object.keys(TAB_META) as AmplifyTab[]).map((id) => ({
      id,
      label: TAB_META[id].label,
      shortLabel: TAB_META[id].shortLabel,
      icon: TAB_META[id].icon,
      badge: TAB_META[id].badge,
    }));
  }, []);

  return (
    <div className="w-full">
      <div className="grid w-full grid-cols-4 gap-1.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const showCount = !!tab.badge;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
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
              {tab.icon}

              <span className="min-w-0 truncate leading-none">
                <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </span>

              {showCount && (
                <span
                  className={[
                    "hidden sm:inline-flex",
                    "rounded-full px-1.5 py-0.5 text-[10px] border",
                    isActive
                      ? "bg-primary-foreground/10 text-primary-foreground border-primary-foreground/15"
                      : "bg-card/60 text-muted-foreground border-border/60",
                  ].join(" ")}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AmplifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  const isAmplifyTab = (v: string | null): v is AmplifyTab =>
    v === "multiplier" || v === "bundles" || v === "robo" || v === "predict";

  const [tab, setTab] = useState<AmplifyTab>(() => {
    const t = searchParams?.get("tab");
    return isAmplifyTab(t) ? t : "multiplier";
  });

  const [predictTf, setPredictTf] = useState<PredictionTimeframe>("daily");

  useEffect(() => {
    const t = searchParams?.get("tab");
    if (isAmplifyTab(t) && t !== tab) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = useCallback(
    (next: AmplifyTab) => {
      setTab(next);
      const params = new URLSearchParams(searchParams?.toString());
      params.set("tab", next);
      router.replace(`/amplify?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

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
    <div className="min-h-screen text-foreground overflow-x-hidden">
      <div className="mx-auto w-full max-w-6xl px-3 pb-12 pt-4 sm:px-4 lg:px-6">
        <div className="mb-3 space-y-3">
          <TabBar activeTab={tab} onTabChange={handleTabChange} />

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

                <div className="absolute inset-0 rounded-3xl border border-border/60 bg-background/40 backdrop-blur-sm">
                  <div className="flex h-full w-full items-center justify-center p-6">
                    <div className="text-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-4 py-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">
                          Predictions coming soon
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        We&apos;re polishing markets + settlement. You&apos;ll
                        see this soon.
                      </div>
                    </div>
                  </div>
                </div>
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

            {!ownerBase58 && user ? (
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                Wallet is still loading — positions will appear in a moment.
              </div>
            ) : null}

            {booster.error ? (
              <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                {booster.error}
              </div>
            ) : null}
          </div>
        ) : tab === "bundles" ? (
          <div className="space-y-4">
            <BundlesPanel ownerBase58={ownerBase58} />
          </div>
        ) : tab === "robo" ? (
          <div className="h-[calc(100vh-180px)] min-h-[500px]">
            <Chat />
          </div>
        ) : null}
      </div>
    </div>
  );
}
