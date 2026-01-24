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
  Search,
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

function fmtFiat(n: number, currency: string) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  try {
    return x.toLocaleString("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return x.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
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
    subtitle: "Finding best route…",
    progress: 15,
    icon: "spinner",
  },
  signing: {
    title: "Approving transaction",
    subtitle: "Approving with your wallet…",
    progress: 30,
    icon: "wallet",
  },
  sending: {
    title: "Submitting",
    subtitle: "Broadcasting to network…",
    progress: 60,
    icon: "spinner",
  },
  confirming: {
    title: "Confirming",
    subtitle: "Waiting for network…",
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
      <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
        <CheckCircle2 className="h-10 w-10 text-primary" />
      </div>
    );
  }

  if (icon === "error") {
    return (
      <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center">
        <XCircle className="h-10 w-10 text-destructive" />
      </div>
    );
  }

  if (icon === "wallet") {
    return (
      <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center animate-pulse">
        <Wallet className="h-10 w-10 text-amber-500" />
      </div>
    );
  }

  return (
    <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
      <RefreshCw className="h-10 w-10 text-muted-foreground animate-spin" />
    </div>
  );
}

function explorerUrl(sig: string) {
  const cluster = String(CLUSTER || "");
  const isMainnet = cluster === "" || cluster === "mainnet-beta";
  const clusterQuery = !isMainnet
    ? `?cluster=${encodeURIComponent(cluster)}`
    : "";
  return `https://solscan.io/tx/${sig}${clusterQuery}`;
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

/* --------------------------------------------------------------------- */
/* Transfer-style picker (same shell + search + row styling)              */
/* --------------------------------------------------------------------- */

function TokenPickerModal({
  open,
  title,
  subtitle,
  tokens,
  selectedMint,
  search,
  onSearch,
  onClose,
  onPick,
  rightSlotForMint,
}: {
  open: boolean;
  title: string;
  subtitle: string;
  tokens: SwapToken[];
  selectedMint: string;
  search: string;
  onSearch: (v: string) => void;
  onClose: () => void;
  onPick: (t: SwapToken) => void;
  rightSlotForMint?: (mint: string) => React.ReactNode;
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full sm:max-w-md haven-card overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground tracking-tight">
              {title}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="haven-icon-btn !w-9 !h-9"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search by name or symbol"
              className="haven-input pl-10 text-black"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 space-y-1.5">
          {tokens.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              No assets found
            </div>
          ) : (
            tokens.map((t) => {
              const isSelected = t.mint === selectedMint;
              return (
                <button
                  key={`${t.mint}:${t.kind}`}
                  type="button"
                  onClick={() => onPick(t)}
                  className={[
                    "w-full flex items-center justify-between gap-3 p-3 rounded-xl transition-all",
                    isSelected
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-background hover:bg-accent border border-transparent",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TokenAvatar token={t} size="lg" />
                    <div className="min-w-0 text-left">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        {t.symbol}
                        {t.kind === "cash" && (
                          <span className="ml-2 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                            cash
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {t.name}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">{rightSlotForMint?.(t.mint)}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SellDrawer: React.FC<SellDrawerProps> = ({
  open,
  onOpenChange,
  initialMint,
}) => {
  const { tokens, refresh } = useBalance();
  const { user } = useUser();

  // IMPORTANT: BalanceProvider already converts balances/prices into the user's display currency.
  // So we only *format* using the displayCurrency; we do not convert here.
  const displayCurrency = user?.displayCurrency || "USD";

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

  // coinpage-style modal state
  const [modal, setModal] = useState<ModalState>(null);

  const closeModal = useCallback(() => {
    if (!modal || modal.kind === "processing") return;
    setModal(null);
  }, [modal]);

  // refresh balances AFTER modal closes (success only)
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

  const cashDisplayName = displayCurrency;

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

  // Reset when closed
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

  // NOTE: usdPrice is already in displayCurrency (provided by BalanceProvider)
  const fromFxPrice = fromWallet?.usdPrice ?? 0;
  const estFromFiat =
    (isMax ? (fromWallet?.amount ?? 0) : parsedAmount) *
    (Number(fromFxPrice) || 0);

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
              amount: netUnits.toString(),
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
        e instanceof Error ? e.message : "Swap failed. Please try again.";
      setModal({
        kind: "error",
        errorMessage: msg,
        fromSymbol: fromToken?.symbol,
        toSymbol: toToken?.symbol,
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

  const currentStage = modal?.kind === "processing" ? swapStatus : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  const errorToShow = swapErr?.message || null;

  const canClose = !swapBusy && modal?.kind !== "processing";

  const close = () => {
    if (!canClose) return;
    onOpenChange(false);
  };

  if (!open || !mounted) return null;

  /* ------------------------------------------------------------------ */
  /* Deposit-style overlays (portal), matching your Deposit modal shell  */
  /* ------------------------------------------------------------------ */

  const renderSwapModal = () => {
    if (!modal) return null;

    return createPortal(
      <div
        className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && modal.kind !== "processing")
            closeModal();
        }}
      >
        <div
          className={[
            "relative w-full sm:max-w-md haven-card overflow-hidden",
            "max-sm:rounded-t-[28px] sm:rounded-[28px]",
            "h-auto max-h-[90vh] flex flex-col",
          ].join(" ")}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
            <div className="flex flex-col">
              <div className="text-[15px] font-semibold text-foreground">
                {modal.kind === "processing"
                  ? "Processing"
                  : modal.kind === "success"
                    ? "Complete"
                    : "Failed"}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {modal.kind === "processing"
                  ? "Don’t close Haven while we finish."
                  : modal.kind === "success"
                    ? "Your trade went through."
                    : "We couldn’t complete that trade."}
              </div>
            </div>

            <button
              onClick={() => {
                if (modal.kind !== "processing") closeModal();
              }}
              className="haven-icon-btn !w-9 !h-9"
              aria-label="Close"
              disabled={modal.kind === "processing"}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
            {modal.kind === "processing" && stageConfig ? (
              <>
                <StageIcon icon={stageConfig.icon} />

                <div className="text-center">
                  <div className="text-lg font-semibold text-foreground">
                    {stageConfig.title}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {stageConfig.subtitle}
                  </div>
                </div>

                <div className="w-full max-w-[220px]">
                  <ProgressBar progress={stageConfig.progress} />
                </div>

                {modal.fromSymbol && modal.toSymbol && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {modal.fromSymbol} → {modal.toSymbol}
                  </div>
                )}

                <div className="mt-3 w-full rounded-2xl border border-border bg-background/60 px-4 py-3 text-center text-[11px] text-muted-foreground">
                  This can take a few seconds.
                </div>
              </>
            ) : modal.kind === "success" ? (
              <>
                <StageIcon icon="success" />

                <div className="text-center">
                  <div className="text-xl font-semibold text-foreground">
                    Swap complete
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Funds will update shortly.
                  </div>
                </div>

                {modal.signature && (
                  <a
                    href={explorerUrl(modal.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 w-full haven-card-soft px-4 py-3 flex items-center justify-between hover:bg-accent transition group"
                  >
                    <span className="text-sm text-foreground">
                      View transaction
                    </span>
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                  </a>
                )}

                <div className="mt-4 flex gap-2 w-full">
                  <button
                    onClick={closeModal}
                    className="haven-btn-secondary flex-1"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      void closeAfterSuccess();
                    }}
                    className="haven-btn-primary flex-1"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <StageIcon icon="error" />

                <div className="text-center">
                  <div className="text-lg font-semibold text-destructive">
                    Order failed
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Try again in a moment.
                  </div>
                </div>

                {modal.errorMessage && (
                  <div className="mt-4 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-2xl">
                    <p className="text-[12px] text-destructive text-center">
                      {modal.errorMessage}
                    </p>
                  </div>
                )}

                <div className="mt-4 flex gap-2 w-full">
                  <button
                    onClick={closeModal}
                    className="haven-btn-secondary flex-1"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setModal(null);
                    }}
                    className="haven-btn-primary flex-1"
                  >
                    Try again
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  /* ------------------------------------------------------------------ */
  /* Main modal (Deposit-style shell)                                    */
  /* ------------------------------------------------------------------ */

  const body = (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (canClose && e.target === e.currentTarget) close();
      }}
    >
      <div
        className="relative w-full sm:max-w-md haven-card overflow-hidden h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (Deposit-style) */}
        <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
                Sell
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Sell your assets for cash or swap into another token.
              </p>
            </div>

            <button
              type="button"
              onClick={close}
              disabled={!canClose}
              className="haven-icon-btn !w-9 !h-9"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 sm:px-4 pb-2 sm:pb-4 pt-2">
          {!hasWalletTokens ? (
            <div className="haven-card-soft p-4 mt-2">
              <div className="text-sm font-semibold text-foreground">
                Nothing to sell yet
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Once you hold tokens in your portfolio, you’ll be able to sell
                them here.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* SELL card */}
              <div className="haven-card-soft px-3.5 py-3.5">
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
                        className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-accent disabled:opacity-60"
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
                      className="w-full bg-transparent text-left text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
                    />

                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {estFromFiat > 0
                        ? fmtFiat(estFromFiat, displayCurrency)
                        : fmtFiat(0, displayCurrency)}
                    </p>
                  </div>

                  <div className="w-[160px] text-left">
                    <button
                      type="button"
                      disabled={swapBusy}
                      onClick={() => openPicker("from")}
                      className="flex w-full items-center justify-between rounded-2xl border border-border bg-background/60 px-2.5 py-2 hover:bg-accent disabled:opacity-60"
                    >
                      <div className="flex items-center gap-2">
                        <TokenAvatar token={fromToken} />
                        <div className="flex flex-col leading-tight">
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
                  <div className="mt-2 rounded-2xl border border-border bg-background/60 px-3 py-2 text-[10px] text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>
                        Haven fee ({(feePreview.feeBps / 100).toFixed(2)}%)
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

              {/* Middle control */}
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={swapBusy}
                  onClick={handleSwapSides}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/60 text-foreground hover:bg-accent disabled:opacity-60"
                  title="Swap sides (works only if Receive token is in your wallet)"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>

              {/* RECEIVE card */}
              <div className="haven-card-soft px-3.5 py-3.5">
                <div className="mb-2 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Receive</span>
                  {cashToken && toToken?.kind === "cash" && (
                    <span className="text-[10px] text-muted-foreground">
                      {cashDisplayName} (cash)
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="w-[160px] text-left">
                    <button
                      type="button"
                      disabled={swapBusy}
                      onClick={() => openPicker("to")}
                      className="flex w-full items-center justify-between rounded-2xl border border-border bg-background/60 px-2.5 py-2 hover:bg-accent disabled:opacity-60"
                    >
                      <div className="flex items-center gap-2">
                        <TokenAvatar token={toToken} />
                        <div className="flex flex-col leading-tight">
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
                    <p className="text-xl font-semibold text-foreground">
                      {quoteLoading ? "…" : quote ? `~ ${quote.outUi}` : "—"}
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
                  <div className="mt-2 rounded-2xl border border-border bg-background/60 px-3 py-2 text-[10px] text-muted-foreground">
                    {quote?.routeText && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Route</span>
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
                  <div className="mt-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    {quoteErr}
                  </div>
                )}
              </div>

              {/* Rate + helper */}
              <div className="rounded-full border border-border bg-background/60 px-3 py-2 text-[10px] text-muted-foreground">
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
                <p className="text-[10px] text-muted-foreground px-1">
                  {cashDisplayName} is your Haven cash balance.
                </p>
              )}

              {errorToShow && modal?.kind !== "error" && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  {errorToShow}
                </div>
              )}

              {hookSig && (
                <div className="text-[10px] text-muted-foreground px-1">
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
          )}
        </div>

        {/* Footer (Deposit-style pinned) */}
        <div className="flex-shrink-0 p-5 border-t border-border bg-card/80 backdrop-blur-sm">
          {!hasWalletTokens ? (
            <button
              type="button"
              onClick={close}
              className="haven-btn-secondary w-full"
              disabled={!canClose}
            >
              Close
            </button>
          ) : (
            <button
              type="button"
              className={[
                "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                canSubmit
                  ? "haven-btn-primary"
                  : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
              ].join(" ")}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {swapBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <span className="text-black">Swap</span>
              )}
            </button>
          )}

          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            Live pricing via Jupiter • Includes Haven fee preview
          </div>
        </div>
      </div>
    </div>
  );

  /* ------------------------------------------------------------------ */
  /* Picker modal (NOW matches TransferSPL asset picker exactly)         */
  /* ------------------------------------------------------------------ */

  const pickerTitle = pickerSide === "from" ? "Choose asset" : "Choose asset";
  const pickerSubtitle =
    pickerSide === "from"
      ? "Select the token you want to sell"
      : "Select the token you want to receive";

  const pickerSelectedMint = pickerSide === "from" ? fromMint : toMint;

  const rightSlotForMint = (mint: string) => {
    if (pickerSide === "from") {
      const wt = tokens.find((x) => x.mint === mint);
      const amt = wt?.amount ?? 0;
      const fx = Number(wt?.usdValue ?? 0); // already display-currency valued
      return (
        <>
          <p className="text-[12px] font-medium text-foreground">
            {amt.toLocaleString("en-US", { maximumFractionDigits: 6 })}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {fx > 0 ? `~${fmtFiat(fx, displayCurrency)}` : ""}
          </p>
        </>
      );
    }

    // "to" picker: show nothing (Transfer picker shows balances; receive list doesn’t need it)
    return null;
  };

  return (
    <>
      {createPortal(body, document.body)}

      <TokenPickerModal
        open={!!pickerSide}
        title={pickerTitle}
        subtitle={pickerSubtitle}
        tokens={pickerSide ? currentPickerTokens : []}
        selectedMint={pickerSelectedMint || ""}
        search={pickerSearch}
        onSearch={setPickerSearch}
        onClose={closePicker}
        onPick={handlePickToken}
        rightSlotForMint={rightSlotForMint}
      />

      {renderSwapModal()}
    </>
  );
};

/* -------------------- avatar -------------------- */

const TokenAvatar: React.FC<{
  token: SwapToken | undefined;
  size?: "sm" | "lg";
}> = ({ token, size = "sm" }) => {
  const dim = size === "lg" ? "w-10 h-10" : "h-7 w-7";
  const border = size === "lg" ? "" : "border border-zinc-700";

  if (!token) {
    return (
      <div
        className={`flex ${dim} items-center justify-center rounded-full bg-zinc-800 text-[10px] text-zinc-300`}
      >
        ?
      </div>
    );
  }

  if (token.logo) {
    return (
      <div
        className={`relative ${dim} overflow-hidden rounded-full ${border} bg-zinc-900 flex-shrink-0`}
      >
        <Image
          src={token.logo}
          alt={token.name}
          fill
          sizes={size === "lg" ? "40px" : "28px"}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex ${dim} items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] font-semibold text-zinc-100 flex-shrink-0`}
    >
      {token.symbol.slice(0, 3).toUpperCase()}
    </div>
  );
};

export default SellDrawer;
