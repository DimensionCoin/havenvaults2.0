"use client";

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import Image from "next/image";
import Link from "next/link"
import { createPortal } from "react-dom";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  X,
  Sparkles,
  TrendingUp,
  Shield,
  Zap,
  Search,
  RefreshCw,
  ChevronRight,
  Wallet,
  ExternalLink,
  Layers,
} from "lucide-react";

import { BUNDLES, type RiskLevel } from "./bundlesConfig";
import { findTokenBySymbol, requireMintBySymbol } from "@/lib/tokenConfig";
import { useBalance } from "@/providers/BalanceProvider";

// Privy imports
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useSignMessage,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { Buffer } from "buffer";

if (typeof window !== "undefined") window.Buffer = window.Buffer || Buffer;

/* ───────── TYPES ───────── */

type Props = {
  ownerBase58: string;
};

type SwapStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "done"
  | "error";

type BuyRow = {
  symbol: string;
  outputMint: string;
  status: SwapStatus;
  sig?: string;
  error?: string;
  amountDisplay: number;
  amountUsd: number;
  txBase64?: string;
  signedTxBase64?: string;
};

type BuildResponse = {
  transaction: string;
  inputMint: string;
  outputMint: string;
};

type SendResponse = {
  signature: string;
};

type ModalKind = "input" | "processing" | "success" | "error";

/* ───────── CONSTANTS ───────── */

const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

// Limit concurrency for SEND so Privy/RPC don’t get hammered
const SEND_CONCURRENCY = 4;

/* ───────── HELPERS ───────── */

function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function clampMoneyInput(raw: string) {
  const cleaned = (raw ?? "").replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
}

function safeNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function explorerUrl(sig: string) {
  return `https://solscan.io/tx/${sig}`;
}

function getRiskIcon(risk: RiskLevel) {
  if (risk === "low") return Shield;
  if (risk === "medium") return TrendingUp;
  if (risk === "high") return Zap;
  return Sparkles;
}

