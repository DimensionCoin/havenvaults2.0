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

// Fee % is shown in UI, but the server is the source of truth
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
  t: number; // ms since epoch
  price: number; // USD from backend
};

type HistoricalApiResponse = {
  id: string; // CoinGecko id
  prices: HistoricalPoint[];
};

type PriceEntry = {
  price: number; // USD from backend
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
  if (v === null || v === undefined || Number.isNaN(v)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(0);
  }

  return v.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: v < 1 ? 6 : 2,
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
                ? "Trade submitted"
                : "Trade failed")}
          </div>

          <div className="mt-1 text-xs text-slate-400">
            {state.message ||
              (isProcessing
                ? "Please keep this screen open while we submit your transaction."
                : isSuccess
                ? "Your transaction was sent successfully."
                : "Something went wrong sending your transaction.")}
          </div>

          {state.signature && !isProcessing && (
            <div className="mt-3 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-left text-[11px] text-slate-300">
              <div className="text-slate-500">Signature</div>
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
    usdcAmount,
    usdcUsd, // ✅ display-currency value of USDC (already converted in BalanceProvider)
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

  // Trade inputs
  const [tokenAmount, setTokenAmount] = useState<string>("");
  const [fiatAmount, setFiatAmount] = useState<string>("");

  // ✅ Single-input mode: user chooses whether input is in fiat or token
  const [inputUnit, setInputUnit] = useState<"fiat" | "token">("fiat");

  // Track which input the user last edited (prevents “ping-pong”)
  const [lastEdited, setLastEdited] = useState<"token" | "fiat">("fiat");

  // Max sell support
  const [isMaxSell, setIsMaxSell] = useState(false);

  // Manual refresh for price panel
  const [priceRefreshTick, setPriceRefreshTick] = useState(0);

  // Local UI errors (in addition to hook errors)
  const [localErr, setLocalErr] = useState<string | null>(null);

  // ✅ Fullscreen modal state
  const [txModal, setTxModal] = useState<TxModalState>({ open: false });
  const name = meta?.name || meta?.symbol || "Unknown token";
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
      // BalanceProvider converts usdValue into display currency already
      valueDisplay: typeof t?.usdValue === "number" ? t.usdValue : 0,
    };
  }, [tokens, mint]);

  const tokenBalance = tokenPosition.amount;

  const usdcBalance = Number(usdcAmount ?? 0);
  const usdcValueDisplay = typeof usdcUsd === "number" ? usdcUsd : 0;

  const tokenDecimals =
    typeof meta?.decimals === "number" && Number.isFinite(meta.decimals)
      ? meta.decimals
      : 0;

  /* ------------------------------------------------------------------- */
  /* Data fetching                                                       */
  /* ------------------------------------------------------------------- */

  // Spot price + 24h change – always USD
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

        if (!res.ok) {
          console.error("Failed to load spot price:", res.status);
          return;
        }

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
        console.error("Error loading spot price:", err);
      } finally {
        setPriceLoading(false);
      }
    };

    loadSpotPrice();
    return () => controller.abort();
  }, [mint, priceRefreshTick]);

  // Historical chart data – USD
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

        const coingeckoId = metaId;

        const params = new URLSearchParams({
          id: coingeckoId,
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
          console.error("Failed to load historical prices:", res.status);
          setHistory([]);
          setHistoryError("Couldn’t load chart data.");
          return;
        }

        const data = (await res.json()) as HistoricalApiResponse;
        setHistory(data.prices || []);
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name === "AbortError") return;
        console.error("Error loading historical data:", err);
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

  const firstPrice = history[0]?.price ?? spotPriceUsd ?? null;
  const lastPrice =
    history[history.length - 1]?.price ?? spotPriceUsd ?? firstPrice ?? null;

  const perfPct =
    firstPrice && lastPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  const perfIsUp = perfPct > 0;
  const perfIsDown = perfPct < 0;

  const changeColor = perfIsUp
    ? "text-emerald-400"
    : perfIsDown
    ? "text-red-400"
    : "text-slate-400";

  const changeBg =
    perfIsUp || perfIsDown
      ? "bg-black/40"
      : "bg-black/40 border border-white/10";

  const tokenAmountNum = parseFloat(tokenAmount || "0") || 0;
  const fiatAmountNum = parseFloat(fiatAmount || "0") || 0;

  // USD notional estimation
  const estUsdFromToken =
    spotPriceUsd && tokenAmountNum ? tokenAmountNum * spotPriceUsd : 0;

  // fiat is display currency; fxRate is USD->display => USD = display / fxRate
  const estUsdFromFiat =
    fxRate && fxRate > 0 && fiatAmountNum ? fiatAmountNum / fxRate : 0;

  const notionalUsd =
    lastEdited === "fiat"
      ? estUsdFromFiat
      : lastEdited === "token"
      ? estUsdFromToken
      : Math.max(estUsdFromFiat, estUsdFromToken);

  const notionalUsdSafe =
    Number.isFinite(notionalUsd) && notionalUsd > 0 ? notionalUsd : 0;

  // Fee model: fee calculated on gross USD notional
  const feeUsd =
    notionalUsdSafe > 0 && SWAP_FEE_PCT > 0
      ? notionalUsdSafe * SWAP_FEE_PCT
      : 0;

  const netUsdAfterFee = Math.max(notionalUsdSafe - feeUsd, 0);

  const notionalDisplay =
    fxRate && notionalUsdSafe ? notionalUsdSafe * fxRate : 0;
  const feeDisplay = fxRate && feeUsd ? feeUsd * fxRate : 0;
  const netDisplay = fxRate && netUsdAfterFee ? netUsdAfterFee * fxRate : 0;

  /* ------------------------------------------------------------------- */
  /* Input sync                                                          */
  /* ------------------------------------------------------------------- */

  useEffect(() => {
    if (!spotPriceDisplay || !Number.isFinite(spotPriceDisplay)) return;

    if (lastEdited === "fiat") {
      const n = parseFloat(fiatAmount || "0");
      if (!n || n <= 0) {
        if (tokenAmount !== "") setTokenAmount("");
        return;
      }
      const computed = n / spotPriceDisplay;
      if (Number.isFinite(computed) && computed > 0) {
        const next = String(computed);
        if (next !== tokenAmount) setTokenAmount(next);
      }
    } else if (lastEdited === "token") {
      const n = parseFloat(tokenAmount || "0");
      if (!n || n <= 0) {
        if (fiatAmount !== "") setFiatAmount("");
        return;
      }
      const computed = n * spotPriceDisplay;
      if (Number.isFinite(computed) && computed > 0) {
        const next = String(computed);
        if (next !== fiatAmount) setFiatAmount(next);
      }
    }
  }, [spotPriceDisplay, lastEdited, fiatAmount, tokenAmount]);

  /* ------------------------------------------------------------------- */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------- */

  const handleTokenAmountChange = (value: string) => {
    setLocalErr(null);
    setIsMaxSell(false);
    setLastEdited("token");
    setTokenAmount(value);
  };

  const handleFiatAmountChange = (value: string) => {
    setLocalErr(null);
    setIsMaxSell(false);
    setLastEdited("fiat");
    setFiatAmount(value);
  };

  const handleUnifiedAmountChange = (value: string) => {
    if (inputUnit === "fiat") handleFiatAmountChange(value);
    else handleTokenAmountChange(value);
  };

  const handleUnitChange = (next: "fiat" | "token") => {
    setLocalErr(null);
    setIsMaxSell(false);
    setInputUnit(next);
    setLastEdited(next === "fiat" ? "fiat" : "token");
  };

  const setSellMax = () => {
    if (!tokenBalance || tokenBalance <= 0) return;
    setLocalErr(null);
    setIsMaxSell(true);
    setInputUnit("token");
    setLastEdited("token");
    setTokenAmount(String(tokenBalance));
  };

  const resetInputs = () => {
    setTokenAmount("");
    setFiatAmount("");
    setIsMaxSell(false);
    setLocalErr(null);
  };

  const executeTrade = async () => {
    resetSwap();
    setLocalErr(null);

    // ✅ open modal immediately
    setTxModal({
      open: true,
      stage: "processing",
      title: "Processing",
      message: "Submitting your trade…",
      signature: null,
    });

    try {
      if (!ownerBase58) throw new Error("Missing wallet address.");
      if (!fxRate || fxRate <= 0) throw new Error("FX not ready yet.");
      if (!spotPriceUsd || spotPriceUsd <= 0)
        throw new Error("Price not ready.");
      if (notionalUsdSafe <= 0) throw new Error("Enter an amount.");

      if (side === "buy") {
        if (notionalUsdSafe > usdcBalance + 0.000001) {
          throw new Error("Not enough USDC to cover this buy.");
        }

        const grossDisplay =
          fiatAmountNum > 0 ? fiatAmountNum : notionalDisplay;

        const sig = await usdcSwap({
          kind: "buy",
          fromOwnerBase58: ownerBase58,
          outputMint: mint,
          amountDisplay: grossDisplay,
          fxRate, // USD -> displayCurrency
          slippageBps: 50,
        });

        await refreshBalances();
        resetInputs();

        setTxModal({
          open: true,
          stage: "success",
          title: "Trade submitted",
          message: "Your buy order was sent successfully.",
          signature: sig ?? null,
        });

        return;
      }

      // sell
      if (tokenAmountNum <= 0) throw new Error("Enter a sell amount.");
      if (!isMaxSell && tokenAmountNum > tokenBalance + 1e-12) {
        throw new Error("Not enough balance to sell that amount.");
      }

      const sig = await usdcSwap({
        kind: "sell",
        fromOwnerBase58: ownerBase58,
        inputMint: mint,
        amountUi: tokenAmountNum,
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
        title: "Trade submitted",
        message: "Your sell order was sent successfully.",
        signature: sig ?? null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalErr(msg);

      setTxModal({
        open: true,
        stage: "error",
        title: "Trade failed",
        message: msg,
        signature: null,
      });

      throw e;
    }
  };

  // Lock editing while swap is running
  const inputsDisabled = swapLoading;

  /* ------------------------------------------------------------------- */
  /* UI                                                                  */
  /* ------------------------------------------------------------------- */

  // ✅ Token balance is ALWAYS relevant on this page (buy & sell)
  const tokenBalanceLabel = `${formatQty(tokenBalance, 6)} ${
    symbol || "TOKEN"
  }`;

  // ✅ USDC “available” should be shown in display currency (professional)
  const usdcAvailableLabel = `${formatCurrency(
    usdcValueDisplay,
    displayCurrency
  )}`;

  const primaryDisabled =
    swapLoading ||
    !ownerBase58 ||
    !spotPriceUsd ||
    !fxRate ||
    notionalUsdSafe <= 0 ||
    (side === "buy" ? usdcBalance <= 0 : tokenBalance <= 0 && !tokenAmountNum);

  const errorToShow = localErr || swapErr;

  const unitLabel =
    inputUnit === "fiat" ? displayCurrency : symbol || name || "TOKEN";

  const unifiedValue = inputUnit === "fiat" ? fiatAmount : tokenAmount;

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
              Token not found
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              This token isn’t in Haven’s supported list for the current cluster
              ({CLUSTER}). Check the URL or pick a token from the Exchange page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foreground">
      {/* ✅ Fullscreen processing modal */}
      <TxModal state={txModal} onClose={() => setTxModal({ open: false })} />

      <div className="mx-auto w-full max-w-4xl px-3 pb-10 pt-4 sm:px-4">
        {/* Back button */}
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-emerald-300"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>

        <div className="glass-panel bg-white/10 mt-4 p-4 sm:p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div className="flex flex-1 min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black/60 text-xs font-semibold text-slate-100">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo}
                    alt={name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (symbol || "???").slice(0, 3).toUpperCase()
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                    {name}
                  </h1>
                  {symbol && (
                    <span className="flex-none rounded-full border border-white/10 bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-300">
                      {symbol}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="rounded-full bg-black/60 px-2 py-0.5">
                    Category:{" "}
                    <span className="font-medium text-emerald-300">
                      {category}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 text-right flex-none">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Price</span>
                <button
                  type="button"
                  disabled={swapLoading}
                  onClick={() => {
                    setPriceRefreshTick((n) => n + 1);
                    void refreshBalances();
                  }}
                  className="rounded-full border border-white/10 bg-black/40 p-1 text-slate-400 hover:text-emerald-300 disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-slate-50">
                  {priceLoading && !spotPriceDisplay
                    ? "…"
                    : formatCurrency(spotPriceDisplay, displayCurrency)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
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
                    {formatPct(priceChange24hPct)}
                    <span className="text-slate-400/80">24h</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="mt-4 rounded-3xl border border-white/8 bg-black/40 px-3 py-3 sm:px-4 sm:py-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                  Performance
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${changeColor} ${changeBg}`}
                  >
                    {perfIsUp ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : perfIsDown ? (
                      <ArrowDownRight className="h-3 w-3" />
                    ) : null}
                    {formatPct(perfPct)}
                  </span>
                  <span className="text-slate-500">
                    Last {TIMEFRAMES[timeframe].label.toLowerCase()}
                  </span>
                </div>
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

            <div className="mt-2 h-[190px] sm:h-[210px]">
              {historyLoading && !chartData.length ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  Loading chart…
                </div>
              ) : historyError ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-slate-500">
                  <span>{historyError}</span>
                  <button
                    type="button"
                    disabled={swapLoading}
                    onClick={() => setTimeframe((prev) => prev)}
                    className="mt-1 text-[11px] text-emerald-300 underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Try again
                  </button>
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

          {/* Trade */}
          <div className="mt-5 glass-panel-soft p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="glass-pill">
                Trade <span className="text-primary">· {symbol || name}</span>
              </div>

              <div className="inline-flex rounded-full border border-white/10 bg-black/60 p-0.5 text-[11px]">
                <button
                  type="button"
                  disabled={swapLoading}
                  onClick={() => {
                    setSide("buy");
                    resetInputs();
                    resetSwap();
                  }}
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
                  onClick={() => {
                    setSide("sell");
                    resetInputs();
                    resetSwap();
                  }}
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

            <div className="mt-4 space-y-3 text-sm">
              {/* ✅ Single input with dropdown (fiat vs asset) */}
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Amount in {unitLabel}{" "}
                    <span className="text-slate-500">(you {side})</span>
                  </span>

                  {inputUnit === "token" ? (
                    <span className="text-slate-500">
                      Balance:{" "}
                      <span className="text-slate-300">
                        {tokenBalanceLabel}
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      Available funds:{" "}
                      <span className="text-slate-300">
                        {usdcAvailableLabel}
                      </span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 overflow-hidden rounded-2xl border border-white/12 bg-black/50 px-3 py-2 sm:px-3.5 sm:py-2.5">
                  <input
                    value={unifiedValue}
                    disabled={inputsDisabled}
                    onChange={(e) => handleUnifiedAmountChange(e.target.value)}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    className="min-w-0 flex-1 bg-transparent text-right text-lg font-medium text-slate-50 outline-none placeholder:text-slate-500 disabled:opacity-60"
                  />

                  {side === "sell" &&
                    inputUnit === "token" &&
                    tokenBalance > 0 && (
                      <button
                        type="button"
                        disabled={inputsDisabled}
                        onClick={setSellMax}
                        className="shrink-0 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:text-emerald-300 disabled:opacity-50"
                      >
                        Max
                      </button>
                    )}

                  <select
                    value={inputUnit}
                    disabled={inputsDisabled}
                    onChange={(e) =>
                      handleUnitChange(e.target.value as "fiat" | "token")
                    }
                    className="shrink-0 w-[92px] rounded-full border border-white/10 bg-black/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300 outline-none disabled:opacity-60 sm:w-auto sm:px-2.5"
                    aria-label="Input unit"
                  >
                    <option value="fiat">{displayCurrency}</option>
                    <option value="token">{symbol || "TOKEN"}</option>
                  </select>
                </div>
              </div>

              {/* Fee / net summary */}
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {side === "buy"
                      ? "You’ll spend (total) • fee comes out of it"
                      : "You’ll receive (after fee)"}
                  </span>
                  <span className="text-slate-500">
                    1 {symbol || name} ≈{" "}
                    <span className="text-slate-300">
                      {formatCurrency(spotPriceDisplay, displayCurrency)}
                    </span>
                  </span>
                </div>

                <div className="flex flex-col gap-1 rounded-2xl border border-white/8 bg-black/40 px-3.5 py-2.5 text-sm text-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      {side === "buy"
                        ? "You’ll spend (approx.)"
                        : "You’ll receive (approx.)"}
                    </span>
                    <div className="text-right">
                      <div className="text-base font-semibold">
                        {formatCurrency(
                          side === "buy" ? notionalDisplay : netDisplay,
                          displayCurrency
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        in {displayCurrency}
                      </div>
                    </div>
                  </div>

                  {notionalDisplay > 0 && (
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Haven fee</span>
                      <div className="text-right">
                        <div>
                          {formatCurrency(feeDisplay, displayCurrency)}{" "}
                          <span className="text-slate-400">
                            ({SWAP_FEE_PCT_DISPLAY.toFixed(2)}%)
                          </span>
                        </div>

                        {side === "buy" ? (
                          <div className="text-[10px]">
                            Swapped into token:{" "}
                            {formatCurrency(netDisplay, displayCurrency)}
                          </div>
                        ) : (
                          <div className="text-[10px]">
                            Gross before fee:{" "}
                            {formatCurrency(notionalDisplay, displayCurrency)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  Route · Haven fee {SWAP_FEE_PCT_DISPLAY.toFixed(2)}%
                </span>
                <span className="text-slate-300">Powered by Jupiter</span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <button
                type="button"
                className="haven-primary-btn"
                disabled={primaryDisabled}
                onClick={() => {
                  void executeTrade().catch((e) => {
                    console.error("[Trade] failed", e);
                  });
                }}
              >
                {swapLoading ? "Executing…" : side === "buy" ? "Buy" : "Sell"}
              </button>

              {/* Keep your inline errors/sig (minimal change), modal is primary UX */}
              {errorToShow && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                  {errorToShow}
                </div>
              )}

              {swapSig && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
                  Trade sent: <span className="font-mono">{swapSig}</span>
                </div>
              )}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Trades execute from your Haven vault using Jupiter’s best route.
              Haven takes a {SWAP_FEE_PCT_DISPLAY.toFixed(2)}% fee on the USD
              notional (fee is removed from the swap notional).
            </p>
          </div>

          {/* Details + snapshot (unchanged) */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/8 bg-black/40 px-3 py-3 sm:px-4 sm:py-4">
              <div className="flex items-center gap-2">
                <span className="glass-pill">
                  <Info className="h-3 w-3" />
                  TOKEN DETAILS
                </span>
              </div>

              <dl className="mt-3 space-y-2 text-xs sm:text-[13px]">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <dt className="text-slate-400">Mint address</dt>
                  <dd className="max-w-[230px] truncate font-mono text-[11px] text-slate-100 sm:max-w-[260px] sm:text-[12px]">
                    {mint}
                  </dd>
                </div>

                {symbol && (
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <dt className="text-slate-400">Symbol</dt>
                    <dd className="font-medium text-slate-100">{symbol}</dd>
                  </div>
                )}

                {meta?.id && (
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <dt className="text-slate-400">CoinGecko id</dt>
                    <dd className="font-mono text-[11px] text-slate-200 sm:text-[12px]">
                      {meta.id}
                    </dd>
                  </div>
                )}

                {meta?.categories && (
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <dt className="text-slate-400">Category</dt>
                    <dd className="font-medium text-emerald-200">
                      {meta.categories}
                    </dd>
                  </div>
                )}

                {typeof meta?.decimals === "number" && (
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <dt className="text-slate-400">Decimals</dt>
                    <dd className="text-slate-100">{meta.decimals}</dd>
                  </div>
                )}
              </dl>

              <p className="mt-3 text-[11px] text-slate-500">
                Prices shown in your display currency (
                <span className="font-semibold text-slate-200">
                  {displayCurrency}
                </span>
                ). Backend quotes use USD under the hood, then convert for UI.
              </p>
            </div>

            <div className="glass-panel-soft flex flex-col justify-between p-4 sm:p-5">
              <div className="space-y-3 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Snapshot
                </h3>

                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-slate-400">Current price</span>
                  <span className="font-medium text-slate-100">
                    {formatCurrency(spotPriceDisplay, displayCurrency)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-slate-400">24h change</span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      priceChange24hPct && priceChange24hPct > 0
                        ? "text-emerald-400"
                        : priceChange24hPct && priceChange24hPct < 0
                        ? "text-red-400"
                        : "text-slate-300"
                    }`}
                  >
                    {priceChange24hPct && priceChange24hPct > 0 ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : priceChange24hPct && priceChange24hPct < 0 ? (
                      <ArrowDownRight className="h-3 w-3" />
                    ) : null}
                    {formatPct(priceChange24hPct)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-slate-400">
                    {TIMEFRAMES[timeframe].label} performance
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${changeColor}`}
                  >
                    {perfIsUp ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : perfIsDown ? (
                      <ArrowDownRight className="h-3 w-3" />
                    ) : null}
                    {formatPct(perfPct)}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 px-3 py-3 text-[11px] text-emerald-100">
                <p className="font-medium">
                  Haven tip: think in total portfolio, not just one trade.
                </p>
                <p className="mt-1 text-emerald-50/80">
                  This screen is all about a single asset. Your Haven home view
                  will always show how this fits into your overall risk and
                  savings.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoinPage;
