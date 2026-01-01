"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Info,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
  type TokenCategory,
} from "@/lib/tokenConfig";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { useServerSponsoredUsdcSwap } from "@/hooks/useServerSponsoredUsdcSwap";

const CLUSTER = getCluster();

const SWAP_FEE_PCT =
  Number(process.env.NEXT_PUBLIC_CRYPTO_SWAP_FEE_UI ?? "0") || 0;
const SWAP_FEE_PCT_DISPLAY = SWAP_FEE_PCT * 100;

/* --------------------------------------------------------------------- */
/* Types                                                                 */
/* --------------------------------------------------------------------- */

type ResolvedToken = {
  meta: TokenMeta;
  mint: string;
};

type HistoricalPoint = { t: number; price: number }; // USD from API
type HistoricalApiResponse = { id: string; prices: HistoricalPoint[] };

type SpotResp = {
  prices: Record<
    string,
    { priceUsd: number; priceChange24hPct: number | null }
  >;
};

type TimeframeKey = "1D" | "7D" | "30D" | "90D";

const TIMEFRAMES: Record<TimeframeKey, { label: string; days: string }> = {
  "1D": { label: "24H", days: "1" },
  "7D": { label: "7D", days: "7" },
  "30D": { label: "30D", days: "30" },
  "90D": { label: "90D", days: "90" },
};

/* --------------------------------------------------------------------- */
/* Helpers                                                               */
/* --------------------------------------------------------------------- */

const resolveTokenFromSlug = (slug: string): ResolvedToken | null => {
  const normalized = slug.toLowerCase();

  for (const meta of TOKENS) {
    const mint = getMintFor(meta, CLUSTER);
    if (!mint) continue;

    const symbol = meta.symbol?.toLowerCase();
    const id = meta.id?.toLowerCase();
    const mintLower = mint.toLowerCase();

    if (
      normalized === id ||
      normalized === symbol ||
      normalized === mintLower
    ) {
      return { meta, mint };
    }
  }

  return null;
};

const formatCurrency = (v?: number | null, currency: string = "USD") => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: n < 1 ? 6 : 2,
  });
};

const formatPct = (v?: number | null) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "0.00%";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
};

const formatQty = (v?: number | null, maxFrac = 6) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
};

const clampNumber = (n: number) => (Number.isFinite(n) ? n : 0);

