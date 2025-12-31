"use client";

import React, { useEffect, useMemo, useState } from "react";
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

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

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

type HistoricalPoint = {
  t: number;
  price: number; // USD
};

type HistoricalApiResponse = {
  id: string;
  prices: HistoricalPoint[];
};

type PriceEntry = {
  price: number; // USD
  priceChange24hPct?: number;
};

type PricesResponse = {
  prices: Record<string, PriceEntry>;
};

type TimeframeKey = "1D" | "7D" | "30D" | "90D";

const TIMEFRAMES: Record<
  TimeframeKey,
  { label: string; days: string; interval: string }
> = {
  "1D": { label: "24H", days: "1", interval: "hourly" },
  "7D": { label: "7D", days: "7", interval: "hourly" },
  "30D": { label: "30D", days: "30", interval: "daily" },
  "90D": { label: "90D", days: "90", interval: "daily" },
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
/* Chart tooltip                                                         */
/* --------------------------------------------------------------------- */

type ChartPoint = { label: string; price: number };

type CustomTooltipProps = {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  currency: string;
};

const CustomTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  currency,
}) => {
  if (!active || !payload || !payload.length) return null;
  const value = payload[0]?.value;
  return (
    <div className="rounded-2xl border border-white/10 bg-black/90 px-3 py-2 text-xs text-slate-100 shadow-xl">
      <div className="font-medium text-emerald-300">
        {formatCurrency(value, currency)}
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400">{label}</div>
    </div>
  );
};

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

const TxModal: React.FC<{
  state: TxModalState;
  onClose: () => void;
}> = ({ state, onClose }) => {
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
  /* Fetch spot price                                                    */
  /* ------------------------------------------------------------------- */

  useEffect(() => {
    const controller = new AbortController();

    const loadSpotPrice = async () => {
      try {
        setPriceLoading(true);

        const res = await fetch("/api/prices/jup", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mints: [mint] }),
        });

        if (!res.ok) return;

        const data = (await res.json()) as PricesResponse;
        const entry = data.prices?.[mint];
        if (!entry) return;

        setSpotPriceUsd(entry.price ?? null);
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

    if (mint) loadSpotPrice();
    return () => controller.abort();
  }, [mint, priceRefreshTick]);

  /* ------------------------------------------------------------------- */
  /* Fetch history                                                       */
  /* ------------------------------------------------------------------- */

  const metaId = meta?.id;

  useEffect(() => {
    if (!metaId) {
      setHistory([]);
      setHistoryError("No chart data available for this asset.");
      return;
    }

    const controller = new AbortController();
    const cfg = TIMEFRAMES[timeframe];

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);

        const params = new URLSearchParams({
          id: metaId,
          days: cfg.days,
          interval: cfg.interval,
        });

        const url = `/api/prices/historical?${params.toString()}`;
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
        setHistory(data.prices || []);
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
  }, [metaId, timeframe]);

  /* ------------------------------------------------------------------- */
  /* Derived values                                                      */
  /* ------------------------------------------------------------------- */

  const spotPriceDisplay =
    spotPriceUsd && fxRate ? spotPriceUsd * fxRate : null;

  const chartData: ChartPoint[] = useMemo(() => {
    if (!history?.length) return [];

    const formatter =
      timeframe === "1D"
        ? (ts: number) =>
            new Date(ts).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })
        : (ts: number) =>
            new Date(ts).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });

    return history.map((p) => ({
      label: formatter(p.t),
      price: p.price * (fxRate || 1),
    }));
  }, [history, timeframe, fxRate]);

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

  // If user types the opposite unit, we compute the other field for preview (without overwriting the user’s input)
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
      // user is setting cash, update asset preview field
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
      // user is setting asset, update cash preview field
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

    // Keep values, but user’s newly selected unit becomes the authoritative input.
    // (We don’t clear because that feels “bank app” friendly.)
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
        // Buying uses the cash rail; check against internal cash balance (~USD)
        if (grossUsdSafe > cashBalanceInternal + 0.000001) {
          throw new Error("Not enough Cash available.");
        }

        // Backend expects amountDisplay (display currency) for buy.
        // If user entered asset, we convert to the implied cash display.
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
      // If user entered cash, convert to asset units for the backend call
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

        {/* Header card */}
        <div className="glass-panel mt-3 bg-white/10 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black/60">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt={name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs font-semibold text-slate-100">
                  {(symbol || "???").slice(0, 3).toUpperCase()}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight text-slate-50">
                  {name}
                </h1>
                {symbol && (
                  <span className="rounded-full border border-white/10 bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-300">
                    {symbol}
                  </span>
                )}
              </div>

              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                <span className="rounded-full bg-black/60 px-2 py-0.5">
                  {category}
                </span>

                {priceChange24hPct !== null && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                      priceChange24hPct > 0
                        ? "bg-emerald-500/15 text-emerald-300"
                        : priceChange24hPct < 0
                        ? "bg-red-500/10 text-red-300"
                        : "bg-black/40 text-slate-400"
                    }`}
                  >
                    {priceChange24hPct > 0 ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : priceChange24hPct < 0 ? (
                      <ArrowDownRight className="h-3 w-3" />
                    ) : null}
                    {formatPct(priceChange24hPct)}{" "}
                    <span className="text-slate-400/80">24h</span>
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <div className="text-[11px] text-slate-500">Price</div>
              <div className="text-xl font-semibold text-slate-50">
                {priceLoading && !spotPriceDisplay
                  ? "…"
                  : formatCurrency(spotPriceDisplay, displayCurrency)}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="mt-4 rounded-3xl border border-white/8 bg-black/40 px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] text-slate-400">
                {`${TIMEFRAMES[timeframe].label} performance`}
                <span className="ml-2 font-semibold">
                  <span
                    className={
                      perfPct > 0
                        ? "text-emerald-300"
                        : perfPct < 0
                        ? "text-red-300"
                        : "text-slate-300"
                    }
                  >
                    {formatPct(perfPct)}
                  </span>
                </span>
              </div>

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
                          : "text-slate-300 hover:bg-white/5"
                      }`}
                    >
                      {TIMEFRAMES[tf].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-[160px]">
              {historyLoading && !chartData.length ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  Loading chart…
                </div>
              ) : historyError ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  {historyError}
                </div>
              ) : !chartData.length ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  No chart data available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "rgba(148,163,184,0.9)" }}
                      tickMargin={6}
                      stroke="rgba(51,65,85,0.7)"
                    />
                    <YAxis domain={["auto", "auto"]} hide />
                    <Tooltip
                      content={(props) => (
                        <CustomTooltip
                          {...(props as unknown as {
                            active?: boolean;
                            payload?: { value: number }[];
                            label?: string;
                          })}
                          currency={displayCurrency}
                        />
                      )}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      dot={false}
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Trade card (bank-style) */}
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

          {/* Bank-style preview: always show exact spend/receive */}
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
              <span className="text-slate-400">
                {side === "buy"
                  ? "You receive (approx.)"
                  : "You receive (approx.)"}
              </span>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CoinPage;
