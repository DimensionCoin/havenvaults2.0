// components/bundles/BundlesPanel.tsx
"use client";

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import Image from "next/image";
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
  AlertTriangle,
  ChevronRight,
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

// Polyfill
if (typeof window !== "undefined") window.Buffer = window.Buffer || Buffer;

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function getRiskIcon(risk: RiskLevel) {
  if (risk === "low") return Shield;
  if (risk === "medium") return TrendingUp;
  if (risk === "high") return Zap;
  return Sparkles;
}

function riskPill(risk: RiskLevel) {
  const Icon = getRiskIcon(risk);
  const colors = {
    low: "border-[#3ff387]/30 bg-[#3ff387]/10 text-[#3ff387]",
    medium: "border-amber-400/30 bg-amber-400/10 text-amber-400",
    high: "border-orange-400/30 bg-orange-400/10 text-orange-400",
    degen: "border-red-400/30 bg-red-400/10 text-red-400",
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

function cleanNumberInput(raw: string) {
  const s = raw.replace(/[^\d.]/g, "");
  const parts = s.split(".");
  if (parts.length <= 1) return s;
  return `${parts[0]}.${parts.slice(1).join("")}`;
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
      d?.userMessage ||
      d?.error ||
      d?.message ||
      `Request failed: ${res.status}`;
    throw new Error(String(msg));
  }

  return data as T;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOKEN ICONS COMPONENT - Enhanced with larger icons and glow effect
   ═══════════════════════════════════════════════════════════════════════════ */

function TokenIconsCompact({ symbols }: { symbols: string[] }) {
  const shown = symbols.slice(0, 5);
  const extra = Math.max(0, symbols.length - shown.length);

  return (
    <div className="flex items-center">
      <div className="flex -space-x-3">
        {shown.map((s, i) => {
          const meta = findTokenBySymbol(s);
          return (
            <div
              key={s}
              className="relative h-9 w-9 overflow-hidden rounded-full border-2 border-[#02010a] bg-zinc-800 ring-1 ring-white/10 transition-transform hover:scale-110 hover:z-10"
              style={{ zIndex: shown.length - i }}
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
      {extra > 0 && (
        <div className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#02010a] bg-zinc-800/80 ring-1 ring-white/10">
          <span className="text-[11px] font-bold text-white/70">+{extra}</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function BundlesPanel({ ownerBase58 }: Props) {
  // ─────────────────────────────────────────────────────────────────────────
  // Privy & Wallet
  // ─────────────────────────────────────────────────────────────────────────
  const { authenticated, ready: privyReady } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();

  // ─────────────────────────────────────────────────────────────────────────
  // Balance
  // ─────────────────────────────────────────────────────────────────────────
  const { usdcUsd, displayCurrency, fxRate } = useBalance();
  const availableBalance = usdcUsd;

  // ─────────────────────────────────────────────────────────────────────────
  // UI State
  // ─────────────────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(BUNDLES[0]?.id ?? "");
  const [amountDisplay, setAmountDisplay] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<
    RiskLevel | "all"
  >("all");

  // ─────────────────────────────────────────────────────────────────────────
  // Execution State
  // ─────────────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<BuyRow[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "building" | "signing" | "sending" | "done"
  >("idle");
  const [globalError, setGlobalError] = useState<string | null>(null);
  const abortRef = useRef(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Privy Cache Warming
  // ─────────────────────────────────────────────────────────────────────────
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
        console.log("[Privy] Cache warmed ✓");
      } catch {
        // user might reject
      }
    };

    const t = setTimeout(warmCache, 800);
    return () => clearTimeout(t);
  }, [authenticated, privyReady, wallets, signMessage, ownerBase58]);

  // ─────────────────────────────────────────────────────────────────────────
  // Computed Values
  // ─────────────────────────────────────────────────────────────────────────
  const selected = useMemo(
    () => BUNDLES.find((b) => b.id === selectedId) ?? BUNDLES[0],
    [selectedId]
  );

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

  const perTokenDisplay = useMemo(() => {
    const amt = Number(amountDisplay);
    const n = selected?.symbols.length ?? 0;
    if (!Number.isFinite(amt) || amt <= 0 || n <= 0) return 0;
    return amt / n;
  }, [amountDisplay, selected]);

  const canBuy = useMemo(() => {
    const amt = Number(amountDisplay);
    if (!ownerBase58) return false;
    if (!selected) return false;
    if (!Number.isFinite(amt) || amt <= 0) return false;
    if (amt > availableBalance) return false;
    if ((selected.symbols?.length ?? 0) < 2) return false;
    return true;
  }, [amountDisplay, ownerBase58, selected, availableBalance]);

  const progress = useMemo(() => {
    if (rows.length === 0) return 0;
    const doneCount = rows.filter((r) => r.status === "done").length;
    return (doneCount / rows.length) * 100;
  }, [rows]);

  const allDone = rows.length > 0 && rows.every((r) => r.status === "done");
  const hasErrors = rows.some((r) => r.status === "error");
  const isExecuting = phase !== "idle" && phase !== "done";

  // ─────────────────────────────────────────────────────────────────────────
  // Sign Helper
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 1: Build all transactions in parallel
  // ─────────────────────────────────────────────────────────────────────────
  const buildAllTransactions = useCallback(
    async (rowsData: BuyRow[]): Promise<BuyRow[]> => {
      setPhase("building");

      setRows(rowsData.map((r) => ({ ...r, status: "building" })));

      const buildPromises = rowsData.map(async (row) => {
        try {
          const amountUnits = Math.floor(row.amountUsd * 10 ** USDC_DECIMALS);

          const buildResp = await postJSON<BuildResponse>("/api/jup/build", {
            fromOwnerBase58: ownerBase58,
            inputMint: USDC_MINT,
            outputMint: row.outputMint,
            amountUnits,
            slippageBps: 100,
          });

          return { ...row, txBase64: buildResp.transaction };
        } catch (e) {
          return {
            ...row,
            status: "error" as SwapStatus,
            error: String((e as Error)?.message),
          };
        }
      });

      const results = await Promise.all(buildPromises);
      setRows(results);

      return results;
    },
    [ownerBase58]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 2: Sign all transactions
  // ─────────────────────────────────────────────────────────────────────────
  const signAllTransactions = useCallback(
    async (rowsData: BuyRow[]): Promise<BuyRow[]> => {
      setPhase("signing");

      const toSign = rowsData.filter((r) => r.txBase64 && r.status !== "error");

      if (toSign.length === 0) {
        return rowsData;
      }

      setRows(
        rowsData.map((r) =>
          r.txBase64 && r.status !== "error" ? { ...r, status: "signing" } : r
        )
      );

      const signedRows = [...rowsData];

      for (let i = 0; i < signedRows.length; i++) {
        const row = signedRows[i];
        if (!row.txBase64 || row.status === "error") continue;

        if (abortRef.current) {
          signedRows[i] = { ...row, status: "error", error: "Cancelled" };
          continue;
        }

        try {
          const txBytes = Buffer.from(row.txBase64, "base64");
          const signedB64 = await signWithWallet(txBytes);
          signedRows[i] = {
            ...row,
            signedTxBase64: signedB64,
            status: "signing",
          };

          setRows([...signedRows]);
        } catch (e) {
          if (isUserRejection(e)) {
            abortRef.current = true;
            signedRows[i] = { ...row, status: "error", error: "Cancelled" };
            for (let j = i + 1; j < signedRows.length; j++) {
              if (signedRows[j].status !== "error") {
                signedRows[j] = {
                  ...signedRows[j],
                  status: "error",
                  error: "Cancelled",
                };
              }
            }
            break;
          }
          signedRows[i] = {
            ...row,
            status: "error",
            error: String((e as Error)?.message),
          };
        }
      }

      setRows(signedRows);
      return signedRows;
    },
    [signWithWallet]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 3: Send all signed transactions in parallel
  // ─────────────────────────────────────────────────────────────────────────
  const sendAllTransactions = useCallback(
    async (rowsData: BuyRow[]): Promise<BuyRow[]> => {
      setPhase("sending");

      const toSend = rowsData.filter(
        (r) => r.signedTxBase64 && r.status !== "error"
      );

      if (toSend.length === 0) {
        return rowsData;
      }

      setRows(
        rowsData.map((r) =>
          r.signedTxBase64 && r.status !== "error"
            ? { ...r, status: "sending" }
            : r
        )
      );

      const sendPromises = rowsData.map(async (row) => {
        if (!row.signedTxBase64 || row.status === "error") {
          return row;
        }

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
      });

      const results = await Promise.all(sendPromises);
      setRows(results);

      return results;
    },
    []
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Main Execution Flow
  // ─────────────────────────────────────────────────────────────────────────
  const startBundleBuy = useCallback(async () => {
    if (!canBuy || !selected || isExecuting) return;

    const amt = Number(amountDisplay);
    const symbols = selected.symbols;
    const perUsd = amt / fxRate / symbols.length;
    const perDisplay = amt / symbols.length;

    abortRef.current = false;
    setGlobalError(null);

    const initialRows: BuyRow[] = symbols.map((symbol) => ({
      symbol,
      outputMint: requireMintBySymbol(symbol),
      status: "idle",
      amountDisplay: perDisplay,
      amountUsd: perUsd,
    }));

    setRows(initialRows);

    try {
      console.log("[Bundle] Phase 1: Building transactions...");
      const builtRows = await buildAllTransactions(initialRows);

      if (abortRef.current) return;

      const buildErrors = builtRows.filter((r) => r.status === "error");
      if (buildErrors.length === builtRows.length) {
        setGlobalError("Failed to build transactions");
        setPhase("idle");
        return;
      }

      console.log("[Bundle] Phase 2: Signing transactions...");
      const signedRows = await signAllTransactions(builtRows);

      if (abortRef.current) return;

      const signErrors = signedRows.filter((r) => r.status === "error");
      if (signErrors.length === signedRows.length) {
        setPhase("idle");
        return;
      }

      console.log("[Bundle] Phase 3: Sending transactions...");
      const sentRows = await sendAllTransactions(signedRows);

      const successCount = sentRows.filter((r) => r.status === "done").length;
      console.log(
        `[Bundle] Complete: ${successCount}/${sentRows.length} succeeded`
      );

      setPhase("done");
    } catch (e) {
      console.error("[Bundle] Error:", e);
      setGlobalError(String((e as Error)?.message));
      setPhase("idle");
    }
  }, [
    canBuy,
    selected,
    amountDisplay,
    fxRate,
    isExecuting,
    buildAllTransactions,
    signAllTransactions,
    sendAllTransactions,
  ]);

  // ─────────────────────────────────────────────────────────────────────────
  // Retry Failed
  // ─────────────────────────────────────────────────────────────────────────
  const retryFailed = useCallback(async () => {
    if (isExecuting) return;

    const failedRows = rows.filter(
      (r) => r.status === "error" && r.error !== "Cancelled"
    );
    if (failedRows.length === 0) return;

    abortRef.current = false;

    const resetRows = rows.map((r) =>
      r.status === "error" && r.error !== "Cancelled"
        ? {
            ...r,
            status: "idle" as SwapStatus,
            error: undefined,
            txBase64: undefined,
            signedTxBase64: undefined,
          }
        : r
    );
    setRows(resetRows);

    try {
      const toRetry = resetRows.filter((r) => r.status === "idle");
      console.log(`[Bundle] Retrying ${toRetry.length} failed transactions...`);

      const builtRows = await buildAllTransactions(resetRows);
      if (abortRef.current) return;

      const signedRows = await signAllTransactions(builtRows);
      if (abortRef.current) return;

      await sendAllTransactions(signedRows);
      setPhase("done");
    } catch (e) {
      console.error("[Bundle] Retry error:", e);
      setGlobalError(String((e as Error)?.message));
      setPhase("idle");
    }
  }, [
    rows,
    isExecuting,
    buildAllTransactions,
    signAllTransactions,
    sendAllTransactions,
  ]);

  // ─────────────────────────────────────────────────────────────────────────
  // Modal Controls
  // ─────────────────────────────────────────────────────────────────────────
  const openBundle = useCallback((id: string) => {
    setSelectedId(id);
    setRows([]);
    setPhase("idle");
    setGlobalError(null);
    setAmountDisplay("");
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (isExecuting) {
      abortRef.current = true;
    }
    setOpen(false);
  }, [isExecuting]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) closeModal();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, closeModal]);

  // ─────────────────────────────────────────────────────────────────────────
  // Status Label
  // ─────────────────────────────────────────────────────────────────────────
  const phaseLabel = useMemo(() => {
    switch (phase) {
      case "building":
        return "Preparing transactions...";
      case "signing":
        return "Sign to confirm...";
      case "sending":
        return "Sending transactions...";
      default:
        return "Processing...";
    }
  }, [phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER - Complete UI overhaul for futuristic, user-friendly design
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Main Panel */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3ff387]/20 to-[#3ff387]/5 ring-1 ring-[#3ff387]/20">
            <Sparkles className="h-5 w-5 text-[#3ff387]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Token Bundles</h3>
            <p className="text-sm text-white/50">
              Diversify your portfolio with one tap
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bundles or tokens..."
            className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-white/40 outline-none transition-all focus:border-[#3ff387]/30 focus:bg-white/[0.05] focus:ring-1 focus:ring-[#3ff387]/20"
          />
        </div>

        {/* Risk Filter */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          {(["all", "low", "medium", "high", "degen"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setSelectedRiskFilter(risk)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold capitalize transition-all ${
                selectedRiskFilter === risk
                  ? "bg-[#3ff387]/20 text-[#3ff387] ring-1 ring-[#3ff387]/30"
                  : "bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70"
              }`}
            >
              {risk === "all" ? "All Bundles" : risk}
            </button>
          ))}
        </div>

        {/* Bundle Grid - 2 columns on md, 1 on mobile, wider cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredBundles.length === 0 ? (
            <div className="col-span-full py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.03]">
                <Search className="h-5 w-5 text-white/30" />
              </div>
              <p className="text-sm text-white/40">No bundles found</p>
            </div>
          ) : (
            filteredBundles.map((b) => {
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => openBundle(b.id)}
                  className="group relative flex flex-col rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-5 text-left transition-all duration-300 hover:border-[#3ff387]/30 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-[#3ff387]/5"
                >
                  {/* Top row: Icons + Risk */}
                  <div className="flex items-start justify-between mb-4">
                    <TokenIconsCompact symbols={b.symbols} />
                    {riskPill(b.risk)}
                  </div>

                  {/* Bundle info */}
                  <div className="flex-1">
                    <h4 className="text-base font-semibold text-white mb-1 group-hover:text-[#3ff387] transition-colors">
                      {b.name}
                    </h4>
                    <p className="text-xs text-white/50 mb-3 line-clamp-2">
                      {b.subtitle}
                    </p>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <span className="text-xs text-white/40">
                      {b.symbols.length} assets
                    </span>
                    <div className="flex items-center gap-1 text-xs font-medium text-[#3ff387] opacity-0 group-hover:opacity-100 transition-opacity">
                      <span>Invest</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={closeModal}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-[#02010a]/90 backdrop-blur-md" />

          {/* Modal Content */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900 to-[#02010a] shadow-2xl shadow-black/50"
          >
            {/* Progress Bar */}
            {rows.length > 0 && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-white/5 rounded-t-3xl overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#3ff387] to-[#3ff387]/70 transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-zinc-900/95 backdrop-blur-sm px-6 py-5">
              <div className="flex items-center gap-4">
                {selected && (
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3ff387]/20 to-[#3ff387]/5 ring-1 ring-[#3ff387]/20">
                    {React.createElement(getRiskIcon(selected.risk), {
                      className: "h-5 w-5 text-[#3ff387]",
                    })}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {selected?.name ?? "Bundle"}
                  </h2>
                  <p className="text-sm text-white/50">
                    {selected?.symbols.length} assets •{" "}
                    <span className="capitalize">{selected?.risk}</span> risk
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/60 transition-all hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5">
              {/* Amount Input - Only show before execution */}
              {phase === "idle" && rows.length === 0 && (
                <>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <label className="text-xs font-medium text-white/50 mb-3 block uppercase tracking-wider">
                      Investment Amount
                    </label>

                    <div className="flex items-center gap-3">
                      <span className="text-lg font-medium text-white/60">
                        {displayCurrency}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amountDisplay}
                        onChange={(e) =>
                          setAmountDisplay(cleanNumberInput(e.target.value))
                        }
                        placeholder="0.00"
                        className="flex-1 bg-transparent text-3xl font-bold text-white outline-none placeholder:text-white/20"
                      />
                    </div>

                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-white/40">Available Balance</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAmountDisplay(availableBalance.toFixed(2))
                        }
                        className="font-medium text-[#3ff387] hover:text-[#3ff387]/80 transition-colors"
                      >
                        {availableBalance.toFixed(2)} {displayCurrency}
                      </button>
                    </div>
                  </div>

                  {/* Distribution Preview */}
                  {perTokenDisplay > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs font-medium text-white/50 uppercase tracking-wider">
                          Distribution Preview
                        </span>
                        <span className="text-xs text-[#3ff387]/80 bg-[#3ff387]/10 px-2 py-1 rounded-full">
                          Equal weight
                        </span>
                      </div>

                      <div className="space-y-3">
                        {(selected?.symbols ?? []).map((s) => {
                          const meta = findTokenBySymbol(s);
                          return (
                            <div
                              key={s}
                              className="flex items-center justify-between py-2 px-3 rounded-xl bg-white/[0.02] border border-white/5"
                            >
                              <div className="flex items-center gap-3">
                                <div className="relative h-8 w-8 rounded-full overflow-hidden bg-zinc-800 ring-1 ring-white/10">
                                  <Image
                                    src={meta?.logo || "/placeholder.svg"}
                                    alt={s}
                                    fill
                                    className="object-cover"
                                  />
                                </div>
                                <span className="text-sm font-medium text-white">
                                  {s}
                                </span>
                              </div>
                              <span className="text-sm font-medium text-white/70">
                                {perTokenDisplay.toFixed(2)} {displayCurrency}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Execution Status */}
              {rows.length > 0 && (
                <div className="space-y-3">
                  {/* Phase indicator */}
                  {isExecuting && (
                    <div className="flex items-center justify-center gap-3 py-4 px-4 rounded-2xl bg-[#3ff387]/5 border border-[#3ff387]/20">
                      <Loader2 className="h-5 w-5 animate-spin text-[#3ff387]" />
                      <span className="text-sm font-medium text-[#3ff387]">
                        {phaseLabel}
                      </span>
                    </div>
                  )}

                  {rows.map((r) => {
                    const meta = findTokenBySymbol(r.symbol);
                    const isDone = r.status === "done";
                    const isError = r.status === "error";
                    const isActive = [
                      "building",
                      "signing",
                      "sending",
                    ].includes(r.status);

                    return (
                      <div
                        key={r.symbol}
                        className={`flex items-center justify-between rounded-2xl border p-4 transition-all ${
                          isDone
                            ? "border-[#3ff387]/30 bg-[#3ff387]/5"
                            : isError
                              ? "border-red-500/30 bg-red-500/5"
                              : isActive
                                ? "border-[#3ff387]/20 bg-[#3ff387]/5"
                                : "border-white/10 bg-white/[0.02]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-10 rounded-full overflow-hidden bg-zinc-800 ring-1 ring-white/10">
                            <Image
                              src={meta?.logo || "/placeholder.svg"}
                              alt={r.symbol}
                              fill
                              className="object-cover"
                            />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {r.symbol}
                            </p>
                            <p className="text-xs text-white/50">
                              {r.amountDisplay.toFixed(2)} {displayCurrency}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isDone && (
                            <CheckCircle2 className="h-6 w-6 text-[#3ff387]" />
                          )}
                          {isError && (
                            <XCircle className="h-6 w-6 text-red-400" />
                          )}
                          {isActive && (
                            <Loader2 className="h-6 w-6 text-[#3ff387] animate-spin" />
                          )}
                          {r.status === "idle" && (
                            <div className="h-6 w-6 rounded-full border-2 border-white/20" />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Error Summary */}
                  {hasErrors && !isExecuting && (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
                      <div className="flex items-start gap-4">
                        <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-amber-200">
                            Some transactions failed
                          </p>
                          <button
                            type="button"
                            onClick={retryFailed}
                            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                          >
                            <RefreshCw className="h-4 w-4" />
                            Retry failed transactions
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Global Error */}
                  {globalError && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
                      <p className="text-sm text-red-300">{globalError}</p>
                    </div>
                  )}
                </div>
              )}

              {/* CTA Button */}
              <button
                type="button"
                onClick={allDone ? closeModal : startBundleBuy}
                disabled={(!canBuy && !allDone) || isExecuting}
                className={`w-full rounded-2xl py-4 text-base font-bold transition-all ${
                  allDone
                    ? "bg-[#3ff387] text-[#02010a] hover:bg-[#3ff387]/90 shadow-lg shadow-[#3ff387]/20"
                    : canBuy && !isExecuting
                      ? "bg-[#3ff387] text-[#02010a] hover:bg-[#3ff387]/90 shadow-lg shadow-[#3ff387]/20"
                      : "bg-white/5 text-white/30 cursor-not-allowed"
                }`}
              >
                {isExecuting ? (
                  <span className="flex items-center justify-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {phaseLabel}
                  </span>
                ) : allDone ? (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    Complete
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Purchase Bundle
                    <ArrowRight className="h-5 w-5" />
                  </span>
                )}
              </button>

              {/* Footer Note */}
              {phase === "idle" && rows.length === 0 && (
                <p className="text-center text-xs text-white/40">
                  All transactions execute in parallel for maximum speed
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