const safeParse = (s: string) => {
  const n = parseFloat((s || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/* --------------------------------------------------------------------- */
/* Sleek hover chart (Amplify-style)                                     */
/* --------------------------------------------------------------------- */

type SleekPoint = { t: number; y: number }; // display currency y

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatTimeLabel(t: number, tf: TimeframeKey) {
  const d = new Date(t);
  if (tf === "1D") {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SleekLineChart({
  data,
  height = 210,
  displayCurrency,
  timeframe,
}: {
  data: SleekPoint[];
  height?: number;
  displayCurrency: string;
  timeframe: TimeframeKey;
}) {
  const width = 640;
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  const computed = useMemo(() => {
    if (!data || data.length < 2) {
      return {
        pathD: "",
        minY: 0,
        maxY: 0,
        min: 0,
        max: 1,
        scaleX: (_i: number) => 0,
        scaleY: (_y: number) => height,
      };
    }

    const ys = data.map((d) => d.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const pad = (maxY - minY) * 0.15 || 1;
    const min = minY - pad;
    const max = maxY + pad;

    const scaleX = (i: number) => (i / (data.length - 1)) * width;
    const scaleY = (y: number) => {
      const t = (y - min) / (max - min);
      return height - t * height;
    };

    const pathD = data
      .map((p, i) => {
        const x = scaleX(i);
        const y = scaleY(p.y);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    return { pathD, minY, maxY, min, max, scaleX, scaleY };
  }, [data, height]);

  const activeIdx =
    hoverIdx === null ? null : clamp(hoverIdx, 0, Math.max(0, data.length - 1));
  const activePoint = activeIdx !== null ? data[activeIdx] : null;

  const activeX = activeIdx !== null ? computed.scaleX(activeIdx) : null;
  const activeY = activePoint ? computed.scaleY(activePoint.y) : null;

  const onPointerMove = (e: React.PointerEvent) => {
    if (!wrapRef.current || data.length < 2) return;

    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = rect.width > 0 ? px / rect.width : 0;
    const idx = Math.round(frac * (data.length - 1));

    setIsHovering(true);
    setHoverIdx(clamp(idx, 0, data.length - 1));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onPointerMove(e);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {}
  };

  const onLeave = () => {
    setIsHovering(false);
    setHoverIdx(null);
  };

  const tooltip = useMemo(() => {
    if (!activePoint || activeX === null || activeY === null) return null;

    const leftPct = (activeX / width) * 100;
    const topPct = (activeY / height) * 100;

    const clampedLeft = clamp(leftPct, 6, 78);
    const clampedTop = clamp(topPct - 18, 4, 72);

    return {
      leftPct,
      topPct,
      boxLeftPct: clampedLeft,
      boxTopPct: clampedTop,
      priceText: formatCurrency(activePoint.y, displayCurrency),
      timeText: formatTimeLabel(activePoint.t, timeframe),
    };
  }, [activePoint, activeX, activeY, displayCurrency, timeframe]);

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[210px] w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="havenLineFade" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--chart-1, rgb(16 185 129))"
              stopOpacity="0.26"
            />
            <stop
              offset="100%"
              stopColor="var(--chart-1, rgb(16 185 129))"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>

        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1="0"
            x2={width}
            y1={height * t}
            y2={height * t}
            stroke="white"
            strokeOpacity="0.06"
            strokeWidth="1"
          />
        ))}

        {computed.pathD && (
          <path
            d={`${computed.pathD} L ${width} ${height} L 0 ${height} Z`}
            fill="url(#havenLineFade)"
          />
        )}

        {computed.pathD && (
          <path
            d={computed.pathD}
            fill="none"
            stroke="var(--chart-1, rgb(16 185 129))"
            strokeOpacity="0.85"
            strokeWidth="2.2"
          />
        )}

        {isHovering && activeX !== null && activeY !== null && (
          <>
            <line
              x1={activeX}
              x2={activeX}
              y1={0}
              y2={height}
              stroke="white"
              strokeOpacity="0.10"
              strokeWidth="1"
            />
            <circle
              cx={activeX}
              cy={activeY}
              r="4.5"
              fill="black"
              fillOpacity="0.9"
              stroke="var(--chart-1, rgb(16 185 129))"
              strokeWidth="2"
            />
          </>
        )}

        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onLeave}
          onPointerCancel={onLeave}
        />
      </svg>

      {tooltip && isHovering && (
        <div
          className="pointer-events-none absolute rounded-2xl border border-white/10 bg-black/85 px-3 py-2 shadow-xl backdrop-blur-sm"
          style={{
            left: `${tooltip.boxLeftPct}%`,
            top: `${tooltip.boxTopPct}%`,
            maxWidth: "72%",
          }}
        >
          <div className="text-sm font-semibold text-white/90">
            {tooltip.priceText}
          </div>
          <div className="mt-0.5 text-[11px] text-white/45">
            {tooltip.timeText}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[11px] text-white/35">
        <span>
          Low:{" "}
          {computed.minY ? formatCurrency(computed.minY, displayCurrency) : "—"}
        </span>
        <span>
          High:{" "}
          {computed.maxY ? formatCurrency(computed.maxY, displayCurrency) : "—"}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Fullscreen processing modal                                           */
/* --------------------------------------------------------------------- */

type TxModalState =
  | { open: false }
  | {
      open: true;
      stage: "processing" | "success" | "error";
      title?: string;
      message?: string;
      signature?: string | null;
    };

const TxModal: React.FC<{ state: TxModalState; onClose: () => void }> = ({
  state,
  onClose,
}) => {
  if (!state.open) return null;

  const isProcessing = state.stage === "processing";
  const isSuccess = state.stage === "success";
  const isError = state.stage === "error";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-[92%] max-w-md rounded-3xl border border-white/10 bg-black/90 px-5 py-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-slate-100"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-3 mt-1 rounded-full border border-white/10 bg-black/50 p-4">
            {isProcessing && (
              <Loader2 className="h-7 w-7 animate-spin text-emerald-300" />
            )}
            {isSuccess && <CheckCircle2 className="h-7 w-7 text-emerald-300" />}
            {isError && <XCircle className="h-7 w-7 text-red-300" />}
          </div>

          <div className="text-base font-semibold text-slate-50">
            {state.title ||
              (isProcessing
                ? "Processing"
                : isSuccess
                ? "Order placed"
                : "Order failed")}
          </div>

          <div className="mt-1 text-xs text-slate-400">
            {state.message ||
              (isProcessing
                ? "Please keep this screen open while we place your order."
                : isSuccess
                ? "Your order was submitted successfully."
                : "Something went wrong placing your order.")}
          </div>

          {state.signature && !isProcessing && (
            <div className="mt-3 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-left text-[11px] text-slate-300">
              <div className="text-slate-500">Reference</div>
              <div className="mt-1 break-all font-mono">{state.signature}</div>
            </div>
          )}

          {!isProcessing && (
            <div className="mt-4 flex w-full gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
              >
                Close
              </button>

              <Link
                href="/invest"
                className="flex-1 rounded-2xl bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                View assets
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* --------------------------------------------------------------------- */
/* Page                                                                  */
/* --------------------------------------------------------------------- */

const CoinPage: React.FC = () => {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useUser();

  const {
    displayCurrency,
    fxRate, // USD -> displayCurrency
    tokens,
    usdcAmount, // internal
    usdcUsd, // display-currency value of internal cash
    refresh: refreshBalances,
  } = useBalance();

  const {
    swap: usdcSwap,
    loading: swapLoading,
    signature: swapSig,
    error: swapErr,
    reset: resetSwap,
  } = useServerSponsoredUsdcSwap();

  const slug = (params?.id || "").toString();
  const resolved = useMemo(() => resolveTokenFromSlug(slug), [slug]);
  const tokenFound = !!resolved;
  const meta = resolved?.meta;
  const mint = resolved?.mint ?? "";

  const [timeframe, setTimeframe] = useState<TimeframeKey>("7D");
  const [history, setHistory] = useState<HistoricalPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [spotPriceUsd, setSpotPriceUsd] = useState<number | null>(null);
  const [priceChange24hPct, setPriceChange24hPct] = useState<number | null>(
    null
  );
  const [priceLoading, setPriceLoading] = useState(false);

  const [side, setSide] = useState<"buy" | "sell">("buy");

  // User can enter either Cash or Asset amount (bank-style)
  const [inputUnit, setInputUnit] = useState<"cash" | "asset">("cash");
  const [cashAmount, setCashAmount] = useState<string>(""); // in display currency
  const [assetAmount, setAssetAmount] = useState<string>(""); // token units
  const [lastEdited, setLastEdited] = useState<"cash" | "asset">("cash");

  const [isMaxSell, setIsMaxSell] = useState(false);
  const [priceRefreshTick, setPriceRefreshTick] = useState(0);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [txModal, setTxModal] = useState<TxModalState>({ open: false });

  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const name = meta?.name || meta?.symbol || "Unknown asset";
  const symbol = meta?.symbol || "";
  const category = (meta?.categories || "Uncategorized") as
    | TokenCategory
    | string;
  const logo = meta?.logo || null;

  const ownerBase58 = user?.walletAddress ?? "";

  const coingeckoId = (meta?.id || "").trim();

  /* ------------------------------------------------------------------- */
  /* Balances                                                            */
  /* ------------------------------------------------------------------- */

  const tokenPosition = useMemo(() => {
    const t = tokens.find((x) => x.mint === mint);
    return {
      amount: t?.amount ?? 0,
      valueDisplay: typeof t?.usdValue === "number" ? t.usdValue : 0,
    };
  }, [tokens, mint]);

  const tokenBalance = clampNumber(tokenPosition.amount);
  const tokenValueDisplay = clampNumber(tokenPosition.valueDisplay);

  // Internally this is your "cash" rail; UI calls it Cash.
  const cashBalanceInternal = clampNumber(Number(usdcAmount ?? 0)); // ~USD
  const cashBalanceDisplay = clampNumber(
    typeof usdcUsd === "number" ? usdcUsd : 0
  );

  const tokenDecimals =
    typeof meta?.decimals === "number" && Number.isFinite(meta.decimals)
      ? meta.decimals
      : 0;

  /* ------------------------------------------------------------------- */
  /* Fetch spot price (CoinGecko API)                                    */
  /* ------------------------------------------------------------------- */

  useEffect(() => {
    const controller = new AbortController();

    const loadSpotPrice = async () => {
      try {
        setPriceLoading(true);

        // If we don't have a CG id, we can't use the CG spot endpoint.
        if (!coingeckoId) {
          setSpotPriceUsd(null);
          setPriceChange24hPct(null);
          return;
        }

        const res = await fetch("/api/prices/coingecko", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [coingeckoId] }),
          cache: "no-store",
        });

        if (!res.ok) return;

        const data = (await res.json()) as SpotResp;
        const entry = data?.prices?.[coingeckoId];
        if (!entry) return;

        setSpotPriceUsd(
          typeof entry.priceUsd === "number" ? entry.priceUsd : null
        );
        setPriceChange24hPct(
          typeof entry.priceChange24hPct === "number"
            ? entry.priceChange24hPct
            : null
        );
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name === "AbortError") return;
      } finally {
        setPriceLoading(false);
      }
    };

    loadSpotPrice();
    return () => controller.abort();
  }, [coingeckoId, priceRefreshTick]);

  /* ------------------------------------------------------------------- */
  /* Fetch history (CoinGecko API)                                       */
  /* ------------------------------------------------------------------- */

  useEffect(() => {
    if (!coingeckoId) {
      setHistory([]);
      setHistoryError("No CoinGecko id for this asset.");
      return;
    }

    const controller = new AbortController();
    const cfg = TIMEFRAMES[timeframe];

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);

        const url = `/api/prices/coingecko/historical?id=${encodeURIComponent(
          coingeckoId
        )}&days=${encodeURIComponent(cfg.days)}`;

        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          setHistory([]);
          setHistoryError("Couldn’t load chart data.");
          return;
        }

        const data = (await res.json()) as HistoricalApiResponse;
        setHistory(Array.isArray(data?.prices) ? data.prices : []);
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name === "AbortError") return;
        setHistory([]);
        setHistoryError("Couldn’t load chart data.");
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
    return () => controller.abort();
  }, [coingeckoId, timeframe, priceRefreshTick]);

  /* ------------------------------------------------------------------- */
  /* Derived values                                                      */
  /* ------------------------------------------------------------------- */

  const spotPriceDisplay =
    spotPriceUsd && fxRate ? spotPriceUsd * fxRate : null;

  const chartData = useMemo((): SleekPoint[] => {
    if (!history?.length) return [];
    if (!fxRate || fxRate <= 0) return [];
    return history.map((p) => ({ t: p.t, y: p.price * fxRate }));
  }, [history, fxRate]);

  const cashNum = safeParse(cashAmount); // display currency
  const assetNum = safeParse(assetAmount); // token units

  // Convert Cash(display) <-> USD
  const cashUsd = fxRate && fxRate > 0 && cashNum > 0 ? cashNum / fxRate : 0;

  // Convert Asset <-> USD
  const assetUsd = spotPriceUsd && assetNum > 0 ? assetNum * spotPriceUsd : 0;

  // Determine gross notional based on user intent
  const grossUsd = lastEdited === "cash" ? cashUsd : assetUsd;
  const grossUsdSafe = grossUsd > 0 && Number.isFinite(grossUsd) ? grossUsd : 0;

  const feeUsd =
    grossUsdSafe > 0 && SWAP_FEE_PCT > 0 ? grossUsdSafe * SWAP_FEE_PCT : 0;

  const netUsdAfterFee = Math.max(grossUsdSafe - feeUsd, 0);

  const feeDisplay = fxRate && feeUsd ? feeUsd * fxRate : 0;
  const netDisplay = fxRate && netUsdAfterFee ? netUsdAfterFee * fxRate : 0;

  // What the user receives (after fee)
  const receiveAsset =
    spotPriceUsd && netUsdAfterFee ? netUsdAfterFee / spotPriceUsd : 0;

  const receiveCashDisplay = netDisplay; // after fee

  // If user types the opposite unit, we compute the other field for preview (without overwriting input)
  const impliedAssetFromCash =
    spotPriceUsd && cashUsd > 0 ? cashUsd / spotPriceUsd : 0;

  const impliedCashFromAssetDisplay =
    fxRate && fxRate > 0 && assetUsd > 0 ? assetUsd * fxRate : 0;

  /* ------------------------------------------------------------------- */
  /* Sync the non-edited field (avoid ping-pong)                          */
  /* ------------------------------------------------------------------- */

  useEffect(() => {
    if (!fxRate || fxRate <= 0) return;
    if (!spotPriceUsd || spotPriceUsd <= 0) return;

    if (lastEdited === "cash") {
      const n = safeParse(cashAmount);
      if (!n || n <= 0) {
        if (assetAmount !== "") setAssetAmount("");
        return;
      }
      const usd = n / fxRate;
      const computed = usd / spotPriceUsd;
      if (Number.isFinite(computed) && computed > 0) {
        const next = String(computed);
        if (next !== assetAmount) setAssetAmount(next);
      }
    } else {
      const n = safeParse(assetAmount);
      if (!n || n <= 0) {
        if (cashAmount !== "") setCashAmount("");
        return;
      }
      const usd = n * spotPriceUsd;
      const computed = usd * fxRate;
      if (Number.isFinite(computed) && computed > 0) {
        const next = String(computed);
        if (next !== cashAmount) setCashAmount(next);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxRate, spotPriceUsd, lastEdited]);

  /* ------------------------------------------------------------------- */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------- */

  const resetInputs = () => {
    setCashAmount("");
    setAssetAmount("");
    setIsMaxSell(false);
    setLocalErr(null);
    setShowBreakdown(false);
    setLastEdited(side === "buy" ? "cash" : "asset");
    setInputUnit(side === "buy" ? "cash" : "asset");
  };

  const handleSideChange = (next: "buy" | "sell") => {
    setSide(next);
    resetSwap();
    setLocalErr(null);
    setIsMaxSell(false);

    setInputUnit(next === "buy" ? "cash" : "asset");
    setLastEdited(next === "buy" ? "cash" : "asset");
    setCashAmount("");
    setAssetAmount("");
    setShowBreakdown(false);
  };

  const handleUnitChange = (next: "cash" | "asset") => {
    setLocalErr(null);
    setIsMaxSell(false);
    setInputUnit(next);
    setLastEdited(next);
  };

  const setQuickCash = (pct: number) => {
    if (side !== "buy") return;
    if (!cashBalanceDisplay || cashBalanceDisplay <= 0) return;
    const v = cashBalanceDisplay * pct;
    setInputUnit("cash");
    setLastEdited("cash");
    setCashAmount(String(v));
  };

  const setSellMax = () => {
    if (!tokenBalance || tokenBalance <= 0) return;
    setIsMaxSell(true);
    setInputUnit("asset");
    setLastEdited("asset");
    setAssetAmount(String(tokenBalance));
  };

  const executeTrade = async () => {
    resetSwap();
    setLocalErr(null);

    setTxModal({
      open: true,
      stage: "processing",
      title: "Processing",
      message: "Placing your order…",
      signature: null,
    });

    try {
      if (!ownerBase58) throw new Error("Missing wallet address.");
      if (!fxRate || fxRate <= 0) throw new Error("FX not ready yet.");
      if (!spotPriceUsd || spotPriceUsd <= 0)
        throw new Error("Price not ready.");
      if (grossUsdSafe <= 0) throw new Error("Enter an amount.");

      if (side === "buy") {
        if (grossUsdSafe > cashBalanceInternal + 0.000001) {
          throw new Error("Not enough Cash available.");
        }

        const amountDisplay =
          lastEdited === "cash" ? cashNum : impliedCashFromAssetDisplay;

        const sig = await usdcSwap({
          kind: "buy",
          fromOwnerBase58: ownerBase58,
          outputMint: mint,
          amountDisplay,
          fxRate,
          slippageBps: 50,
        });

        await refreshBalances();
        resetInputs();

        setTxModal({
          open: true,
          stage: "success",
          title: "Order placed",
          message: "Your buy order was submitted.",
          signature: sig ?? null,
        });

        return;
      }

      // sell
      const sellAmountUi =
        lastEdited === "asset"
          ? assetNum
          : spotPriceUsd && fxRate && fxRate > 0
          ? cashNum / fxRate / spotPriceUsd
          : 0;

      if (sellAmountUi <= 0) throw new Error("Enter an amount.");
      if (!isMaxSell && sellAmountUi > tokenBalance + 1e-12) {
        throw new Error("Not enough balance to sell that amount.");
      }

      const sig = await usdcSwap({
        kind: "sell",
        fromOwnerBase58: ownerBase58,
        inputMint: mint,
        amountUi: sellAmountUi,
        inputDecimals: tokenDecimals,
        slippageBps: 50,
        isMax: isMaxSell,
        sweepNativeSolAfter: isMaxSell,
      });

      await refreshBalances();
      resetInputs();

      setTxModal({
        open: true,
        stage: "success",
        title: "Order placed",
        message: "Your sell order was submitted.",
        signature: sig ?? null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalErr(msg);

      setTxModal({
        open: true,
        stage: "error",
        title: "Order failed",
        message: msg,
        signature: null,
      });

      throw e;
    }
  };

  const inputsDisabled = swapLoading;

  const perfPct = useMemo(() => {
    const firstPrice = history[0]?.price ?? spotPriceUsd ?? null;
    const lastPrice =
      history[history.length - 1]?.price ?? spotPriceUsd ?? firstPrice ?? null;

    if (!firstPrice || !lastPrice) return 0;
    return ((lastPrice - firstPrice) / firstPrice) * 100;
  }, [history, spotPriceUsd]);

  const primaryDisabled =
    swapLoading ||
    !ownerBase58 ||
    !spotPriceUsd ||
    !fxRate ||
    grossUsdSafe <= 0 ||
    (side === "buy" ? cashBalanceInternal <= 0 : tokenBalance <= 0);

  const errorToShow = localErr || swapErr;

  const cashLine = `Cash: ${formatCurrency(
    cashBalanceDisplay,
    displayCurrency
  )}`;
  const assetLine = `You own: ${formatQty(tokenBalance, 6)} ${
    symbol || "ASSET"
  } · ${formatCurrency(tokenValueDisplay, displayCurrency)}`;

  if (!tokenFound) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-xl px-4 pb-10 pt-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-emerald-300"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>

          <div className="mt-6 rounded-3xl border border-red-500/30 bg-red-500/5 px-4 py-6">
            <h1 className="text-lg font-semibold text-red-200">
              Asset not found
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              This asset isn’t available for the current network ({CLUSTER}). Go
              back and select an asset from Exchange.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const pct = typeof priceChange24hPct === "number" ? priceChange24hPct : null;
  const isUp = (pct ?? 0) >= 0;

  return (
    <div className="min-h-screen text-foreground">
      <TxModal state={txModal} onClose={() => setTxModal({ open: false })} />

      <div className="mx-auto w-full max-w-2xl px-3 pb-10 pt-4 sm:px-4">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-emerald-300"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>

          <button
            type="button"
            disabled={swapLoading}
            onClick={() => {
              setPriceRefreshTick((n) => n + 1);
              void refreshBalances();
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:text-emerald-300 disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>

        {/* Amplify-style price + chart header */}
        <div className="mt-3 glass-panel bg-white/10 px-4 pb-4 pt-5 sm:px-5 sm:pb-5 sm:pt-6">
          {/* centered token */}
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-2">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt={name}
                  className="h-6 w-6 rounded-full border border-white/10"
                />
              ) : (
                <div className="h-6 w-6 rounded-full border border-white/10 bg-white/5" />
              )}

              <div className="text-[12px] font-semibold tracking-[0.28em] text-white/55">
                {symbol || name}
              </div>
            </div>

            <div className="mt-2 flex items-baseline justify-center gap-2">
              <span className="text-[44px] font-semibold leading-none tracking-tight text-white/92 sm:text-5xl">
                {priceLoading && spotPriceDisplay === null
                  ? "…"
                  : formatCurrency(spotPriceDisplay, displayCurrency)}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-center gap-2">
              <span
                className={[
                  "inline-flex items-center gap-1 text-sm font-semibold",
                  pct === null
                    ? "text-white/40"
                    : isUp
                    ? "text-emerald-300"
                    : "text-rose-300",
                ].join(" ")}
              >
                {pct === null ? null : isUp ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
                {pct === null ? "—" : `${pct.toFixed(2)}%`}
              </span>

              <span className="text-xs text-white/35">(24h)</span>

              <span className="mx-1 h-3 w-px bg-white/10" />

              <span className="text-xs text-white/35">
                {TIMEFRAMES[timeframe].label} perf{" "}
                <span
                  className={
                    perfPct > 0
                      ? "text-emerald-300"
                      : perfPct < 0
                      ? "text-rose-300"
                      : "text-white/50"
                  }
                >
                  {formatPct(perfPct)}
                </span>
              </span>
            </div>

            {!!category && (
              <div className="mt-2 text-[11px] text-white/35">
                <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5">
                  {category}
                </span>
              </div>
            )}
          </div>

          {/* chart container (mobile full-bleed) */}
          <div className="relative mt-4 overflow-hidden rounded-3xl border border-white/10 bg-black/45 shadow-[0_18px_55px_rgba(0,0,0,0.55)] -mx-4 sm:mx-0">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent" />

            {/* timeframe tabs overlay */}
            <div className="absolute right-3 top-3 z-10">
              <div className="flex gap-1 rounded-full border border-white/10 bg-black/40 p-0.5 text-[11px]">
                {(Object.keys(TIMEFRAMES) as TimeframeKey[]).map((tf) => {
                  const active = tf === timeframe;
                  return (
                    <button
                      key={tf}
                      type="button"
                      disabled={swapLoading}
                      onClick={() => setTimeframe(tf)}
                      className={`rounded-full px-2.5 py-0.5 transition disabled:opacity-50 ${
                        active
                          ? "bg-emerald-500 text-black shadow-[0_0_0_1px_rgba(63,243,135,0.85)]"
                          : "text-slate-200 hover:bg-white/5"
                      }`}
                    >
                      {TIMEFRAMES[tf].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-3 pb-3 pt-12 sm:px-4 sm:pb-4">
              {historyLoading && !chartData.length ? (
                <div className="flex h-[210px] items-center justify-center text-xs text-white/40">
                  Loading chart…
                </div>
              ) : historyError ? (
                <div className="flex h-[210px] items-center justify-center text-xs text-white/40">
                  {historyError}
                </div>
              ) : !chartData.length ? (
                <div className="flex h-[210px] items-center justify-center text-xs text-white/40">
                  No chart data.
                </div>
              ) : (
                <SleekLineChart
                  data={chartData}
                  displayCurrency={displayCurrency}
                  timeframe={timeframe}
                />
              )}
            </div>
          </div>
        </div>

        {/* Trade card (unchanged) */}
        <div className="mt-4 glass-panel-soft p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="glass-pill">
              Trade <span className="text-primary">· {symbol || name}</span>
            </div>

            <div className="inline-flex rounded-full border border-white/10 bg-black/60 p-0.5 text-[11px]">
              <button
                type="button"
                disabled={swapLoading}
                onClick={() => handleSideChange("buy")}
                className={`rounded-full px-3 py-1 font-medium transition disabled:opacity-50 ${
                  side === "buy"
                    ? "bg-primary text-primary-foreground shadow-[0_0_0_1px_rgba(63,243,135,0.85)]"
                    : "text-slate-200 hover:bg-white/5"
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                disabled={swapLoading}
                onClick={() => handleSideChange("sell")}
                className={`rounded-full px-3 py-1 font-medium transition disabled:opacity-50 ${
                  side === "sell"
                    ? "bg-white/10 text-red-200 shadow-[0_0_0_1px_rgba(248,113,113,0.65)]"
                    : "text-slate-200 hover:bg-white/5"
                }`}
              >
                Sell
              </button>
            </div>
          </div>

          {/* Context */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-[12px] text-slate-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">
                {side === "buy" ? "Cash account" : "Asset balance"}
              </span>
              <span className="font-medium">
                {side === "buy" ? cashLine : assetLine}
              </span>
            </div>
          </div>

          {/* Amount input + unit toggle */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>
                {side === "buy"
                  ? "Choose how you want to buy"
                  : "Choose how you want to sell"}
              </span>

              <button
                type="button"
                disabled={inputsDisabled}
                onClick={() => setShowBreakdown((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-emerald-300 disabled:opacity-50"
              >
                Fees
                {showBreakdown ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 overflow-hidden rounded-2xl border border-white/12 bg-black/50 px-3 py-2 sm:px-3.5 sm:py-2.5">
              <input
                value={inputUnit === "cash" ? cashAmount : assetAmount}
                disabled={inputsDisabled}
                onChange={(e) => {
                  setLocalErr(null);
                  setIsMaxSell(false);
                  const v = e.target.value;
                  if (inputUnit === "cash") {
                    setLastEdited("cash");
                    setCashAmount(v);
                  } else {
                    setLastEdited("asset");
                    setAssetAmount(v);
                  }
                }}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="min-w-0 flex-1 bg-transparent text-right text-xl font-semibold text-slate-50 outline-none placeholder:text-slate-500 disabled:opacity-60"
              />

              {side === "sell" && inputUnit === "asset" && tokenBalance > 0 && (
                <button
                  type="button"
                  disabled={inputsDisabled}
                  onClick={setSellMax}
                  className="shrink-0 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:text-emerald-300 disabled:opacity-50"
                >
                  Max
                </button>
              )}

              <div className="inline-flex rounded-full border border-white/10 bg-black/70 p-0.5 text-[11px]">
                <button
                  type="button"
                  disabled={inputsDisabled}
                  onClick={() => handleUnitChange("cash")}
                  className={`rounded-full px-2.5 py-1 font-semibold transition disabled:opacity-50 ${
                    inputUnit === "cash"
                      ? "bg-white/10 text-slate-100"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  Cash
                </button>
                <button
                  type="button"
                  disabled={inputsDisabled}
                  onClick={() => handleUnitChange("asset")}
                  className={`rounded-full px-2.5 py-1 font-semibold transition disabled:opacity-50 ${
                    inputUnit === "asset"
                      ? "bg-white/10 text-slate-100"
                      : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {symbol || "Asset"}
                </button>
              </div>
            </div>

            {/* Quick actions for Cash buys */}
            {side === "buy" && inputUnit === "cash" && (
              <div className="mt-2 flex gap-2">
                {[0.25, 0.5, 0.75, 1].map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={inputsDisabled || cashBalanceDisplay <= 0}
                    onClick={() => setQuickCash(p)}
                    className="flex-1 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
                  >
                    {p === 1 ? "Max" : `${Math.round(p * 100)}%`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bank-style preview */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-[12px] text-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">
                {side === "buy" ? "You pay" : "You sell"}
              </span>
              <span className="font-semibold text-slate-50">
                {side === "buy"
                  ? formatCurrency(
                      lastEdited === "cash"
                        ? cashNum
                        : impliedCashFromAssetDisplay,
                      displayCurrency
                    )
                  : `${formatQty(
                      lastEdited === "asset" ? assetNum : impliedAssetFromCash,
                      6
                    )} ${symbol || "ASSET"}`}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-slate-400">You receive (approx.)</span>
              <span className="font-semibold text-slate-50">
                {side === "buy"
                  ? `${formatQty(receiveAsset, 6)} ${symbol || "ASSET"}`
                  : formatCurrency(receiveCashDisplay, displayCurrency)}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>Rate</span>
              <span>
                1 {symbol || "ASSET"} ≈{" "}
                {formatCurrency(spotPriceDisplay, displayCurrency)}
              </span>
            </div>
          </div>

          {/* Fee breakdown */}
          {showBreakdown && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-[12px] text-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Haven fee</span>
                <span className="font-medium">
                  {formatCurrency(feeDisplay, displayCurrency)}{" "}
                  <span className="text-slate-500">
                    ({SWAP_FEE_PCT_DISPLAY.toFixed(2)}%)
                  </span>
                </span>
              </div>

              <div className="mt-1 flex items-center justify-between">
                <span className="text-slate-400">Net amount</span>
                <span className="font-semibold text-slate-50">
                  {formatCurrency(netDisplay, displayCurrency)}
                </span>
              </div>

              <div className="mt-2 text-[11px] text-slate-500">
                Fees are taken from the order amount.
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="mt-4 space-y-2">
            <button
              type="button"
              className="haven-primary-btn w-full"
              disabled={primaryDisabled}
              onClick={() => {
                void executeTrade().catch((e) =>
                  console.error("[Trade] failed", e)
                );
              }}
            >
              {swapLoading
                ? "Placing…"
                : side === "buy"
                ? `Buy ${symbol || "asset"}`
                : `Sell ${symbol || "asset"}`}
            </button>

            {errorToShow && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                {errorToShow}
              </div>
            )}

            {swapSig && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
                Order submitted: <span className="font-mono">{swapSig}</span>
              </div>
            )}
          </div>

          {/* Details toggle */}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-4 inline-flex items-center gap-2 text-[11px] text-slate-400 hover:text-emerald-300"
          >
            <Info className="h-3 w-3" />
            {showDetails ? "Hide details" : "Show details"}
            {showDetails ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>

          {showDetails && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-black/35 px-3 py-3 text-[12px] text-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Mint</span>
                <span className="max-w-[220px] truncate font-mono text-[11px] text-slate-100">
                  {mint}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-400">Fee</span>
                <span className="font-medium">
                  {SWAP_FEE_PCT_DISPLAY.toFixed(2)}%
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-400">Cluster</span>
                <span className="font-medium">{CLUSTER}</span>
              </div>

              {coingeckoId ? (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-slate-400">CoinGecko</span>
                  <span className="font-medium">{coingeckoId}</span>
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-amber-200/80">
                  This token has no CoinGecko id, so chart/price may be
                  unavailable.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CoinPage;
