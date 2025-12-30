// components/invest/Sell.tsx
"use client";

import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import Image from "next/image";
import { ArrowDown, ChevronDown } from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { useServerSponsoredSwap } from "@/hooks/useServerSponsoredSwap";

import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokenConfig";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const CLUSTER = getCluster();
const ENV_USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "";
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "";

// UI fee (preview only; server is source of truth)
const FEE_RATE_RAW = process.env.NEXT_PUBLIC_CRYPTO_SWAP_FEE_UI ?? "0.01";

/* --------------------------------------------------------------------- */
/* BigInt helpers (no bigint literals like 1n/0n)                         */
/* --------------------------------------------------------------------- */
const BI_ZERO = BigInt(0);
const BI_ONE = BigInt(1);
const BI_TEN = BigInt(10);
const BI_BPS_SCALE = BigInt(10000);

function biPow10(decimals: number) {
  return BI_TEN ** BigInt(decimals);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function feeBpsFromEnv(): number {
  const rate = Number(FEE_RATE_RAW);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const clamped = clamp(rate, 0, 0.2);
  return Math.round(clamped * 10000);
}

function ceilMulDivBigInt(amount: bigint, mul: bigint, div: bigint) {
  return (amount * mul + (div - BI_ONE)) / div;
}

function sanitizeAmount(v: string) {
  const cleaned = v.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 2) return cleaned;
  return parts[0] + "." + parts.slice(1).join("");
}

/** Convert decimal UI string -> base units bigint (no float drift) */
function uiToUnits(ui: string, decimals: number): bigint {
  const s = (ui || "").trim();
  if (!s) return BI_ZERO;
  const neg = s.startsWith("-");
  const raw = neg ? s.slice(1) : s;

  const [iRaw, fRaw = ""] = raw.split(".");
  const i = iRaw.replace(/^0+/, "") || "0";
  const f = fRaw.replace(/[^\d]/g, "");

  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  const combined = (i + frac).replace(/^0+/, "") || "0";
  const out = BigInt(combined);
  return neg ? -out : out;
}

/** Format base units -> UI string */
function formatUnits(units: string | bigint, decimals: number, maxFrac = 6) {
  const u = typeof units === "bigint" ? units : BigInt(units || "0");
  const neg = u < BI_ZERO;
  const x = neg ? -u : u;

  const base = biPow10(decimals);
  const whole = x / base;
  const frac = x % base;

  let fracStr = frac.toString().padStart(decimals, "0");
  if (maxFrac < decimals) fracStr = fracStr.slice(0, maxFrac);
  fracStr = fracStr.replace(/0+$/, "");

  const out = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  return neg ? `-${out}` : out;
}

