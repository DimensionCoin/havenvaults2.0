// app/(app)/invest/[id]/page.tsx
"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import type { WalletToken } from "@/providers/BalanceProvider";

import { useServerSponsoredUsdcSwap } from "@/hooks/useServerSponsoredUsdcSwap";
import { useServerSponsoredJLJupUSDSwap } from "@/hooks/Useserversponsoredjljupusdswap";
import { useServerSponsoredToJLJupUSDSwap } from "@/hooks/Useserversponsoredtojljupusdswap";

import About from "@/components/coinPage/About";

import {
  // Types
  type PaymentAccount,
  type ReceiveAccount,
  type ModalState,
  type TimeframeKey,
  type SleekPoint,
  type HistoricalPoint,
  type HistoricalApiResponse,
  type SpotResp,
  type JupPriceResp,
  type TokenCategory,
  // Constants
  SWAP_FEE_PCT,
  TIMEFRAMES,
  STAGE_CONFIG,
  // Utils
  resolveTokenFromSlug,
  clampNumber,
  safeParse,
  grossUpForFee,
  // Components
  TradeModal,
  PriceChartSection,
  TradePanel,
  DepositSection,
  NotFoundView,
} from "@/components/coinPage";

const CoinPage: React.FC = () => {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useUser();

  const {
    displayCurrency,
    fxRate,
    tokens,
    usdcAmount,
    usdcUsd,
    savingsPlusAmount,
    savingsPlusUsd,
    plusReady,
    refresh: refreshBalances,
  } = useBalance();

  const {
    swap: usdcSwap,
    status: usdcSwapStatus,
    error: usdcSwapError,
    reset: resetUsdcSwap,
    isBusy: usdcSwapBusy,
  } = useServerSponsoredUsdcSwap();

  const {
    swap: jlJupUsdSwap,
    status: jlJupUsdSwapStatus,
    error: jlJupUsdSwapError,
    reset: resetJlJupUsdSwap,
    isBusy: jlJupUsdSwapBusy,
  } = useServerSponsoredJLJupUSDSwap();

  const {
    swap: toJlJupUsdSwap,
    status: toJlJupUsdSwapStatus,
    error: toJlJupUsdSwapError,
    reset: resetToJlJupUsdSwap,
    isBusy: toJlJupUsdSwapBusy,
  } = useServerSponsoredToJLJupUSDSwap();

  /* ───────── Token Resolution ───────── */

  const slug = (params?.id || "").toString();
  const resolved = useMemo(() => resolveTokenFromSlug(slug), [slug]);
  const tokenFound = !!resolved;
  const meta = resolved?.meta;
  const mint = resolved?.mint ?? "";

  /* ───────── State ───────── */

  const [timeframe, setTimeframe] = useState<TimeframeKey>("7D");
  const [history, setHistory] = useState<HistoricalPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [spotPriceUsd, setSpotPriceUsd] = useState<number | null>(null);
  const [priceChange24hPct, setPriceChange24hPct] = useState<number | null>(
    null,
  );
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceSource, setPriceSource] = useState<
    "coingecko" | "jupiter" | null
  >(null);

  const [description, setDescription] = useState<string | null>(null);

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [paymentAccount, setPaymentAccount] = useState<PaymentAccount>("cash");
  const [receiveAccount, setReceiveAccount] = useState<ReceiveAccount>("cash");
  const [inputUnit, setInputUnit] = useState<"cash" | "asset">("cash");
  const [cashAmount, setCashAmount] = useState<string>("");
  const [assetAmount, setAssetAmount] = useState<string>("");
  const [lastEdited, setLastEdited] = useState<"cash" | "asset">("cash");

  const [isMaxSell, setIsMaxSell] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);

  const tradeStartedRef = useRef(false);

  /* ───────── Derived Token Info ───────── */

  const name = meta?.name || meta?.symbol || "Unknown asset";
  const symbol = meta?.symbol || "";
  const category = (meta?.categories || "Uncategorized") as
    | TokenCategory
    | string;
  const logo = meta?.logo || null;
  const ownerBase58 = user?.walletAddress ?? "";
  const coingeckoId = (meta?.id || "").trim();
  const hasCoingeckoId = coingeckoId.length > 0;

  /* ───────── Swap Status Logic ───────── */

  const swapStatus = useMemo(() => {
    if (side === "buy") {
      return paymentAccount === "cash" ? usdcSwapStatus : jlJupUsdSwapStatus;
    }
    return receiveAccount === "cash" ? usdcSwapStatus : toJlJupUsdSwapStatus;
  }, [
    side,
    paymentAccount,
    receiveAccount,
    usdcSwapStatus,
    jlJupUsdSwapStatus,
    toJlJupUsdSwapStatus,
  ]);

  const swapError = useMemo(() => {
    if (side === "buy") {
      return paymentAccount === "cash" ? usdcSwapError : jlJupUsdSwapError;
    }
    return receiveAccount === "cash" ? usdcSwapError : toJlJupUsdSwapError;
  }, [
    side,
    paymentAccount,
    receiveAccount,
    usdcSwapError,
    jlJupUsdSwapError,
    toJlJupUsdSwapError,
  ]);

  const swapBusy = useMemo(() => {
    if (side === "buy") {
      return paymentAccount === "cash" ? usdcSwapBusy : jlJupUsdSwapBusy;
    }
    return receiveAccount === "cash" ? usdcSwapBusy : toJlJupUsdSwapBusy;
  }, [
    side,
    paymentAccount,
    receiveAccount,
    usdcSwapBusy,
    jlJupUsdSwapBusy,
    toJlJupUsdSwapBusy,
  ]);

  const resetSwap = useCallback(() => {
    resetUsdcSwap();
    resetJlJupUsdSwap();
    resetToJlJupUsdSwap();
  }, [resetUsdcSwap, resetJlJupUsdSwap, resetToJlJupUsdSwap]);

  /* ───────── Balances ───────── */

  // NOTE: token objects coming from BalanceProvider usually include decimals.
  // Use tokenPosition decimals first; it's the most reliable.
  const tokenPositionFull = useMemo(() => {
    const t: WalletToken | undefined = tokens.find((x) => x.mint === mint);
    return {
      amount: t?.amount ?? 0,
      valueDisplay: typeof t?.usdValue === "number" ? t.usdValue : 0,
      decimals:
        typeof t?.decimals === "number"
          ? t.decimals
          : undefined,
    };
  }, [tokens, mint]);

  const tokenBalance = clampNumber(tokenPositionFull.amount);
  const tokenValueDisplay = clampNumber(tokenPositionFull.valueDisplay);

  const cashBalanceInternal = clampNumber(Number(usdcAmount ?? 0));
  const cashBalanceDisplay = clampNumber(
    typeof usdcUsd === "number" ? usdcUsd : 0,
  );
  const plusBalanceInternal = clampNumber(savingsPlusAmount);
  const plusBalanceDisplay = clampNumber(savingsPlusUsd);

  const activeBalanceInternal =
    paymentAccount === "cash" ? cashBalanceInternal : plusBalanceInternal;
  const activeBalanceDisplay =
    paymentAccount === "cash" ? cashBalanceDisplay : plusBalanceDisplay;

  const tokenDecimals =
    typeof tokenPositionFull.decimals === "number" &&
    Number.isFinite(tokenPositionFull.decimals)
      ? tokenPositionFull.decimals
      : typeof meta?.decimals === "number" && Number.isFinite(meta.decimals)
        ? meta.decimals
        : 6;

  /* ───────── Fetch Spot Price ───────── */

  useEffect(() => {
    const controller = new AbortController();

    const loadSpotPrice = async () => {
      try {
        setPriceLoading(true);
        setDescription(null);

        if (hasCoingeckoId) {
          const res = await fetch("/api/prices/coingecko", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [coingeckoId] }),
            cache: "no-store",
          });

          if (res.ok) {
            const data = (await res.json()) as SpotResp;
            const entry = data?.prices?.[coingeckoId];
            if (entry) {
              setSpotPriceUsd(
                typeof entry.priceUsd === "number" ? entry.priceUsd : null,
              );
              setPriceChange24hPct(
                typeof entry.priceChange24hPct === "number"
                  ? entry.priceChange24hPct
                  : null,
              );

              const entryWithDesc = entry as typeof entry & {
                description?: string | null;
              };
              setDescription(
                typeof entryWithDesc.description === "string"
                  ? entryWithDesc.description
                  : null,
              );

              setPriceSource("coingecko");
              return;
            }
          }
        }

        if (mint) {
          const res = await fetch("/api/prices/jup", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mints: [mint] }),
            cache: "no-store",
          });

          if (res.ok) {
            const data = (await res.json()) as JupPriceResp;
            const entry = data?.prices?.[mint];
            if (entry) {
              setSpotPriceUsd(
                typeof entry.price === "number" ? entry.price : null,
              );
              setPriceChange24hPct(
                typeof entry.priceChange24hPct === "number"
                  ? entry.priceChange24hPct
                  : null,
              );
              setDescription(null);
              setPriceSource("jupiter");
              return;
            }
          }
        }

        setSpotPriceUsd(null);
        setPriceChange24hPct(null);
        setPriceSource(null);
        setDescription(null);
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name === "AbortError") return;
      } finally {
        setPriceLoading(false);
      }
    };

    loadSpotPrice();
    return () => controller.abort();
  }, [coingeckoId, hasCoingeckoId, mint]);

  /* ───────── Fetch History ───────── */

  useEffect(() => {
    if (!hasCoingeckoId) {
      setHistory([]);
      setHistoryError(null);
      return;
    }

    const controller = new AbortController();
    const cfg = TIMEFRAMES[timeframe];

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);

        const url = `/api/prices/coingecko/historical?id=${encodeURIComponent(
          coingeckoId,
        )}&days=${encodeURIComponent(cfg.days)}`;

        const res = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          setHistory([]);
          setHistoryError("Couldn't load chart data.");
          return;
        }

        const data = (await res.json()) as HistoricalApiResponse;
        setHistory(Array.isArray(data?.prices) ? data.prices : []);
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e?.name === "AbortError") return;
        setHistory([]);
        setHistoryError("Couldn't load chart data.");
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
    return () => controller.abort();
  }, [coingeckoId, hasCoingeckoId, timeframe]);

  /* ───────── Derived Values ───────── */

  const spotPriceDisplay =
    spotPriceUsd && fxRate ? spotPriceUsd * fxRate : null;

  const chartData = useMemo((): SleekPoint[] => {
    if (!history?.length) return [];
    if (!fxRate || fxRate <= 0) return [];
    return history.map((p) => ({ t: p.t, y: p.price * fxRate }));
  }, [history, fxRate]);

  const cashNum = safeParse(cashAmount);
  const assetNum = safeParse(assetAmount);

  // cashAmount is in DISPLAY currency, convert to USD for calculations
  const cashUsd = fxRate && fxRate > 0 && cashNum > 0 ? cashNum / fxRate : 0;
  const assetUsd = spotPriceUsd && assetNum > 0 ? assetNum * spotPriceUsd : 0;

  const tradeCalculations = useMemo(() => {
    if (!spotPriceUsd || spotPriceUsd <= 0 || !fxRate || fxRate <= 0) {
      return {
        grossUsd: 0,
        feeUsd: 0,
        netUsd: 0,
        grossDisplay: 0,
        feeDisplay: 0,
        netDisplay: 0,
        receiveAsset: 0,
        receiveCashDisplay: 0,
        payAsset: 0,
        payCashDisplay: 0,
      };
    }

    let grossUsd = 0;
    let feeUsd = 0;
    let netUsd = 0;

    if (side === "buy") {
      if (lastEdited === "cash") {
        grossUsd = cashUsd;
        feeUsd = grossUsd * SWAP_FEE_PCT;
        netUsd = Math.max(grossUsd - feeUsd, 0);
      } else {
        netUsd = assetUsd;
        grossUsd = grossUpForFee(netUsd, SWAP_FEE_PCT);
        feeUsd = grossUsd - netUsd;
      }
    } else {
      if (lastEdited === "asset") {
        grossUsd = assetUsd;
        feeUsd = grossUsd * SWAP_FEE_PCT;
        netUsd = Math.max(grossUsd - feeUsd, 0);
      } else {
        netUsd = cashUsd;
        grossUsd = grossUpForFee(netUsd, SWAP_FEE_PCT);
        feeUsd = grossUsd - netUsd;
      }
    }

    const grossDisplay = grossUsd * fxRate;
    const feeDisplay = feeUsd * fxRate;
    const netDisplay = netUsd * fxRate;

    const receiveAsset = side === "buy" ? netUsd / spotPriceUsd : 0;
    const receiveCashDisplay = side === "sell" ? netDisplay : 0;
    const payAsset = side === "sell" ? grossUsd / spotPriceUsd : 0;
    const payCashDisplay = side === "buy" ? grossDisplay : 0;

    return {
      grossUsd,
      feeUsd,
      netUsd,
      grossDisplay,
      feeDisplay,
      netDisplay,
      receiveAsset,
      receiveCashDisplay,
      payAsset,
      payCashDisplay,
    };
  }, [spotPriceUsd, fxRate, side, lastEdited, cashUsd, assetUsd]);

  const { grossUsd, payCashDisplay } = tradeCalculations;
  const grossUsdSafe = grossUsd > 0 && Number.isFinite(grossUsd) ? grossUsd : 0;

  /* ───────── Sync Fields ───────── */

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
      let computed: number;

      if (side === "buy") {
        const fee = usd * SWAP_FEE_PCT;
        const net = usd - fee;
        computed = net / spotPriceUsd;
      } else {
        const gross = grossUpForFee(usd, SWAP_FEE_PCT);
        computed = gross / spotPriceUsd;
      }

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

      const assetValueUsd = n * spotPriceUsd;
      let computed: number;

      if (side === "buy") {
        const gross = grossUpForFee(assetValueUsd, SWAP_FEE_PCT);
        computed = gross * fxRate;
      } else {
        const fee = assetValueUsd * SWAP_FEE_PCT;
        const net = assetValueUsd - fee;
        computed = net * fxRate;
      }

      if (Number.isFinite(computed) && computed > 0) {
        const next = String(computed);
        if (next !== cashAmount) setCashAmount(next);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxRate, spotPriceUsd, lastEdited, side]);

  /* ───────── Modal Stage Config ───────── */

  const currentStage = modal?.kind === "processing" ? swapStatus : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  /* ───────── Handlers ───────── */

  const resetInputs = useCallback(() => {
    setCashAmount("");
    setAssetAmount("");
    setIsMaxSell(false);
    setLocalErr(null);
    setShowBreakdown(false);
    setLastEdited(side === "buy" ? "cash" : "asset");
    setInputUnit(side === "buy" ? "cash" : "asset");
  }, [side]);

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

  const handlePaymentAccountChange = (next: PaymentAccount) => {
    setPaymentAccount(next);
    resetSwap();
    setLocalErr(null);
    setCashAmount("");
    setAssetAmount("");
    setIsMaxSell(false);
  };

  const handleReceiveAccountChange = (next: ReceiveAccount) => {
    setReceiveAccount(next);
    resetSwap();
    setLocalErr(null);
    setCashAmount("");
    setAssetAmount("");
    setIsMaxSell(false);
  };

  const handleInputUnitChange = (next: "cash" | "asset") => {
    setLocalErr(null);
    setIsMaxSell(false);
    setInputUnit(next);
    setLastEdited(next);
  };

  const handleAmountChange = (value: string, unit: "cash" | "asset") => {
    setLocalErr(null);
    setIsMaxSell(false);
    if (unit === "cash") {
      setLastEdited("cash");
      setCashAmount(value);
    } else {
      setLastEdited("asset");
      setAssetAmount(value);
    }
  };

  const setQuickCash = (pct: number) => {
    if (side !== "buy") return;
    if (!activeBalanceDisplay || activeBalanceDisplay <= 0) return;
    const v = activeBalanceDisplay * pct;
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

  const closeModal = useCallback(() => {
    if (!modal || modal.kind === "processing") return;
    setModal(null);
    tradeStartedRef.current = false;
  }, [modal]);

  const executeTrade = useCallback(async () => {
    resetSwap();
    setLocalErr(null);

    tradeStartedRef.current = true;
    setModal({ kind: "processing", side, symbol });

    try {
      if (!ownerBase58) throw new Error("Missing wallet address.");
      if (!fxRate || fxRate <= 0) throw new Error("FX not ready yet.");
      if (!spotPriceUsd || spotPriceUsd <= 0)
        throw new Error("Price not ready.");

      let sig: string;

      // ───────── BUY ─────────
      if (side === "buy") {
        if (grossUsdSafe <= 0) throw new Error("Enter an amount.");

        if (grossUsdSafe > activeBalanceInternal + 0.000001) {
          throw new Error(
            paymentAccount === "cash"
              ? "Not enough Cash available."
              : "Not enough Plus account balance.",
          );
        }

        // amountDisplay should be in DISPLAY currency for the usdcSwap buy path
        let amountDisplay: number;

        if (lastEdited === "cash") {
          amountDisplay = cashNum;
        } else {
          amountDisplay = payCashDisplay;
        }

        if (paymentAccount === "cash") {
          const result = await usdcSwap({
            kind: "buy",
            fromOwnerBase58: ownerBase58,
            outputMint: mint,
            amountDisplay, // display currency
            fxRate,
            slippageBps: 50,
          });
          sig = result.signature;
        } else {
          // Plus account uses underlying USD units (jlJupUSD), so pass USD amount
          const jlJupUsdAmount = amountDisplay / fxRate;

          const result = await jlJupUsdSwap({
            fromOwnerBase58: ownerBase58,
            outputMint: mint,
            amountUi: jlJupUsdAmount,
            slippageBps: 50,
          });
          sig = result.signature;
        }
      }

      // ───────── SELL ─────────
      else {
        const cashDisplayInput = safeParse(cashAmount); // display currency (CAD)
        const assetInputUi = safeParse(assetAmount); // token units

        let sellAmountUi = 0;

        if (inputUnit === "asset") {
          // user typed asset directly
          sellAmountUi = assetInputUi;
        } else {
          // user typed cash in display currency, interpret as "receive this much cash (net)"
          const desiredNetUsd =
            cashDisplayInput > 0 && fxRate > 0 ? cashDisplayInput / fxRate : 0;

          if (desiredNetUsd <= 0) throw new Error("Enter an amount.");

          const grossUsdNeeded = grossUpForFee(desiredNetUsd, SWAP_FEE_PCT);
          sellAmountUi = grossUsdNeeded / spotPriceUsd;
        }

        if (!Number.isFinite(sellAmountUi) || sellAmountUi <= 0) {
          throw new Error("Enter an amount.");
        }

        if (!isMaxSell && sellAmountUi > tokenBalance + 1e-12) {
          throw new Error("Not enough balance to sell that amount.");
        }

        if (receiveAccount === "cash") {
          const result = await usdcSwap({
            kind: "sell",
            fromOwnerBase58: ownerBase58,
            inputMint: mint,
            amountUi: sellAmountUi, // ✅ always token amount
            inputDecimals: tokenDecimals, // ✅ correct decimals
            slippageBps: 50,
            isMax: isMaxSell,
          });
          sig = result.signature;
        } else {
          const result = await toJlJupUsdSwap({
            fromOwnerBase58: ownerBase58,
            inputMint: mint,
            inputDecimals: tokenDecimals, // ✅ correct decimals
            amountUi: sellAmountUi,
            slippageBps: 50,
            isMax: isMaxSell,
          });
          sig = result.signature;
        }
      }

      await refreshBalances();
      resetInputs();

      setModal({
        kind: "success",
        signature: sig,
        side,
        symbol,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalErr(msg);

      setModal({
        kind: "error",
        errorMessage: msg,
        side,
        symbol,
      });
    }
  }, [
    resetSwap,
    side,
    symbol,
    ownerBase58,
    fxRate,
    spotPriceUsd,
    grossUsdSafe,
    activeBalanceInternal,
    paymentAccount,
    receiveAccount,
    lastEdited,
    cashNum,
    payCashDisplay,
    usdcSwap,
    mint,
    jlJupUsdSwap,
    toJlJupUsdSwap,
    tokenBalance,
    tokenDecimals,
    isMaxSell,
    inputUnit,
    cashAmount,
    assetAmount,
    refreshBalances,
    resetInputs,
  ]);

  /* ───────── Derived UI State ───────── */

  const inputsDisabled = swapBusy;

  const perfPct = useMemo(() => {
    const firstPrice = history[0]?.price ?? spotPriceUsd ?? null;
    const lastPrice =
      history[history.length - 1]?.price ?? spotPriceUsd ?? firstPrice ?? null;
    if (!firstPrice || !lastPrice) return 0;
    return ((lastPrice - firstPrice) / firstPrice) * 100;
  }, [history, spotPriceUsd]);

  const primaryDisabled =
    swapBusy ||
    !ownerBase58 ||
    !spotPriceUsd ||
    !fxRate ||
    grossUsdSafe <= 0 ||
    (side === "buy" ? activeBalanceInternal <= 0 : tokenBalance <= 0);

  const errorToShow = modal ? null : localErr || swapError?.message;

  /* ───────── Not Found ───────── */

  if (!tokenFound) {
    return <NotFoundView />;
  }

  /* ───────── Render ───────── */

  return (
    <main className="">
      <TradeModal
        modal={modal}
        stageConfig={stageConfig}
        onClose={closeModal}
      />

      <div className="mx-auto w-full max-w-[520px] px-3 pb-10 pt-4 sm:max-w-[720px] sm:px-4 xl:max-w-5xl">
        <div className="haven-card overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-2 border-b bg-card/60 px-3 py-3 backdrop-blur-xl sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card/80 shadow-fintech-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4 text-foreground/70" />
              </button>

              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                  {symbol || name}
                </h1>
                <p className="truncate text-[11px] text-muted-foreground">
                  Price, chart, and trade.
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-3 sm:p-4">
            <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
              {/* LEFT: Price + Chart */}
              <PriceChartSection
                name={name}
                symbol={symbol}
                logo={logo}
                category={category}
                priceSource={priceSource}
                spotPriceDisplay={spotPriceDisplay}
                priceChange24hPct={priceChange24hPct}
                priceLoading={priceLoading}
                hasCoingeckoId={hasCoingeckoId}
                chartData={chartData}
                historyLoading={historyLoading}
                historyError={historyError}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                displayCurrency={displayCurrency}
                perfPct={perfPct}
                swapBusy={swapBusy}
              />

              {/* RIGHT: Trade */}
              <TradePanel
                name={name}
                symbol={symbol}
                mint={mint}
                coingeckoId={coingeckoId}
                hasCoingeckoId={hasCoingeckoId}
                priceSource={priceSource}
                side={side}
                onSideChange={handleSideChange}
                paymentAccount={paymentAccount}
                onPaymentAccountChange={handlePaymentAccountChange}
                receiveAccount={receiveAccount}
                onReceiveAccountChange={handleReceiveAccountChange}
                inputUnit={inputUnit}
                onInputUnitChange={handleInputUnitChange}
                cashAmount={cashAmount}
                assetAmount={assetAmount}
                onAmountChange={handleAmountChange}
                lastEdited={lastEdited}
                cashBalanceDisplay={cashBalanceDisplay}
                cashBalanceInternal={cashBalanceInternal}
                plusBalanceDisplay={plusBalanceDisplay}
                plusBalanceInternal={plusBalanceInternal}
                plusReady={plusReady}
                tokenBalance={tokenBalance}
                tokenValueDisplay={tokenValueDisplay}
                activeBalanceDisplay={activeBalanceDisplay}
                tradeCalculations={tradeCalculations}
                spotPriceDisplay={spotPriceDisplay}
                assetNum={assetNum}
                swapBusy={swapBusy}
                inputsDisabled={inputsDisabled}
                primaryDisabled={primaryDisabled}
                showBreakdown={showBreakdown}
                onShowBreakdownChange={setShowBreakdown}
                showDetails={showDetails}
                onShowDetailsChange={setShowDetails}
                errorToShow={errorToShow}
                onSetQuickCash={setQuickCash}
                onSetSellMax={setSellMax}
                onExecuteTrade={() => void executeTrade()}
              />
            </div>

            <div className="mt-3">
              <About name={name} symbol={symbol} description={description} />

              <DepositSection
                symbol={symbol}
                ownerBase58={ownerBase58}
                showDeposit={showDeposit}
                onShowDepositChange={setShowDeposit}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default CoinPage;
