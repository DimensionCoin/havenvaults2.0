"use client";

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";

import AmplifyHeader from "@/components/amplify/AmplifyHeader";
import PriceChartPanel from "@/components/amplify/PriceChartPanel";
import MultiplierPanel from "@/components/amplify/MultiplierPanel";
import PredictionMarketsPanel from "@/components/amplify/PredictionMarketsPanel";
import PositionsPanel from "@/components/amplify/PositionsPanel";
import BundlesPanel from "@/components/bundles/BundlesPanel";

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
  activeTab,
  onTabChange,
}: {
  activeTab: AmplifyTab;
  onTabChange: (t: AmplifyTab) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const tabs = useMemo(() => {
    return (Object.keys(TAB_META) as AmplifyTab[]).map((id) => ({
      id,
      label: TAB_META[id].label,
      icon: TAB_META[id].icon,
      badge: TAB_META[id].badge,
    }));
  }, []);

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const button = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();

      if (buttonRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - buttonRect.left + 16;
      } else if (buttonRect.right > containerRect.right) {
        container.scrollLeft += buttonRect.right - containerRect.right + 16;
      }
    }
  }, [activeTab]);

  return (
    <div
      ref={scrollRef}
      className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const showCount = !!tab.badge;

        return (
          <button
            key={tab.id}
            ref={isActive ? activeRef : undefined}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={[
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              "border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
              isActive
                ? "bg-primary text-primary-foreground border-primary/25"
                : "bg-card/40 text-muted-foreground border-border/60 hover:bg-card/60 hover:text-foreground",
            ].join(" ")}
          >
            {tab.icon}
            <span className="whitespace-nowrap">{tab.label}</span>

            {showCount && (
              <span
                className={[
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
    <div className="glass-panel bg-card/30 p-5">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs font-semibold text-foreground/85">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {title}
      </div>

      <div className="mt-3 rounded-2xl border border-border/60 bg-card/30 p-4">
        <div className="text-sm font-semibold text-foreground/90">
          {subtitle}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
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
          <TabBar activeTab={tab} onTabChange={setTab} />

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
                {/* The real panel stays mounted, but is blurred/disabled */}
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

                {/* Overlay */}
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