async function fetchMintDecimalsBestEffort(
  mint: string
): Promise<number | null> {
  if (!RPC) return null;
  try {
    const conn = new Connection(RPC, "confirmed");
    const info = await conn.getParsedAccountInfo(
      new PublicKey(mint),
      "confirmed"
    );
    const parsed = info.value?.data as
      | { parsed?: { info?: { decimals?: unknown } } }
      | null;
    const dec = parsed?.parsed?.info?.decimals;
    return typeof dec === "number" ? dec : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- */

type SellDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMint?: string;
};

type SwapToken = {
  kind: "wallet" | "config" | "cash";
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
};

type PickerSide = "from" | "to" | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function confirmSignatureBestEffort(sig: string) {
  if (!RPC || !sig) return;
  try {
    const conn = new Connection(RPC, "confirmed");
    await Promise.race([
      conn.confirmTransaction(sig, "confirmed"),
      sleep(8000).then(() => {
        throw new Error("confirm timeout");
      }),
    ]);
  } catch {
    // best-effort only
  }
}

type QuoteView = {
  outUi: string;
  minOutUi: string;
  priceImpactPctText: string | null;
  routeText: string | null;
};

const SellDrawer: React.FC<SellDrawerProps> = ({
  open,
  onOpenChange,
  initialMint,
}) => {
  const { tokens, refresh } = useBalance();
  const { user } = useUser();

  const {
    swap,
    loading: swapLoading,
    error: swapErr,
    reset: resetSwap,
  } = useServerSponsoredSwap();

  // ✅ refresh balances AFTER modal closes
  const [refreshOnClose, setRefreshOnClose] = useState(false);
  const [lastSwapSig, setLastSwapSig] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    if (open) return;
    if (!refreshOnClose) return;
    if (refreshInFlight.current) return;

    refreshInFlight.current = true;
    (async () => {
      try {
        if (lastSwapSig) await confirmSignatureBestEffort(lastSwapSig);
        await refresh();
        await sleep(900);
        await refresh();
      } finally {
        refreshInFlight.current = false;
        setRefreshOnClose(false);
        setLastSwapSig(null);
      }
    })();
  }, [open, refreshOnClose, refresh, lastSwapSig]);

  /* -------------------- token lists -------------------- */

  const walletTokens: SwapToken[] = useMemo(
    () =>
      tokens.map((t) => ({
        kind: "wallet" as const,
        mint: t.mint,
        symbol: t.symbol || t.name || t.mint.slice(0, 4),
        name: t.name || t.symbol || "Unknown token",
        logo: t.logoURI ?? null,
      })),
    [tokens]
  );

  const ownedMintSet = useMemo(
    () => new Set(tokens.map((t) => t.mint)),
    [tokens]
  );

  const configTokens: SwapToken[] = useMemo(() => {
    const seen = new Set<string>();
    const list: SwapToken[] = [];

    for (const meta of TOKENS as TokenMeta[]) {
      const mint = getMintFor(meta, CLUSTER);
      if (!mint) continue;
      if (seen.has(mint)) continue;
      seen.add(mint);

      if (ENV_USDC_MINT && mint === ENV_USDC_MINT) continue;

      list.push({
        kind: "config",
        mint,
        symbol: meta.symbol || meta.name || mint.slice(0, 4),
        name: meta.name || meta.symbol || "Unknown token",
        logo: meta.logo || null,
      });
    }

    return list;
  }, []);

  const cashDisplayName = user?.displayCurrency || "Cash";

  const cashToken: SwapToken | null = useMemo(() => {
    if (!ENV_USDC_MINT) return null;
    return {
      kind: "cash",
      mint: ENV_USDC_MINT,
      symbol: cashDisplayName,
      name: cashDisplayName,
      logo: "/logos/cash.png",
    };
  }, [cashDisplayName]);

  const toTokenOptions: SwapToken[] = useMemo(() => {
    const ownedFirst = configTokens.filter((t) => ownedMintSet.has(t.mint));
    const rest = configTokens.filter((t) => !ownedMintSet.has(t.mint));
    return cashToken
      ? [cashToken, ...ownedFirst, ...rest]
      : [...ownedFirst, ...rest];
  }, [cashToken, configTokens, ownedMintSet]);

  /* -------------------- local state -------------------- */

  const [fromMint, setFromMint] = useState<string>("");
  const [toMint, setToMint] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [isMax, setIsMax] = useState<boolean>(false);

  const [pickerSide, setPickerSide] = useState<PickerSide>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  // Quote UI
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);

  // mint decimals cache (for receive token)
  const mintDecimalsRef = useRef<Record<string, number>>({});

  const setMintDecimalsCached = useCallback(
    (mint: string, decimals: number) => {
      mintDecimalsRef.current[mint] = decimals;
    },
    []
  );

  const getMintDecimalsCached = useCallback(
    (mint: string): number | null => {
      if (!mint) return null;
      if (ENV_USDC_MINT && mint === ENV_USDC_MINT) return 6;

      const owned = tokens.find((t) => t.mint === mint);
      if (owned?.decimals != null) return owned.decimals;

      const cached = mintDecimalsRef.current[mint];
      return typeof cached === "number" ? cached : null;
    },
    [tokens]
  );

  /* -------------------- keep from/to valid -------------------- */

  useEffect(() => {
    if (!walletTokens.length) {
      setFromMint("");
      return;
    }

    if (initialMint) {
      const exists = walletTokens.some((t) => t.mint === initialMint);
      if (exists) {
        setFromMint(initialMint);
        return;
      }
    }

    setFromMint((prev) => {
      if (prev && walletTokens.some((t) => t.mint === prev)) return prev;
      return walletTokens[0]?.mint ?? "";
    });
  }, [walletTokens, initialMint]);

  useEffect(() => {
    if (!toTokenOptions.length) {
      setToMint("");
      return;
    }

    setToMint((prev) => {
      if (prev && toTokenOptions.some((t) => t.mint === prev)) return prev;
      return toTokenOptions[0]?.mint ?? "";
    });
  }, [toTokenOptions]);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setPickerSide(null);
      setPickerSearch("");
      setAmount("");
      setIsMax(false);
      setQuote(null);
      setQuoteErr(null);
      setQuoteLoading(false);
      resetSwap();
    }
  }, [open, resetSwap]);

  const fromToken =
    walletTokens.find((t) => t.mint === fromMint) || walletTokens[0];
  const toToken =
    toTokenOptions.find((t) => t.mint === toMint) || toTokenOptions[0];
  const fromWallet = tokens.find((t) => t.mint === fromToken?.mint);
  const hasFromWallet = !!fromWallet;
  const fromWalletDecimals = fromWallet?.decimals;
  const fromWalletAmount = fromWallet?.amount;

  const parsedAmount = parseFloat(amount || "0") || 0;

  const fromUsdPrice = fromWallet?.usdPrice ?? 0;
  const estFromUsd =
    (isMax ? fromWallet?.amount ?? 0 : parsedAmount) *
    (Number(fromUsdPrice) || 0);

  const canSubmit =
    !!fromToken &&
    !!toToken &&
    fromToken.mint !== toToken.mint &&
    !!user?.walletAddress &&
    (isMax ? true : parsedAmount > 0) &&
    !swapLoading;

  /* -------------------- picker filtered -------------------- */

  const currentPickerTokens: SwapToken[] = useMemo(() => {
    const base =
      pickerSide === "from"
        ? walletTokens
        : pickerSide === "to"
        ? toTokenOptions
        : [];
    if (!pickerSearch.trim()) return base;

    const q = pickerSearch.trim().toLowerCase();
    return base.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    );
  }, [pickerSide, pickerSearch, walletTokens, toTokenOptions]);

  /* -------------------- fee preview (client-side) -------------------- */

  const feePreview = useMemo(() => {
    const feeBps = feeBpsFromEnv();
    if (!fromWallet || !fromToken) return null;

    const inDec = fromWallet.decimals ?? 0;
    const grossUiStr = isMax ? String(fromWallet.amount ?? "0") : amount;

    const grossUnits = uiToUnits(grossUiStr || "0", inDec);
    if (grossUnits <= BI_ZERO || feeBps <= 0) return null;

    const feeUnits = ceilMulDivBigInt(grossUnits, BigInt(feeBps), BI_BPS_SCALE);
    const netUnits = grossUnits - feeUnits;
    if (netUnits <= BI_ZERO) return null;

    return {
      feeBps,
      grossUnits: grossUnits.toString(),
      feeUnits: feeUnits.toString(),
      netUnits: netUnits.toString(),
      feeUi: formatUnits(feeUnits, inDec, 6),
      netUi: formatUnits(netUnits, inDec, 6),
    };
  }, [fromWallet, fromToken, amount, isMax]);

  /* -------------------- ensure receive decimals known (best effort) -------------------- */

  useEffect(() => {
    if (!open) return;
    const mint = toToken?.mint;
    if (!mint) return;

    const known = getMintDecimalsCached(mint);
    if (typeof known === "number") return;

    let cancelled = false;
    (async () => {
      const dec = await fetchMintDecimalsBestEffort(mint);
      if (cancelled) return;
      if (typeof dec === "number") setMintDecimalsCached(mint, dec);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, toToken?.mint, getMintDecimalsCached, setMintDecimalsCached]);

  /* -------------------- quote fetch (debounced) -------------------- */

  const quoteAbortRef = useRef<AbortController | null>(null);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;

    if (!fromToken?.mint || !toToken?.mint) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    if (fromToken.mint === toToken.mint) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    if (!hasFromWallet || (fromWalletDecimals == null && fromWalletDecimals !== 0)) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }

    const grossUiStr = isMax ? String(fromWalletAmount ?? "0") : amount;
    if (!isMax && (!grossUiStr || parseFloat(grossUiStr) <= 0)) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }

    const inDec = fromWalletDecimals ?? 0;
    const grossUnits = uiToUnits(grossUiStr || "0", inDec);
    if (grossUnits <= BI_ZERO) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }

    const feeBps = feeBpsFromEnv();
    const feeUnits =
      feeBps > 0
        ? ceilMulDivBigInt(grossUnits, BigInt(feeBps), BI_BPS_SCALE)
        : BI_ZERO;
    const netUnits = grossUnits - feeUnits;

    if (netUnits <= BI_ZERO) {
      setQuote(null);
      setQuoteErr("Amount is too small to cover Haven’s fee.");
      return;
    }

    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    quoteAbortRef.current?.abort();

    quoteTimerRef.current = setTimeout(() => {
      const ac = new AbortController();
      quoteAbortRef.current = ac;

      (async () => {
        setQuoteLoading(true);
        setQuoteErr(null);

        try {
          const res = await fetch("/api/jup/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inputMint: fromToken.mint,
              outputMint: toToken.mint,
              amount: netUnits.toString(), // base units
              slippageBps: 50,
            }),
            cache: "no-store",
            signal: ac.signal,
          });

          const text = await res.text().catch(() => "");
          const json = text ? JSON.parse(text) : {};

          if (!res.ok) {
            throw new Error(
              String(json?.error || `Quote failed (HTTP ${res.status})`)
            );
          }

          const outDec = getMintDecimalsCached(toToken.mint) ?? 6;

          const outUi = formatUnits(String(json?.outAmount || "0"), outDec, 6);
          const minUi = formatUnits(
            String(json?.otherAmountThreshold || "0"),
            outDec,
            6
          );

          const labels = Array.isArray(json?.routeLabels)
            ? (json.routeLabels as string[])
            : [];
          const routeText = labels.length
            ? labels.slice(0, 3).join(" → ")
            : null;

          const piPct =
            typeof json?.priceImpactPct === "string" &&
            json.priceImpactPct.trim()
              ? `${(Number(json.priceImpactPct) * 100).toFixed(2)}%`
              : null;

          setQuote({
            outUi,
            minOutUi: minUi,
            routeText,
            priceImpactPctText: piPct,
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setQuote(null);
          const message = err instanceof Error ? err.message : String(err);
          setQuoteErr(message);
        } finally {
          setQuoteLoading(false);
        }
      })();
    }, 350);

    return () => {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
      quoteAbortRef.current?.abort();
    };
  }, [
    open,
    fromToken?.mint,
    toToken?.mint,
    hasFromWallet,
    fromWalletDecimals,
    fromWalletAmount,
    amount,
    isMax,
    getMintDecimalsCached,
  ]);

  /* -------------------- handlers -------------------- */

  const handleMax = () => {
    if (!fromWallet) return;
    setIsMax(true);
    setAmount(fromWallet.amount.toString());
  };

  const handleSwapSides = () => {
    if (!fromToken || !toToken) return;

    const toIsWallet = walletTokens.some((t) => t.mint === toToken.mint);
    if (!toIsWallet) return;

    setFromMint(toToken.mint);
    setToMint(fromToken.mint);
    setIsMax(false);
    setPickerSide(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !fromToken || !toToken || !user?.walletAddress) return;

    try {
      resetSwap();

      const sig = await swap({
        fromOwnerBase58: user.walletAddress,
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        amountUi: amount,
        slippageBps: 50,
        isMax,
      });

      setLastSwapSig(sig ?? null);
      setRefreshOnClose(true);
      onOpenChange(false);
    } catch (e) {
      console.error("[SellModal] swap failed", e);
    }
  };

  const openPicker = (side: PickerSide) => {
    setPickerSide(side);
    setPickerSearch("");
  };

  const closePicker = () => {
    setPickerSide(null);
    setPickerSearch("");
  };

  const handlePickToken = (token: SwapToken) => {
    if (pickerSide === "from") {
      setFromMint(token.mint);
      setAmount("");
      setIsMax(false);
    } else if (pickerSide === "to") {
      setToMint(token.mint);
    }
    closePicker();
  };

  /* -------------------- UI -------------------- */

  const hasWalletTokens = walletTokens.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          // base styling
          "p-0 overflow-hidden border border-zinc-800 bg-zinc-950 py-2",

          // ✅ DESKTOP: don't touch left/top/translate/inset — Radix already centers it
          "sm:w-[min(92vw,420px)] sm:max-w-[420px] sm:max-h-[90dvh] sm:rounded-[28px]",
          "sm:shadow-[0_18px_60px_rgba(0,0,0,0.85)]",

          // ✅ MOBILE ONLY: fullscreen
          "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
          "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
          "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",
        ].join(" ")}
      >
       
        

        <div className="flex h-full flex-col">
          {/* Scrollable body */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] sm:px-4 sm:pb-4 sm:pt-3">
            {!hasWalletTokens ? (
              <DialogHeader className="pb-3">
                <DialogTitle className="text-sm font-semibold text-zinc-50">
                  Sell from your portfolio
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-400">
                  You don’t have any tokens to sell yet.
                </DialogDescription>
              </DialogHeader>
            ) : (
              <>
                <DialogHeader className="pb-3">
                  <DialogTitle className="text-sm font-semibold text-zinc-50">
                    Sell
                  </DialogTitle>
                  <DialogDescription className="text-[11px] text-zinc-400">
                    Sell your assets for cash or swap to another asset.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3 text-xs text-zinc-100">
                  {/* SELL panel */}
                  <div className="rounded-2xl bg-zinc-900/90 px-3.5 py-3.5">
                    <div className="mb-2 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-500">Sell</span>
                      {fromWallet && (
                        <div className="flex items-center gap-2">
                          {isMax && (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                              Max
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={handleMax}
                            className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20"
                          >
                            Max
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => {
                            setIsMax(false);
                            setAmount(sanitizeAmount(e.target.value));
                          }}
                          placeholder="0.00"
                          className="w-full bg-transparent text-left text-2xl font-semibold text-zinc-50 outline-none placeholder:text-zinc-600"
                        />
                        <p className="mt-1 text-[11px] text-zinc-500">
                          {estFromUsd > 0
                            ? estFromUsd.toLocaleString("en-US", {
                                style: "currency",
                                currency: "USD",
                                maximumFractionDigits: 2,
                              })
                            : "$0.00"}
                        </p>
                      </div>

                      <div className="w-[152px] text-left">
                        <button
                          type="button"
                          onClick={() => openPicker("from")}
                          className="flex w-full items-center justify-between rounded-2xl bg-zinc-800 px-2.5 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <TokenAvatar token={fromToken} />
                            <div className="flex flex-col">
                              <span className="text-[11px] font-semibold">
                                {fromToken?.symbol}
                              </span>
                              <span className="text-[10px] text-zinc-500">
                                {fromToken?.name}
                              </span>
                            </div>
                          </div>
                          <ChevronDown className="h-3 w-3 text-zinc-500" />
                        </button>
                      </div>
                    </div>

                    {fromWallet && (
                      <p className="mt-2 text-[10px] text-zinc-500">
                        Available:{" "}
                        {fromWallet.amount.toLocaleString("en-US", {
                          maximumFractionDigits: 4,
                        })}{" "}
                        {fromToken?.symbol}
                      </p>
                    )}

                    {feePreview && (
                      <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[10px] text-zinc-400">
                        <div className="flex items-center justify-between">
                          <span>
                            Haven fee ({(feePreview.feeBps / 100).toFixed(2)}%)
                          </span>
                          <span className="text-zinc-200">
                            ~{feePreview.feeUi} {fromToken?.symbol}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span>Amount swapped (net)</span>
                          <span className="text-zinc-200">
                            ~{feePreview.netUi} {fromToken?.symbol}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleSwapSides}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-emerald-400 hover:text-emerald-200"
                      title="Swap sides (only works if the Receive token is one you own)"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>

                  {/* RECEIVE panel */}
                  <div className="rounded-2xl bg-zinc-900/90 px-3.5 py-3.5">
                    <div className="mb-2 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-500">Receive</span>
                      {cashToken && toToken?.kind === "cash" && (
                        <span className="text-[10px] text-zinc-500">
                          {cashDisplayName} (cash)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="w-[152px] text-left">
                        <button
                          type="button"
                          onClick={() => openPicker("to")}
                          className="flex w-full items-center justify-between rounded-2xl bg-zinc-800 px-2.5 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <TokenAvatar token={toToken} />
                            <div className="flex flex-col">
                              <span className="text-[11px] font-semibold">
                                {toToken?.symbol}
                              </span>
                              <span className="text-[10px] text-zinc-500">
                                {toToken?.name}
                              </span>
                            </div>
                          </div>
                          <ChevronDown className="h-3 w-3 text-zinc-500" />
                        </button>
                      </div>

                      <div className="flex-1 text-right">
                        <p className="text-xl font-semibold text-zinc-50">
                          {quoteLoading
                            ? "…"
                            : quote
                            ? `~ ${quote.outUi}`
                            : "—"}
                        </p>
                        <p className="mt-1 text-[10px] text-zinc-500">
                          {quoteLoading
                            ? "Fetching live quote…"
                            : quote
                            ? `Min received: ${quote.minOutUi}`
                            : "Enter an amount to see an estimate."}
                        </p>
                      </div>
                    </div>

                    {(quote?.routeText || quote?.priceImpactPctText) && (
                      <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[10px] text-zinc-400">
                        {quote?.routeText && (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-zinc-500">Route</span>
                            <span className="truncate text-zinc-200">
                              {quote.routeText}
                            </span>
                          </div>
                        )}
                        {quote?.priceImpactPctText && (
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-zinc-500">Price impact</span>
                            <span className="text-zinc-200">
                              {quote.priceImpactPctText}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {quoteErr && (
                      <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                        {quoteErr}
                      </div>
                    )}
                  </div>

                  {/* rate row */}
                  <div className="mt-1 rounded-full bg-zinc-900/80 px-3 py-2 text-[10px] text-zinc-500">
                    1 {fromToken?.symbol} ≈{" "}
                    {quote && feePreview
                      ? (() => {
                          const netUiNum = Number(feePreview.netUi);
                          const outUiNum = Number(quote.outUi);
                          if (
                            !Number.isFinite(netUiNum) ||
                            !Number.isFinite(outUiNum) ||
                            netUiNum <= 0
                          )
                            return "—";
                          const r = outUiNum / netUiNum;
                          return r > 0
                            ? r.toLocaleString("en-US", {
                                maximumFractionDigits: 6,
                              })
                            : "—";
                        })()
                      : "—"}{" "}
                    {toToken?.symbol}
                  </div>

                  {cashToken && (
                    <p className="mt-1 text-[10px] text-zinc-500">
                      {cashDisplayName} is your Haven cash balance.
                    </p>
                  )}

                  {swapErr && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                      {swapErr}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Pinned footer */}
          <DialogFooter className="shrink-0 border-t border-zinc-800 bg-zinc-950/95 px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+12px)] sm:px-4 sm:py-3 sm:pb-3">
            {!hasWalletTokens ? (
              <DialogClose asChild>
                <Button
                  variant="outline"
                  className="w-full border-zinc-700 text-zinc-100"
                >
                  Close
                </Button>
              </DialogClose>
            ) : (
              <Button
                className="w-full rounded-full bg-emerald-500 text-[13px] font-semibold text-black hover:bg-emerald-400"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {swapLoading ? "Submitting…" : "Swap"}
              </Button>
            )}
          </DialogFooter>
        </div>

        {/* Picker modal (above dialog) */}
        {pickerSide && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 px-3.5 py-3.5 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-50">
                  {pickerSide === "from"
                    ? "Choose token to sell"
                    : "Choose token to receive"}
                </h2>
                <button
                  type="button"
                  onClick={() => closePicker()}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200"
                >
                  Close
                </button>
              </div>

              <div className="mb-2">
                <input
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search by name or symbol"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40"
                />
              </div>

              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {currentPickerTokens.map((t) => (
                  <button
                    key={t.mint + t.kind}
                    type="button"
                    onClick={() => handlePickToken(t)}
                    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] hover:bg-zinc-900 ${
                      (pickerSide === "from" && t.mint === fromMint) ||
                      (pickerSide === "to" && t.mint === toMint)
                        ? "bg-zinc-900/90"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <TokenAvatar token={t} />
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {t.symbol}
                          {t.kind === "cash" && (
                            <span className="ml-1 rounded-full bg-emerald-500/10 px-1.5 py-[1px] text-[9px] text-emerald-300">
                              cash
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {t.name}
                        </span>
                      </div>
                    </div>

                    {pickerSide === "from" && (
                      <span className="text-[10px] text-zinc-500">
                        {tokens
                          .find((wt) => wt.mint === t.mint)
                          ?.amount?.toLocaleString("en-US", {
                            maximumFractionDigits: 4,
                          }) ?? "0"}
                      </span>
                    )}
                  </button>
                ))}

                {currentPickerTokens.length === 0 && (
                  <p className="pt-4 text-center text-[11px] text-zinc-500">
                    No tokens found.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* -------------------- avatar -------------------- */

const TokenAvatar: React.FC<{ token: SwapToken | undefined }> = ({ token }) => {
  if (!token) {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-[10px] text-zinc-300">
        ?
      </div>
    );
  }

  if (token.logo) {
    return (
      <div className="relative h-7 w-7 overflow-hidden rounded-full border border-zinc-700 bg-zinc-900">
        <Image
          src={token.logo}
          alt={token.name}
          fill
          sizes="28px"
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] font-semibold text-zinc-100">
      {token.symbol.slice(0, 3).toUpperCase()}
    </div>
  );
};

export default SellDrawer;