function riskPill(risk: RiskLevel) {
  const Icon = getRiskIcon(risk);
  const colors = {
    low: "border-emerald-400/30 bg-emerald-500/20 text-emerald-200",
    medium: "border-amber-400/30 bg-amber-500/20 text-amber-200",
    high: "border-orange-400/30 bg-orange-500/20 text-orange-200",
    degen: "border-rose-400/30 bg-rose-500/20 text-rose-200",
  };
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${colors[risk]}`}
    >
      <Icon className="h-3 w-3" />
      {risk}
    </div>
  );
}

function pickWallet(
  wallets: ConnectedStandardSolanaWallet[],
  address: string
): ConnectedStandardSolanaWallet | null {
  const nonEmbedded = wallets.find(
    (w) => w.address === address && w.standardWallet?.name !== "Privy"
  );
  return nonEmbedded ?? wallets.find((w) => w.address === address) ?? null;
}

function isUserRejection(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("cancelled") ||
    msg.includes("user canceled")
  );
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
  });

  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const d = data as Record<string, unknown> | null;
    const msg =
      (d?.userMessage as string) ||
      (d?.error as string) ||
      (d?.message as string) ||
      `Request failed: ${res.status}`;
    throw new Error(String(msg));
  }

  return data as T;
}

async function asyncPool<T, R>(
  limit: number,
  items: T[],
  fn: (item: T, idx: number) => Promise<R>,
  abortRef?: React.MutableRefObject<boolean>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < items.length; i++) {
    if (abortRef?.current) break;

    const p = (async () => {
      results[i] = await fn(items[i], i);
    })();

    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/* ───────── UI SUBCOMPONENTS (same vibe as DepositFlex) ───────── */

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
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
  const base = "flex h-14 w-14 items-center justify-center rounded-2xl border";

  if (icon === "success") {
    return (
      <div className={`${base} border-emerald-400/30 bg-emerald-500/20`}>
        <CheckCircle2 className="h-7 w-7 text-emerald-400" />
      </div>
    );
  }

  if (icon === "error") {
    return (
      <div className={`${base} border-rose-400/30 bg-rose-500/20`}>
        <XCircle className="h-7 w-7 text-rose-400" />
      </div>
    );
  }

  if (icon === "wallet") {
    return (
      <div
        className={`${base} border-amber-400/30 bg-amber-500/20 animate-pulse`}
      >
        <Wallet className="h-7 w-7 text-amber-400" />
      </div>
    );
  }

  return (
    <div className={`${base} border-white/10 bg-white/5`}>
      <Loader2 className="h-7 w-7 text-white/60 animate-spin" />
    </div>
  );
}

function TokenRowCompact({
  symbol,
  amountLabel,
  status,
  sig,
  error,
}: {
  symbol: string;
  amountLabel: string;
  status: SwapStatus;
  sig?: string;
  error?: string;
}) {
  const meta = findTokenBySymbol(symbol);

  const right =
    status === "done" ? (
      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
    ) : status === "error" ? (
      <XCircle className="h-5 w-5 text-rose-400" />
    ) : status === "signing" ? (
      <Wallet className="h-5 w-5 text-amber-400 animate-pulse" />
    ) : status === "building" || status === "sending" ? (
      <Loader2 className="h-5 w-5 text-white/60 animate-spin" />
    ) : (
      <div className="h-5 w-5 rounded-full border border-white/15" />
    );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-9 w-9 rounded-full overflow-hidden bg-zinc-800 ring-1 ring-white/10 shrink-0">
            <Image
              src={meta?.logo || "/placeholder.svg"}
              alt={symbol}
              fill
              className="object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white/90 truncate">
              {symbol}
            </div>
            <div className="text-[11px] text-white/45">{amountLabel}</div>
          </div>
        </div>
        {right}
      </div>

      {(error || sig) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-[11px] text-white/45 min-w-0">
            {error ? (
              <span className="text-rose-200/80">{error}</span>
            ) : (
              <span className="truncate block">
                Tx: {sig?.slice(0, 8)}…{sig?.slice(-6)}
              </span>
            )}
          </div>
          {sig && (
            <Link
              href={explorerUrl(sig)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-white/70 hover:text-white/90 hover:bg-white/10 transition"
            >
              View <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── MAIN ───────── */

export default function BundlesPanel({ ownerBase58 }: Props) {
  // Privy & Wallet
  const { authenticated, ready: privyReady } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();

  // Balance
  const balanceCtx = useBalance();
  const ctxLoading = !!balanceCtx?.loading;
  const ctxUsdcDisplay = safeNum(balanceCtx?.usdcUsd, 0);
  const displayCurrency = (balanceCtx?.displayCurrency || "USD").toUpperCase();
  const fxRate = safeNum(balanceCtx?.fxRate, 1); // display per USD

  // Modal state
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [modalKind, setModalKind] = useState<ModalKind>("input");

  // Bundle selection
  const [selectedId, setSelectedId] = useState<string>(BUNDLES[0]?.id ?? "");
  const selected = useMemo(
    () => BUNDLES.find((b) => b.id === selectedId) ?? BUNDLES[0],
    [selectedId]
  );

  // UI state
  const [amountRaw, setAmountRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<
    RiskLevel | "all"
  >("all");

  // Execution state
  const [rows, setRows] = useState<BuyRow[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "building" | "signing" | "sending" | "done" | "error"
  >("idle");
  const [globalError, setGlobalError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const isProcessing = modalKind === "processing";

  // Portal mount guard
  useEffect(() => setMounted(true), []);

  // Lock scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  // Warm Privy cache
  const cacheWarmedRef = useRef(false);
  useEffect(() => {
    if (!authenticated || !privyReady || cacheWarmedRef.current) return;

    const warmCache = async () => {
      const embeddedWallet = wallets.find(
        (w) => w.address === ownerBase58 && w.standardWallet?.name === "Privy"
      );
      if (!embeddedWallet) return;

      try {
        await signMessage({
          message: new TextEncoder().encode("warm"),
          wallet: embeddedWallet,
        });
        cacheWarmedRef.current = true;
      } catch {
        // ignore
      }
    };

    const t = setTimeout(warmCache, 600);
    return () => clearTimeout(t);
  }, [authenticated, privyReady, wallets, signMessage, ownerBase58]);

  // Derived
  const amountNum = useMemo(() => {
    const n = parseFloat(amountRaw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountRaw]);

  const filteredBundles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return BUNDLES.filter((bundle) => {
      const matchesSearch =
        q === "" ||
        bundle.name.toLowerCase().includes(q) ||
        bundle.subtitle.toLowerCase().includes(q) ||
        bundle.symbols.some((s) => s.toLowerCase().includes(q));
      const matchesRisk =
        selectedRiskFilter === "all" || bundle.risk === selectedRiskFilter;
      return matchesSearch && matchesRisk;
    });
  }, [searchQuery, selectedRiskFilter]);

  const ownerReady = !!ownerBase58 && ownerBase58 !== "pending";

  const canSubmit = useMemo(() => {
    if (!ownerReady || ctxLoading) return false;
    if (!selected) return false;
    if (amountNum <= 0) return false;
    if (amountNum > ctxUsdcDisplay) return false;
    if ((selected.symbols?.length ?? 0) < 2) return false;
    return true;
  }, [ownerReady, ctxLoading, selected, amountNum, ctxUsdcDisplay]);

  const progress = useMemo(() => {
    if (phase === "building") return 20;
    if (phase === "signing") return 45;
    if (phase === "sending") return 70;
    if (phase === "done") return 100;
    if (phase === "error") return 0;
    return 0;
  }, [phase]);

  const stage = useMemo(() => {
    if (phase === "building")
      return {
        title: "Preparing bundle",
        subtitle: "Building transactions…",
        icon: "spinner" as const,
      };
    if (phase === "signing")
      return {
        title: "Approving swaps",
        subtitle: "Confirm in your wallet…",
        icon: "wallet" as const,
      };
    if (phase === "sending")
      return {
        title: "Submitting",
        subtitle: "Broadcasting to network…",
        icon: "spinner" as const,
      };
    if (phase === "done")
      return {
        title: "Bundle complete!",
        subtitle: "Your purchases are finalized",
        icon: "success" as const,
      };
    if (phase === "error")
      return {
        title: "Bundle failed",
        subtitle: "Something went wrong",
        icon: "error" as const,
      };
    return { title: "", subtitle: "", icon: "spinner" as const };
  }, [phase]);

  const allDone = rows.length > 0 && rows.every((r) => r.status === "done");
  const hasErrors = rows.some((r) => r.status === "error");

  // Sign helper
  const signWithWallet = useCallback(
    async (txBytes: Uint8Array): Promise<string> => {
      const wallet = pickWallet(wallets, ownerBase58);
      if (!wallet) throw new Error("Wallet not connected");

      const { signedTransaction } = await signTransaction({
        transaction: txBytes,
        wallet,
      });

      return Buffer.from(signedTransaction).toString("base64");
    },
    [wallets, ownerBase58, signTransaction]
  );

  // Phase 1: build (parallel)
  const buildAll = useCallback(
    async (rowsData: BuyRow[]) => {
      setPhase("building");
      setRows(
        rowsData.map((r) => ({ ...r, status: "building" as SwapStatus }))
      );

      const built = await Promise.all(
        rowsData.map(async (row) => {
          try {
            const amountUnits = Math.max(
              1,
              Math.floor(row.amountUsd * 10 ** USDC_DECIMALS)
            );
            const buildResp = await postJSON<BuildResponse>("/api/jup/build", {
              fromOwnerBase58: ownerBase58,
              inputMint: USDC_MINT,
              outputMint: row.outputMint,
              amountUnits,
              slippageBps: 100,
            });
            return {
              ...row,
              txBase64: buildResp.transaction,
              status: "building" as SwapStatus,
            };
          } catch (e) {
            return {
              ...row,
              status: "error" as SwapStatus,
              error: String((e as Error)?.message),
            };
          }
        })
      );

      setRows(built);
      return built;
    },
    [ownerBase58]
  );

  // Phase 2: sign (sequential)
  const signAll = useCallback(
    async (rowsData: BuyRow[]) => {
      setPhase("signing");

      const signedRows = [...rowsData];
      setRows(
        signedRows.map((r) =>
          r.txBase64 && r.status !== "error"
            ? { ...r, status: "signing" as SwapStatus }
            : r
        )
      );

      for (let i = 0; i < signedRows.length; i++) {
        if (abortRef.current) break;

        const row = signedRows[i];
        if (!row.txBase64 || row.status === "error") continue;

        try {
          const txBytes = Buffer.from(row.txBase64, "base64");
          const signedB64 = await signWithWallet(txBytes);

          signedRows[i] = {
            ...row,
            signedTxBase64: signedB64,
            status: "signing" as SwapStatus,
          };
          setRows([...signedRows]);
        } catch (e) {
          if (isUserRejection(e)) {
            abortRef.current = true;
            signedRows[i] = { ...row, status: "error", error: "Cancelled" };
            for (let j = i + 1; j < signedRows.length; j++) {
              if (signedRows[j].status !== "error")
                signedRows[j] = {
                  ...signedRows[j],
                  status: "error",
                  error: "Cancelled",
                };
            }
            setRows([...signedRows]);
            return signedRows;
          }
          signedRows[i] = {
            ...row,
            status: "error",
            error: String((e as Error)?.message),
          };
          setRows([...signedRows]);
        }
      }

      return signedRows;
    },
    [signWithWallet]
  );

  // Phase 3: send (limited concurrency)
  const sendAll = useCallback(async (rowsData: BuyRow[]) => {
    setPhase("sending");

    setRows(
      rowsData.map((r) =>
        r.signedTxBase64 && r.status !== "error"
          ? { ...r, status: "sending" as SwapStatus }
          : r
      )
    );

    const sent = await asyncPool(
      SEND_CONCURRENCY,
      rowsData,
      async (row) => {
        if (abortRef.current)
          return { ...row, status: "error" as SwapStatus, error: "Cancelled" };
        if (!row.signedTxBase64 || row.status === "error") return row;

        try {
          const sendResp = await postJSON<SendResponse>("/api/jup/send", {
            transaction: row.signedTxBase64,
          });

          return {
            ...row,
            status: "done" as SwapStatus,
            sig: sendResp.signature,
          };
        } catch (e) {
          return {
            ...row,
            status: "error" as SwapStatus,
            error: String((e as Error)?.message),
          };
        }
      },
      abortRef
    );

    setRows(sent);
    return sent;
  }, []);

  // Start bundle
  const onBuyBundle = useCallback(async () => {
    if (!canSubmit || !selected) return;

    abortRef.current = false;
    setGlobalError(null);
    setModalKind("processing");
    setPhase("idle");

    const symbols = selected.symbols;
    const perUsd = amountNum / fxRate / symbols.length; // USD = display / fxRate
    const perDisplay = amountNum / symbols.length;

    const initialRows: BuyRow[] = symbols.map((symbol) => ({
      symbol,
      outputMint: requireMintBySymbol(symbol),
      status: "idle",
      amountDisplay: perDisplay,
      amountUsd: perUsd,
    }));

    setRows(initialRows);

    try {
      const built = await buildAll(initialRows);
      if (abortRef.current) throw new Error("Cancelled");

      const builtOk = built.filter((r) => r.txBase64 && r.status !== "error");
      if (builtOk.length === 0)
        throw new Error("Failed to prepare swaps. Try a larger amount.");

      const signed = await signAll(built);
      if (abortRef.current) throw new Error("Cancelled");

      const signedOk = signed.filter(
        (r) => r.signedTxBase64 && r.status !== "error"
      );
      if (signedOk.length === 0) throw new Error("No swaps were approved.");

      const sent = await sendAll(signed);

      const ok = sent.filter((r) => r.status === "done").length;
      if (ok === 0) throw new Error("No swaps succeeded. Try again.");

      setPhase("done");
      setModalKind("success");
    } catch (e) {
      const msg = String((e as Error)?.message || "Bundle failed");
      setGlobalError(msg);
      setPhase("error");
      setModalKind("error");
    }
  }, [canSubmit, selected, amountNum, fxRate, buildAll, signAll, sendAll]);

  // Retry failed
  const retryFailed = useCallback(async () => {
    if (!selected) return;
    const failed = rows.filter(
      (r) => r.status === "error" && r.error !== "Cancelled"
    );
    if (failed.length === 0) return;

    abortRef.current = false;
    setModalKind("processing");
    setPhase("idle");
    setGlobalError(null);

    const retryRows = failed.map((r) => ({
      ...r,
      status: "idle" as SwapStatus,
      error: undefined,
      txBase64: undefined,
      signedTxBase64: undefined,
      sig: undefined,
    }));

    // merge back into the full rows list as updates happen
    const merge = (updated: BuyRow[]) => {
      const map = new Map(updated.map((u) => [u.symbol, u]));
      setRows((prev) => prev.map((p) => map.get(p.symbol) ?? p));
    };

    merge(retryRows);

    try {
      const built = await buildAll(retryRows);
      const signed = await signAll(built);
      const sent = await sendAll(signed);
      merge(sent);

      const ok = sent.filter((r) => r.status === "done").length;
      if (ok === 0) throw new Error("Retry failed. Try again.");

      setPhase("done");
      setModalKind("success");
    } catch (e) {
      const msg = String((e as Error)?.message || "Retry failed");
      setGlobalError(msg);
      setPhase("error");
      setModalKind("error");
    }
  }, [rows, selected, buildAll, signAll, sendAll]);

  // Open/close modal (DepositFlex behavior)
  const openBundle = useCallback((id: string) => {
    setSelectedId(id);
    setAmountRaw("");
    setRows([]);
    setPhase("idle");
    setGlobalError(null);
    setModalKind("input");
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    // don’t allow close while processing (same as DepositFlex)
    if (modalKind === "processing") return;
    setOpen(false);
  }, [modalKind]);

  // outside click close (only if not processing)
  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && modalKind !== "processing") {
        setOpen(false);
      }
    },
    [modalKind]
  );

  /* ───────── MAIN PAGE UI (grid) ───────── */

  return (
    <>
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 backdrop-blur-sm">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-400/20">
            <Layers className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Token Bundles</h3>
            <p className="text-sm text-white/50">
              Diversify your portfolio with one tap
            </p>
          </div>
        </div>

        <div className="relative mb-5">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bundles or tokens..."
            className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-white/40 outline-none transition-all focus:border-emerald-300/30 focus:bg-white/[0.05] focus:ring-1 focus:ring-emerald-400/20"
          />
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          {(["all", "low", "medium", "high", "degen"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setSelectedRiskFilter(risk)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold capitalize transition-all ${
                selectedRiskFilter === risk
                  ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-300/30"
                  : "bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70"
              }`}
            >
              {risk === "all" ? "All Bundles" : risk}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBundles.length === 0 ? (
            <div className="col-span-full py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.03]">
                <Search className="h-5 w-5 text-white/30" />
              </div>
              <p className="text-sm text-white/40">No bundles found</p>
            </div>
          ) : (
            filteredBundles.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => openBundle(b.id)}
                className="group relative flex flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-5 text-left transition-all duration-300 hover:border-emerald-300/30 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-emerald-500/5"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex -space-x-3">
                    {b.symbols.slice(0, 5).map((s) => {
                      const meta = findTokenBySymbol(s);
                      return (
                        <div
                          key={s}
                          className="relative h-9 w-9 overflow-hidden rounded-full border-2 border-[#02010a] bg-zinc-800 ring-1 ring-white/10"
                          title={s}
                        >
                          <Image
                            src={meta?.logo || "/placeholder.svg"}
                            alt={s}
                            fill
                            className="object-cover"
                          />
                        </div>
                      );
                    })}
                  </div>
                  {riskPill(b.risk)}
                </div>

                <div className="flex-1">
                  <h4 className="text-base font-semibold text-white mb-1 group-hover:text-emerald-300 transition-colors">
                    {b.name}
                  </h4>
                  <p className="text-xs text-white/50 mb-3 line-clamp-2">
                    {b.subtitle}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <span className="text-xs text-white/40">
                    {b.symbols.length} assets
                  </span>
                  <div className="flex items-center gap-1 text-xs font-medium text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Invest</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ───────── MODAL (DepositFlex theme) ───────── */}
      {open && mounted
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
              onClick={onBackdropClick}
            >
              <div
                className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-emerald-400" />
                      <div className="text-sm font-semibold text-white/90 truncate">
                        {selected?.name ?? "Bundle"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-white/45">
                      {selected?.symbols.length ?? 0} assets •{" "}
                      <span className="capitalize">{selected?.risk}</span> risk
                    </div>
                  </div>

                  <button
                    onClick={close}
                    disabled={modalKind === "processing"}
                    className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/50 hover:text-white/90 transition disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* INPUT VIEW */}
                {modalKind === "input" && (
                  <>
                    <div className="mt-4">
                      <label className="text-xs text-white/50">Amount</label>
                      <div className="mt-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
                        <span className="text-xs text-white/50 px-2">
                          {displayCurrency}
                        </span>
                        <input
                          value={amountRaw}
                          onChange={(e) =>
                            setAmountRaw(clampMoneyInput(e.target.value))
                          }
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-full bg-transparent text-sm text-white/90 outline-none"
                        />
                        <button
                          type="button"
                          disabled={ctxLoading}
                          onClick={() =>
                            setAmountRaw(ctxUsdcDisplay.toFixed(2))
                          }
                          className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white/90 disabled:opacity-60"
                        >
                          Max
                        </button>
                      </div>

                      {!ownerReady && (
                        <div className="mt-2 text-xs text-rose-200/80">
                          Wallet not connected.
                        </div>
                      )}
                      {!ctxLoading &&
                        amountNum > ctxUsdcDisplay &&
                        amountNum > 0 && (
                          <div className="mt-2 text-xs text-rose-200/80">
                            Amount exceeds available balance.
                          </div>
                        )}
                    </div>

                    {/* Summary */}
                    {amountNum > 0 && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] text-white/45">
                            You invest
                          </div>
                          <div className="text-sm font-semibold text-white/85">
                            {formatMoney(amountNum, displayCurrency)}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="text-[11px] text-white/45">
                            Allocations
                          </div>
                          <div className="text-sm font-semibold text-emerald-300">
                            Equal weight
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Allocation Preview */}
                    {amountNum > 0 && (
                      <div className="mt-4 space-y-2 max-h-[240px] overflow-y-auto pr-1">
                        {(selected?.symbols ?? []).map((s) => {
                          const per =
                            amountNum / (selected?.symbols.length || 1);
                          return (
                            <TokenRowCompact
                              key={s}
                              symbol={s}
                              amountLabel={`${formatMoney(per, displayCurrency)}`}
                              status="idle"
                            />
                          );
                        })}
                      </div>
                    )}

                    <button
                      disabled={!canSubmit}
                      onClick={onBuyBundle}
                      className={[
                        "mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 border",
                        canSubmit
                          ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25 active:scale-[0.98]"
                          : "bg-white/5 border-white/10 text-white/35 cursor-not-allowed",
                      ].join(" ")}
                    >
                      Invest
                      <ArrowRight className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={close}
                      className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/60 hover:text-white/80 hover:bg-white/10 transition"
                    >
                      Cancel
                    </button>
                  </>
                )}

                {/* PROCESSING / SUCCESS / ERROR VIEW */}
                {modalKind !== "input" && (
                  <>
                    <div className="flex flex-col items-center text-center pt-4">
                      <StageIcon icon={stage.icon} />
                      <div className="mt-4">
                        <div className="text-base font-semibold text-white/90">
                          {stage.title}
                        </div>
                        <div className="mt-1 text-sm text-white/50">
                          {stage.subtitle}
                        </div>
                      </div>

                      <div className="mt-5 w-full max-w-[220px]">
                        <ProgressBar progress={progress} />
                      </div>
                    </div>

                    {/* Per-token status list */}
                    {rows.length > 0 && (
                      <div className="mt-5 space-y-2 max-h-[260px] overflow-y-auto pr-1">
                        {rows.map((r) => (
                          <TokenRowCompact
                            key={r.symbol}
                            symbol={r.symbol}
                            amountLabel={`${formatMoney(r.amountDisplay, displayCurrency)}`}
                            status={r.status}
                            sig={r.sig}
                            error={r.error}
                          />
                        ))}
                      </div>
                    )}

                    {/* Error message */}
                    {modalKind === "error" && globalError && (
                      <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3">
                        <div className="text-xs text-rose-200/80 text-center">
                          {globalError}
                        </div>
                      </div>
                    )}

                    {/* Retry failed */}
                    {modalKind === "error" && hasErrors && (
                      <button
                        onClick={retryFailed}
                        className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border bg-white/10 border-white/10 text-white/80 hover:bg-white/15 flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Retry failed
                      </button>
                    )}

                    {/* Success helper */}
                    {modalKind === "success" && allDone && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div className="text-xs text-white/50 text-center">
                          Your bundle is complete.
                        </div>
                      </div>
                    )}

                    {/* Done / Close + View Assets */}
                    {modalKind !== "processing" && (
                      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Close / Done */}
                        <button
                          onClick={close}
                          className={[
                            "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border",
                            modalKind === "success"
                              ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25"
                              : "bg-white/10 border-white/10 text-white/80 hover:bg-white/15",
                          ].join(" ")}
                        >
                          {modalKind === "success" ? "Done" : "Close"}
                        </button>

                        {/* View Assets */}
                        <Link
                          href="/invest"
                          className="w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border
                 bg-white/5 border-white/10 text-white/70
                 hover:bg-white/10 hover:text-white
                 flex items-center justify-center gap-2"
                        >
                          View assets
                          <ArrowRight className="h-4 w-4 opacity-70" />
                        </Link>
                      </div>
                    )}

                    {/* Processing footer */}
                    {modalKind === "processing" && (
                      <div className="mt-6 text-center text-xs text-white/30">
                        Please keep window open
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
