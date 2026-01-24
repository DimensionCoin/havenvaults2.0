// components/invest/Sell.tsx
"use client";

import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  ArrowDown,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  Wallet,
  ExternalLink,
  X,
  RefreshCw,
} from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import {
  useServerSponsoredSwap,
  type SwapStatus,
} from "@/hooks/useServerSponsoredSwap";

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
  mint: string,
): Promise<number | null> {
  if (!RPC) return null;
  try {
    const conn = new Connection(RPC, "confirmed");
    const info = await conn.getParsedAccountInfo(
      new PublicKey(mint),
      "confirmed",
    );
    const parsed = info.value?.data as {
      parsed?: { info?: { decimals?: unknown } };
    } | null;
    const dec = parsed?.parsed?.info?.decimals;
    return typeof dec === "number" ? dec : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- */
/* CoinPage-style modal + stages                                          */
/* --------------------------------------------------------------------- */

const STAGE_CONFIG: Record<
  SwapStatus,
  {
    title: string;
    subtitle: string;
    progress: number;
    icon: "spinner" | "wallet" | "success" | "error";
  }
> = {
  idle: { title: "", subtitle: "", progress: 0, icon: "spinner" },
  building: {
    title: "Preparing order",
    subtitle: "Finding best route...",
    progress: 15,
    icon: "spinner",
  },
  signing: {
    title: "Approving the transaction",
    subtitle: "Approving the transaction with exchange",
    progress: 30,
    icon: "wallet",
  },
  sending: {
    title: "Submitting",
    subtitle: "Broadcasting to network...",
    progress: 60,
    icon: "spinner",
  },
  confirming: {
    title: "Confirming",
    subtitle: "Waiting for network...",
    progress: 85,
    icon: "spinner",
  },
  done: {
    title: "Order complete!",
    subtitle: "Your swap was successful",
    progress: 100,
    icon: "success",
  },
  error: {
    title: "Order failed",
    subtitle: "Something went wrong",
    progress: 0,
    icon: "error",
  },
};

type ModalKind = "processing" | "success" | "error";

type ModalState = {
  kind: ModalKind;
  signature?: string | null;
  errorMessage?: string;
  fromSymbol?: string;
  toSymbol?: string;
} | null;

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
      <div
        className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

function StageIcon({
  icon,
}: {
  icon: "spinner" | "wallet" | "success" | "error";
}) {
  if (icon === "success") {
    return (
      <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center">
        <CheckCircle2 className="h-8 w-8 text-primary" />
      </div>
    );
  }

  if (icon === "error") {
    return (
      <div className="w-14 h-14 rounded-2xl bg-destructive/15 border border-destructive/20 flex items-center justify-center">
        <XCircle className="h-8 w-8 text-destructive" />
      </div>
    );
  }

  if (icon === "wallet") {
    return (
      <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center animate-pulse">
        <Wallet className="h-8 w-8 text-amber-500" />
      </div>
    );
  }

  return (
    <div className="w-14 h-14 rounded-2xl bg-secondary border border-border flex items-center justify-center">
      <RefreshCw className="h-8 w-8 text-muted-foreground animate-spin" />
    </div>
  );
}

function explorerUrl(sig: string) {
  return `https://solscan.io/tx/${sig}`;
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

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    swap,
    reset: resetSwap,
    status: swapStatus,
    error: swapErr,
    signature: hookSig,
    isBusy: swapBusy,
  } = useServerSponsoredSwap();

  // ✅ coinpage-style modal state
  const [modal, setModal] = useState<ModalState>(null);

  const closeModal = useCallback(() => {
    if (!modal || modal.kind === "processing") return;
    setModal(null);
  }, [modal]);

  // ✅ refresh balances AFTER modal closes (success only)
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
    [tokens],
  );

  const ownedMintSet = useMemo(
    () => new Set(tokens.map((t) => t.mint)),
    [tokens],
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
    [],
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
    [tokens],
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
      setModal(null);
      resetSwap();
    }
  }, [open, resetSwap]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

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
    (isMax ? (fromWallet?.amount ?? 0) : parsedAmount) *
    (Number(fromUsdPrice) || 0);

  const canSubmit =
    !!fromToken &&
    !!toToken &&
    fromToken.mint !== toToken.mint &&
    !!user?.walletAddress &&
    (isMax ? true : parsedAmount > 0) &&
    !swapBusy;

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
        t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
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
    if (
      !hasFromWallet ||
      (fromWalletDecimals == null && fromWalletDecimals !== 0)
    ) {
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
      setQuoteErr("Amount is too small to cover Haven's fee.");
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
              String(json?.error || `Quote failed (HTTP ${res.status})`),
            );
          }

          const outDec = getMintDecimalsCached(toToken.mint) ?? 6;

          const outUi = formatUnits(String(json?.outAmount || "0"), outDec, 6);
          const minUi = formatUnits(
            String(json?.otherAmountThreshold || "0"),
            outDec,
            6,
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

    resetSwap();
    setModal({
      kind: "processing",
      fromSymbol: fromToken.symbol,
      toSymbol: toToken.symbol,
    });

    try {
      const result = await swap({
        fromOwnerBase58: user.walletAddress,
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        amountUi: amount,
        slippageBps: 50,
        isMax,
      });

      setLastSwapSig(result.signature ?? null);
      setRefreshOnClose(true);

      setModal({
        kind: "success",
        signature: result.signature,
        fromSymbol: fromToken.symbol,
        toSymbol: toToken.symbol,
      });
    } catch (e) {
      const msg =
        swapErr?.message ||
        (e instanceof Error ? e.message : "Swap failed. Please try again.");

      setModal({
        kind: "error",
        errorMessage: msg,
        fromSymbol: fromToken.symbol,
        toSymbol: toToken.symbol,
      });
    }
  };

  const closeAfterSuccess = async () => {
    setModal(null);
    onOpenChange(false);
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

  // coinpage stage config uses swapStatus while modal processing
  const currentStage = modal?.kind === "processing" ? swapStatus : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  const errorToShow = swapErr?.message || null;

  if (!mounted) return null;

  // ✅ RESTYLED sell modal (processing/success/error) — functionality unchanged
  const renderSwapModal = () => {
    if (!modal) return null;

    return createPortal(
      <div
        className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md px-3 sm:px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && modal.kind !== "processing") {
            closeModal();
          }
        }}
      >
        <div
          className={[
            "relative w-full sm:max-w-md overflow-hidden",
            "rounded-t-[28px] sm:rounded-[28px]",
            "border border-border bg-background",
            "shadow-[0_22px_80px_rgba(0,0,0,0.75)]",
          ].join(" ")}
          onClick={(e) => e.stopPropagation()}
        >
          {/* top glow */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent" />

          {/* header */}
          <div className="relative flex items-center justify-between px-5 pt-5">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary/70" />
              <p className="text-[11px] font-medium text-muted-foreground">
                Haven Swap
              </p>
            </div>

            {modal.kind !== "processing" && (
              <button
                onClick={closeModal}
                className="rounded-full border border-border bg-background/70 p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="relative px-5 pb-5 pt-4">
            <div className="flex flex-col items-center text-center gap-3">
              {modal.kind === "processing" && stageConfig ? (
                <>
                  <StageIcon icon={stageConfig.icon} />

                  <div>
                    <div className="text-[18px] leading-tight font-semibold text-foreground">
                      {stageConfig.title}
                    </div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      {stageConfig.subtitle}
                    </div>
                  </div>

                  <div className="w-full max-w-[240px] pt-1">
                    <ProgressBar progress={stageConfig.progress} />
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Processing</span>
                      <span>{stageConfig.progress}%</span>
                    </div>
                  </div>

                  {modal.fromSymbol && modal.toSymbol && (
                    <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {modal.fromSymbol}
                      </span>
                      <span>→</span>
                      <span className="font-medium text-foreground">
                        {modal.toSymbol}
                      </span>
                    </div>
                  )}

                  <div className="mt-3 w-full rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-[11px] text-muted-foreground">
                    Please don&apos;t close this window while we submit and
                    confirm your transaction.
                  </div>
                </>
              ) : modal.kind === "success" ? (
                <>
                  <StageIcon icon="success" />

                  <div>
                    <div className="text-[20px] leading-tight font-semibold text-foreground">
                      Swap complete
                    </div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      Your trade was successful.
                    </div>
                  </div>

                  {modal.signature && (
                    <a
                      href={explorerUrl(modal.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 w-full rounded-2xl border border-border bg-secondary/40 px-4 py-3 flex items-center justify-between hover:bg-accent transition group"
                    >
                      <span className="text-[13px] text-foreground">
                        View transaction
                      </span>
                      <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    </a>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2 w-full">
                    <button
                      onClick={closeModal}
                      className="h-11 rounded-full border border-border bg-secondary/40 text-[13px] font-semibold text-foreground hover:bg-accent transition"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        void closeAfterSuccess();
                      }}
                      className="h-11 rounded-full bg-primary text-[13px] font-semibold text-black hover:opacity-90 transition"
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <StageIcon icon="error" />

                  <div>
                    <div className="text-[18px] leading-tight font-semibold text-destructive">
                      Order failed
                    </div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      Something went wrong. You can try again.
                    </div>
                  </div>

                  {modal.errorMessage && (
                    <div className="mt-2 w-full rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3">
                      <p className="text-[12px] text-destructive text-center">
                        {modal.errorMessage}
                      </p>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2 w-full">
                    <button
                      onClick={closeModal}
                      className="h-11 rounded-full border border-border bg-secondary/40 text-[13px] font-semibold text-foreground hover:bg-accent transition"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        setModal(null);
                      }}
                      className="h-11 rounded-full bg-primary text-[13px] font-semibold text-black hover:opacity-90 transition"
                    >
                      Try again
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* mobile safe area */}
          <div className="h-[calc(env(safe-area-inset-bottom)+10px)]" />
        </div>
      </div>,
      document.body,
    );
  };

  // Render token picker modal via portal (matches Deposit pattern)
  const renderPickerModal = () => {
    if (!pickerSide) return null;

    return createPortal(
      <div
        className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) closePicker();
        }}
      >
        <div
          className="relative w-full sm:max-w-md haven-card overflow-hidden h-[70vh] sm:h-auto sm:max-h-[70vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">
                {pickerSide === "from"
                  ? "Choose token to sell"
                  : "Choose token to receive"}
              </h2>
              <button
                onClick={closePicker}
                className="haven-icon-btn !w-9 !h-9"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4">
              <input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search by name or symbol"
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Token list */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-2">
            <div className="space-y-1">
              {currentPickerTokens.map((t) => (
                <button
                  key={t.mint + t.kind}
                  type="button"
                  onClick={() => handlePickToken(t)}
                  className={[
                    "flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-accent transition",
                    (pickerSide === "from" && t.mint === fromMint) ||
                    (pickerSide === "to" && t.mint === toMint)
                      ? "bg-accent"
                      : "",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <TokenAvatar token={t} />
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium text-foreground">
                        {t.symbol}
                        {t.kind === "cash" && (
                          <span className="ml-2 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                            cash
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {t.name}
                      </span>
                    </div>
                  </div>

                  {pickerSide === "from" && (
                    <span className="text-[12px] text-muted-foreground">
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
                <p className="py-8 text-center text-[13px] text-muted-foreground">
                  No tokens found.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={[
            // base
            "p-0 overflow-hidden border border-border bg-background",

            // desktop
            "sm:w-[min(92vw,440px)] sm:max-w-[440px] sm:max-h-[90dvh] sm:rounded-[28px]",
            "sm:shadow-[0_18px_60px_rgba(0,0,0,0.85)]",

            // mobile fullscreen
            "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
            "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
            "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",
          ].join(" ")}
        >
          <div className="relative flex h-full flex-col">
            {/* subtle top glow */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent" />

            {/* Scrollable body */}
            <div className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-[calc(env(safe-area-inset-top)+14px)] sm:px-5 sm:pb-5 sm:pt-5">
              {!hasWalletTokens ? (
                <DialogHeader className="pb-3">
                  <DialogTitle className="text-[13px] font-semibold text-foreground">
                    Sell from your portfolio
                  </DialogTitle>
                  <DialogDescription className="text-[12px] text-muted-foreground">
                    You don&apos;t have any tokens to sell yet.
                  </DialogDescription>
                </DialogHeader>
              ) : (
                <>
                  <DialogHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <DialogTitle className="text-[14px] font-semibold text-foreground">
                          Sell
                        </DialogTitle>
                        <DialogDescription className="text-[12px] text-muted-foreground">
                          Sell your assets for cash or swap to another asset.
                        </DialogDescription>
                      </div>

                      <DialogClose asChild>
                        <button
                          className="mt-0.5 rounded-full border border-border bg-background/70 p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition"
                          aria-label="Close"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </DialogClose>
                    </div>
                  </DialogHeader>

                  <div className="flex flex-col gap-3 text-xs text-foreground">
                    {/* SELL panel */}
                    <div className="rounded-[22px] border border-border bg-secondary/20 px-4 py-4">
                      <div className="mb-2 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Sell</span>
                        {fromWallet && (
                          <div className="flex items-center gap-2">
                            {isMax && (
                              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                Max
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={swapBusy}
                              onClick={handleMax}
                              className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-accent disabled:opacity-60"
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
                            disabled={swapBusy}
                            value={amount}
                            onChange={(e) => {
                              setIsMax(false);
                              setAmount(sanitizeAmount(e.target.value));
                            }}
                            placeholder="0.00"
                            className="w-full bg-transparent text-left text-[28px] leading-none font-semibold text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
                          />
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {estFromUsd > 0
                              ? estFromUsd.toLocaleString("en-US", {
                                  style: "currency",
                                  currency: "USD",
                                  maximumFractionDigits: 2,
                                })
                              : "$0.00"}
                          </p>
                        </div>

                        <div className="w-[168px] text-left">
                          <button
                            type="button"
                            disabled={swapBusy}
                            onClick={() => openPicker("from")}
                            className="flex w-full items-center justify-between rounded-2xl border border-border bg-background/70 px-3 py-2.5 hover:bg-accent disabled:opacity-60 transition"
                          >
                            <div className="flex items-center gap-2">
                              <TokenAvatar token={fromToken} />
                              <div className="flex flex-col">
                                <span className="text-[11px] font-semibold">
                                  {fromToken?.symbol}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {fromToken?.name}
                                </span>
                              </div>
                            </div>
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      </div>

                      {fromWallet && (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          Available:{" "}
                          {fromWallet.amount.toLocaleString("en-US", {
                            maximumFractionDigits: 4,
                          })}{" "}
                          {fromToken?.symbol}
                        </p>
                      )}

                      {feePreview && (
                        <div className="mt-3 rounded-2xl border border-border bg-background/60 px-4 py-3 text-[10px] text-muted-foreground">
                          <div className="flex items-center justify-between">
                            <span>
                              Haven fee ({(feePreview.feeBps / 100).toFixed(2)}
                              %)
                            </span>
                            <span className="text-foreground">
                              ~{feePreview.feeUi} {fromToken?.symbol}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span>Amount swapped (net)</span>
                            <span className="text-foreground">
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
                        disabled={swapBusy}
                        onClick={handleSwapSides}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/70 text-foreground hover:bg-accent disabled:opacity-60 transition"
                        title="Swap sides (only works if the Receive token is one you own)"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>

                    {/* RECEIVE panel */}
                    <div className="rounded-[22px] border border-border bg-secondary/20 px-4 py-4">
                      <div className="mb-2 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Receive</span>
                        {cashToken && toToken?.kind === "cash" && (
                          <span className="text-[10px] text-muted-foreground">
                            {cashDisplayName} (cash)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="w-[168px] text-left">
                          <button
                            type="button"
                            disabled={swapBusy}
                            onClick={() => openPicker("to")}
                            className="flex w-full items-center justify-between rounded-2xl border border-border bg-background/70 px-3 py-2.5 hover:bg-accent disabled:opacity-60 transition"
                          >
                            <div className="flex items-center gap-2">
                              <TokenAvatar token={toToken} />
                              <div className="flex flex-col">
                                <span className="text-[11px] font-semibold">
                                  {toToken?.symbol}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {toToken?.name}
                                </span>
                              </div>
                            </div>
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>

                        <div className="flex-1 text-right">
                          <p className="text-[22px] leading-none font-semibold text-foreground">
                            {quoteLoading
                              ? "…"
                              : quote
                                ? `~ ${quote.outUi}`
                                : "—"}
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {quoteLoading
                              ? "Fetching live quote…"
                              : quote
                                ? `Min received: ${quote.minOutUi}`
                                : "Enter an amount to see an estimate."}
                          </p>
                        </div>
                      </div>

                      {(quote?.routeText || quote?.priceImpactPctText) && (
                        <div className="mt-3 rounded-2xl border border-border bg-background/60 px-4 py-3 text-[10px] text-muted-foreground">
                          {quote?.routeText && (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">
                                Route
                              </span>
                              <span className="truncate text-foreground">
                                {quote.routeText}
                              </span>
                            </div>
                          )}
                          {quote?.priceImpactPctText && (
                            <div className="mt-1 flex items-center justify-between">
                              <span className="text-muted-foreground">
                                Price impact
                              </span>
                              <span className="text-foreground">
                                {quote.priceImpactPctText}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {quoteErr && (
                        <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[11px] text-destructive">
                          {quoteErr}
                        </div>
                      )}
                    </div>

                    {/* rate row */}
                    <div className="mt-1 rounded-full border border-border bg-background/70 px-4 py-2 text-[10px] text-muted-foreground">
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
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {cashDisplayName} is your Haven cash balance.
                      </p>
                    )}

                    {errorToShow && modal?.kind !== "error" && (
                      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[11px] text-destructive">
                        {errorToShow}
                      </div>
                    )}

                    {hookSig && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Last tx:{" "}
                        <a
                          href={explorerUrl(hookSig)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:opacity-90 underline underline-offset-2"
                        >
                          view
                        </a>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Pinned footer */}
            <DialogFooter className="relative shrink-0 border-t border-border bg-background/95 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+14px)] sm:px-5 sm:py-4 sm:pb-4">
              {!hasWalletTokens ? (
                <DialogClose asChild>
                  <Button variant="outline" className="w-full rounded-full">
                    Close
                  </Button>
                </DialogClose>
              ) : (
                <Button
                  className="w-full rounded-full h-11"
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                >
                  {swapBusy ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </span>
                  ) : (
                    <span className="text-black">Swap</span>
                  )}
                </Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Render modals via portal - outside Dialog to avoid z-index issues */}
      {renderPickerModal()}
      {renderSwapModal()}
    </>
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
