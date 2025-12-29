// components/for-you/ForYouSwipeDeck.tsx
"use client";

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import Image from "next/image";
import { X, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TokenRecommendation } from "@/lib/recommendations";
import { getCluster, getMintFor, type TokenCategory } from "@/lib/tokenConfig";
import toast from "react-hot-toast";

type SwipeAction = "save" | "skip";

type BannerState = {
  id: number;
  action: SwipeAction;
  symbol: string;
};

const SWIPE_PX = 110;
const SWIPE_VELOCITY = 650;

// 🔹 Minimal shape of market data for the deck.
type MarketSnapshot = {
  price?: number | null;
  priceChange24hPct?: number | null;
  mcap?: number | null;
};

export type ForYouSwipeDeckProps = {
  recommendations: TokenRecommendation[];
  marketDataByMint?: Record<string, MarketSnapshot>;
  marketLoading?: boolean;
  onFinished?: () => void;
};

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function formatUsd(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: n < 1 ? 6 : 2,
    }).format(n);
  } catch {
    return String(n);
  }
}

function formatPct(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function formatCompact(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return String(n);
  }
}

/* ------------------------------------------------------------------ */
/* Banner                                                             */
/* ------------------------------------------------------------------ */

function DecisionBanner({ banner }: { banner: BannerState }) {
  const isSave = banner.action === "save";

  return (
    <motion.div
      key={banner.id}
      initial={{ y: -18, opacity: 0, scale: 0.98 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -14, opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className="
        pointer-events-none
        inline-flex items-center gap-2
        rounded-2xl
        border border-zinc-800
        bg-black/70
        backdrop-blur-2xl
        px-3 py-1.5
        shadow-[0_18px_60px_rgba(0,0,0,0.7)]
      "
    >
      <span
        className={`
          inline-flex h-6 w-6 items-center justify-center rounded-full
          border
          ${
            isSave
              ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-200"
              : "border-zinc-600/60 bg-zinc-700/30 text-zinc-100"
          }
        `}
      >
        {isSave ? (
          <Heart className="h-3.5 w-3.5" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
      </span>

      <div className="flex items-baseline gap-1.5">
        <span
          className={`
            text-[10px] font-semibold tracking-[0.22em]
            ${isSave ? "text-emerald-200" : "text-zinc-200"}
          `}
        >
          {isSave ? "ADDED" : "SKIPPED"}
        </span>
        <span className="text-[10px] text-zinc-400">{banner.symbol}</span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                               */
/* ------------------------------------------------------------------ */

function RecommendationCard({
  symbol,
  name,
  categories,
  logo,
  reasons,
  market,
  marketLoading,
  isTop,
  disabled,
  onSwipe,
  exitAction,
}: {
  symbol: string;
  name: string;
  categories?: TokenCategory[];
  logo: string;
  reasons: string[];
  market?: MarketSnapshot;
  marketLoading?: boolean;
  isTop: boolean;
  disabled?: boolean;
  onSwipe: (action: SwipeAction) => void;
  exitAction: SwipeAction | null;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-10, 0, 10]);

  // right → save, left → skip
  const saveOpacity = useTransform(x, [0, 70, 220], [0, 0.4, 1]);
  const skipOpacity = useTransform(x, [-220, -70, 0], [1, 0.4, 0]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (disabled) return;

    const { offset, velocity } = info;

    // left = skip
    if (offset.x < -SWIPE_PX || velocity.x < -SWIPE_VELOCITY) {
      onSwipe("skip");
      return;
    }

    // right = save
    if (offset.x > SWIPE_PX || velocity.x > SWIPE_VELOCITY) {
      onSwipe("save");
      return;
    }
  };

  const primaryReason = reasons[0] ?? "";
  const secondaryReason = reasons[1] ?? "";

  const price = market?.price ?? null;
  const change24h = market?.priceChange24hPct ?? null;
  const mcap = market?.mcap ?? null;

  const changePositive = typeof change24h === "number" && change24h > 0;
  const changeNegative = typeof change24h === "number" && change24h < 0;

  const cats = categories ?? [];
  const primaryCat = cats[0]; // for compact display
  const extraCats = cats.slice(1);

  return (
    <motion.div
      className="
        absolute inset-0
        overflow-hidden
        rounded-3xl
        border border-zinc-800
        bg-black
        shadow-[0_30px_90px_rgba(0,0,0,0.80)]
      "
      style={isTop ? { x, rotate } : undefined}
      drag={isTop && !disabled ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.08}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.98, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={
        exitAction
          ? {
              x: exitAction === "save" ? 520 : -520,
              rotate: exitAction === "save" ? 10 : -10,
              opacity: 0,
            }
          : { opacity: 0 }
      }
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
    >
      {/* Full-bleed background */}
      <div className="absolute inset-0">
        <Image
          src={logo}
          alt={symbol}
          fill
          sizes="(max-width: 768px) 100vw, 420px"
          className="h-full w-full scale-110 object-cover opacity-90 blur-xs"
        />
        <div className="absolute inset-0 bg-black/20" />
      </div>

      {/* Swipe stamps */}
      {isTop && (
        <>
          <motion.div
            style={{ opacity: skipOpacity }}
            className="
              absolute left-4 top-6
              rounded-xl
              border border-zinc-600/70
              bg-zinc-900/80
              px-3 py-1.5
              text-[10px] font-semibold tracking-[0.28em]
              text-zinc-200
              backdrop-blur
            "
          >
            SKIP
          </motion.div>

          <motion.div
            style={{ opacity: saveOpacity }}
            className="
              absolute right-4 top-6
              rounded-xl
              border border-emerald-300/70
              bg-emerald-400/15
              px-3 py-1.5
              text-[10px] font-semibold tracking-[0.28em]
              text-emerald-200
              backdrop-blur
            "
          >
            SAVE
          </motion.div>
        </>
      )}

      {/* Bottom info panel */}
      <div className="absolute inset-x-0 bottom-0">
        <div className="border-t border-zinc-800/80 bg-black/80 backdrop-blur-md">
          <div
            className="px-4 pt-3"
            style={{
              paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex flex-col gap-3">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-10 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
                    <Image
                      src={logo}
                      alt={symbol}
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] uppercase tracking-[0.22em] text-zinc-500">
                      {symbol}
                    </div>
                    <div className="mt-0.5 truncate text-[18px] font-semibold text-zinc-50">
                      {name}
                    </div>

                    {/* ✅ multi-category pills */}
                    {primaryCat && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300">
                          {primaryCat}
                        </span>

                        {extraCats.slice(0, 2).map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center rounded-full bg-zinc-900/70 px-2 py-0.5 text-[10px] text-zinc-400"
                          >
                            {c}
                          </span>
                        ))}

                        {extraCats.length > 2 && (
                          <span className="inline-flex items-center rounded-full bg-zinc-900/70 px-2 py-0.5 text-[10px] text-zinc-500">
                            +{extraCats.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Simple market row */}
              <div className="flex items-end justify-between gap-3 rounded-xl bg-zinc-900/80 px-3 py-2">
                <div>
                  <div className="text-[8px] uppercase tracking-[0.16em] text-zinc-500">
                    Price
                  </div>
                  <div className="text-[14px] font-semibold text-zinc-50">
                    {marketLoading && price == null
                      ? "Loading…"
                      : formatUsd(price ?? undefined)}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[8px] uppercase tracking-[0.16em] text-zinc-500">
                    24h
                  </div>
                  <div
                    className={`
                      inline-flex items-center rounded-full px-2 py-0.5 text-[10px]
                      ${
                        !change24h && change24h !== 0
                          ? "text-zinc-300 bg-zinc-800/80"
                          : changePositive
                          ? "bg-emerald-400/15 text-emerald-300"
                          : changeNegative
                          ? "bg-red-400/15 text-red-300"
                          : "bg-zinc-800/80 text-zinc-200"
                      }
                    `}
                  >
                    {marketLoading && change24h == null
                      ? "—"
                      : formatPct(change24h ?? undefined)}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[8px] uppercase tracking-[0.16em] text-zinc-500">
                    Mcap
                  </div>
                  <div className="text-[11px] font-semibold text-zinc-50">
                    {marketLoading && mcap == null
                      ? "—"
                      : formatCompact(mcap ?? undefined)}
                  </div>
                </div>
              </div>

              {/* Reasons */}
              <div className="space-y-1.5 text-[11px] text-zinc-300">
                {primaryReason && (
                  <p className="leading-snug">{primaryReason}</p>
                )}
                {secondaryReason && (
                  <p className="leading-snug text-[10px] text-zinc-400">
                    {secondaryReason}
                  </p>
                )}
              </div>

              {/* Controls */}
              <div className="mt-1 flex flex-col gap-1.5">
                <div className="flex items-center justify-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => onSwipe("skip")}
                    className="
                      h-10 w-10
                      rounded-full
                      border-zinc-700
                      bg-zinc-900
                      text-zinc-100
                      hover:bg-zinc-800
                    "
                    title="Skip (swipe left)"
                  >
                    <X className="h-4 w-4" />
                  </Button>

                  <Button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSwipe("save")}
                    className="
                      h-12 w-12
                      rounded-full
                      bg-[rgb(182,255,62)]
                      text-black
                      hover:bg-[rgb(182,255,62)]/90
                      shadow-[0_10px_22px_rgba(0,0,0,0.45)]
                    "
                    title="Save to wishlist (swipe right)"
                  >
                    <Heart className="h-5 w-5 fill-black" />
                  </Button>
                </div>

                <div className="flex items-center justify-between text-[9px] text-zinc-500">
                  <span>Swipe left to skip</span>
                  <span>Swipe right to save</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Deck                                                               */
/* ------------------------------------------------------------------ */

export const ForYouSwipeDeck: React.FC<ForYouSwipeDeckProps> = ({
  recommendations,
  marketDataByMint,
  marketLoading,
  onFinished,
}) => {
  const [index, setIndex] = useState(0);
  const [exitAction, setExitAction] = useState<SwipeAction | null>(null);
  const [busy, setBusy] = useState(false);

  const [banner, setBanner] = useState<BannerState | null>(null);
  const bannerTimerRef = useRef<number | null>(null);
  const bannerIdRef = useRef(1);

  const cluster = useMemo(() => getCluster(), []);
  const active = recommendations[index];
  const next = recommendations[index + 1];

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) {
        window.clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  const showBanner = useCallback((action: SwipeAction, symbol: string) => {
    const id = bannerIdRef.current++;
    setBanner({ id, action, symbol });

    if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = window.setTimeout(() => {
      setBanner((b) => (b?.id === id ? null : b));
    }, 900);
  }, []);

  const handleDecision = useCallback(
    async (action: SwipeAction) => {
      if (!active || busy) return;

      setBusy(true);

      if (action === "save") {
        const mint = getMintFor(active.token, cluster);
        if (mint) {
          try {
            const res = await fetch("/api/user/wishlist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mint }),
            });

            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              console.error("[wishlist] POST failed:", data);
              toast.error(data.error || "Could not save to wishlist");
            } else {
              toast.success(`Added ${active.token.symbol} to wishlist`, {
                duration: 1400,
              });
            }
          } catch (e) {
            console.error("[wishlist] POST error:", e);
            toast.error("Could not save to wishlist");
          }
        }
      }

      setExitAction(action);
      showBanner(action, active.token.symbol);

      window.setTimeout(() => {
        setIndex((i) => i + 1);
        setExitAction(null);
        setBusy(false);
      }, 170);
    },
    [active, busy, cluster, showBanner]
  );

  const onSwipe = useCallback(
    (action: SwipeAction) => {
      void handleDecision(action);
    },
    [handleDecision]
  );

  const finished = !active && recommendations.length > 0;
  const empty = recommendations.length === 0;

  // Helper to get market data per recommendation
  const getMarketForRec = (rec?: TokenRecommendation) => {
    if (!rec || !marketDataByMint) return undefined;
    const mint = getMintFor(rec.token, cluster);
    if (!mint) return undefined;
    return marketDataByMint[mint];
  };

  const activeMarket = getMarketForRec(active);
  const nextMarket = getMarketForRec(next);

  return (
    <div className="relative h-full w-full">
      {/* Banner */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex justify-center pt-3">
        <AnimatePresence>
          {banner && <DecisionBanner banner={banner} />}
        </AnimatePresence>
      </div>

      {/* Frame */}
      <div className="relative mx-auto flex h-full max-h-[620px] w-full max-w-sm items-center justify-center">
        {empty && (
          <div className="flex h-64 w-full items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-950">
            <div className="text-center text-sm text-zinc-300">
              <div>No recommendations available</div>
              <div className="mt-1 text-[11px] text-zinc-500">
                Try funding your wallet or buying your first asset.
              </div>
            </div>
          </div>
        )}

        {finished && !empty && (
          <div className="flex h-64 w-full flex-col items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-950">
            <div className="text-sm font-medium text-zinc-100">
              You&apos;re all caught up
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              New ideas will appear as your portfolio evolves.
            </div>
            {onFinished && (
              <Button
                className="mt-4 rounded-full bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
                type="button"
                onClick={onFinished}
              >
                Close
              </Button>
            )}
          </div>
        )}

        {/* Next card (behind) */}
        {next && (
          <div className="absolute inset-0 scale-[0.97] opacity-70">
            <RecommendationCard
              symbol={next.token.symbol}
              name={next.token.name}
              categories={next.token.categories}
              logo={next.token.logo}
              reasons={next.reasons}
              market={nextMarket}
              marketLoading={marketLoading}
              isTop={false}
              onSwipe={() => {}}
              disabled
              exitAction={null}
            />
          </div>
        )}

        {/* Active card */}
        <AnimatePresence mode="popLayout">
          {active && (
            <RecommendationCard
              key={active.token.symbol + index}
              symbol={active.token.symbol}
              name={active.token.name}
              categories={active.token.categories}
              logo={active.token.logo}
              reasons={active.reasons}
              market={activeMarket}
              marketLoading={marketLoading}
              isTop
              disabled={busy}
              onSwipe={onSwipe}
              exitAction={exitAction}
            />
          )}
        </AnimatePresence>

        {/* Initial loading overlay if deck mounts before recs */}
        {!finished && !active && empty && (
          <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-zinc-950/90">
            <div className="inline-flex items-center gap-2 text-xs text-zinc-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading ideas…
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
