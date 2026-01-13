// components/bundles/BundlesPanel.tsx
"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import Image from "next/image";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Shield,
  Zap,
  Search,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  Layers,
  PieChart,
  RotateCcw,
  Sliders,
  Lock,
  Unlock,
} from "lucide-react";

import {
  BUNDLES,
  type RiskLevel,
  type TokenAllocation,
  getBundleSymbols,
  normalizeWeights,
} from "./bundlesConfig";
import { findTokenBySymbol, requireMintBySymbol } from "@/lib/tokenConfig";
import { useBalance } from "@/providers/BalanceProvider";
import { useBundleSwap } from "@/hooks/useBundleSwap";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

type Props = {
  ownerBase58: string;
};

type EditableAllocation = TokenAllocation & {
  locked: boolean;
};

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

function getRiskIcon(risk: RiskLevel) {
  if (risk === "low") return Shield;
  if (risk === "medium") return TrendingUp;
  if (risk === "high") return Zap;
  return Sparkles;
}

function riskLabel(risk: RiskLevel) {
  if (risk === "low") return "Conservative";
  if (risk === "medium") return "Balanced";
  if (risk === "high") return "Aggressive";
  return "Speculative";
}

function cleanNumberInput(raw: string) {
  const s = raw.replace(/[^\d.]/g, "");
  const parts = s.split(".");
  if (parts.length <= 1) return s;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function formatMoney(n: number, currency: string) {
  const c = (currency || "USD").toUpperCase();
  const val = Number.isFinite(n) ? n : 0;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  } catch {
    return `$${val.toFixed(2)}`;
  }
}

// Redistribute weights when one changes, respecting locked allocations
function redistributeWeights(
  allocations: EditableAllocation[],
  changedIndex: number,
  newWeight: number
): EditableAllocation[] {
  const result = [...allocations];
  const clampedWeight = Math.max(0, Math.min(100, newWeight));

  // Set the new weight
  result[changedIndex] = { ...result[changedIndex], weight: clampedWeight };

  // Calculate how much we need to adjust
  const totalAfterChange = result.reduce((sum, a) => sum + a.weight, 0);
  const excess = totalAfterChange - 100;

  if (Math.abs(excess) < 0.01) return result;

  // Find unlocked items (excluding the changed one)
  const unlocked = result
    .map((a, i) => ({ ...a, index: i }))
    .filter((a, i) => !a.locked && i !== changedIndex);

  if (unlocked.length === 0) {
    // If all others are locked, just normalize
    return result.map((a) => ({
      ...a,
      weight: (a.weight / totalAfterChange) * 100,
    }));
  }

  // Distribute the excess proportionally among unlocked items
  const unlockedTotal = unlocked.reduce((sum, a) => sum + a.weight, 0);

  unlocked.forEach((item) => {
    const proportion =
      unlockedTotal > 0 ? item.weight / unlockedTotal : 1 / unlocked.length;
    const adjustment = excess * proportion;
    const newVal = Math.max(0, result[item.index].weight - adjustment);
    result[item.index] = { ...result[item.index], weight: newVal };
  });

  // Final normalization to ensure exactly 100%
  const finalTotal = result.reduce((sum, a) => sum + a.weight, 0);
  if (Math.abs(finalTotal - 100) > 0.01) {
    return result.map((a) => ({
      ...a,
      weight: (a.weight / finalTotal) * 100,
    }));
  }

  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLED COMPONENTS
═══════════════════════════════════════════════════════════════════════════ */

// Risk badge using Haven theme
function RiskBadge({ risk }: { risk: RiskLevel }) {
  const styles = {
    low: "bg-primary/10 text-primary border-primary/20",
    medium: "bg-accent text-accent-foreground border-border",
    high: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    degen: "bg-destructive/10 text-destructive border-destructive/20",
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold 
        uppercase tracking-wide border ${styles[risk]}
      `}
    >
      {risk}
    </span>
  );
}

// Token stack for bundle cards
function TokenStack({
  allocations,
  size = "md",
}: {
  allocations: TokenAllocation[];
  size?: "sm" | "md" | "lg";
}) {
  const shown = allocations.slice(0, 5);
  const extra = Math.max(0, allocations.length - shown.length);

  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((a, i) => {
          const meta = findTokenBySymbol(a.symbol);
          return (
            <div
              key={a.symbol}
              className={`
                relative ${sizeClasses[size]} overflow-hidden rounded-full 
                ring-2 ring-background bg-card
              `}
              style={{ zIndex: shown.length - i }}
              title={`${a.symbol} (${a.weight.toFixed(0)}%)`}
            >
              <Image
                src={meta?.logo || "/placeholder.svg"}
                alt={a.symbol}
                fill
                className="object-cover"
              />
            </div>
          );
        })}
      </div>
      {extra > 0 && (
        <span className="ml-2 text-xs font-medium text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}

// Weight editor row
function WeightEditorRow({
  allocation,
  index,
  totalAmount,
  currency,
  onWeightChange,
  onLockToggle,
  isEditing,
}: {
  allocation: EditableAllocation;
  index: number;
  totalAmount: number;
  currency: string;
  onWeightChange: (index: number, weight: number) => void;
  onLockToggle: (index: number) => void;
  isEditing: boolean;
}) {
  const meta = findTokenBySymbol(allocation.symbol);
  const amount = (totalAmount * allocation.weight) / 100;

  return (
    <div
      className={`
        flex items-center gap-3 py-3 px-3 rounded-xl transition-all duration-200
        ${isEditing ? "bg-secondary/50" : ""}
        border-b border-border last:border-0
      `}
    >
      {/* Token info */}
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-secondary ring-1 ring-border">
        <Image
          src={meta?.logo || "/placeholder.svg"}
          alt={allocation.symbol}
          fill
          className="object-cover"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium text-foreground truncate">
            {allocation.symbol}
          </p>
          <div className="flex items-center gap-2">
            {isEditing && (
              <button
                type="button"
                onClick={() => onLockToggle(index)}
                className={`
                  p-1 rounded-md transition-colors
                  ${
                    allocation.locked
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }
                `}
                title={allocation.locked ? "Unlock weight" : "Lock weight"}
              >
                {allocation.locked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <span className="text-sm font-semibold text-foreground tabular-nums w-12 text-right">
              {allocation.weight.toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Weight slider */}
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={allocation.weight}
              onChange={(e) => onWeightChange(index, Number(e.target.value))}
              disabled={allocation.locked}
              className={`
                flex-1 h-1.5 rounded-full appearance-none cursor-pointer
                bg-border accent-primary
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:w-4
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-primary
                [&::-webkit-slider-thumb]:shadow-sm
                [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:transition-transform
                [&::-webkit-slider-thumb]:hover:scale-110
                ${allocation.locked ? "opacity-50 cursor-not-allowed" : ""}
              `}
            />
            <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
              {formatMoney(amount, currency)}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/60 rounded-full transition-all duration-300"
                style={{ width: `${allocation.weight}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums ml-3">
              {formatMoney(amount, currency)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Execution step indicator
function ExecutionStep({
  item,
  isActive,
}: {
  item: { symbol: string; status: string; amountUsdcUnits: number };
  isActive: boolean;
}) {
  const meta = findTokenBySymbol(item.symbol);
  const isConfirmed = item.status === "confirmed";
  const isFailed = item.status === "failed";

  return (
    <div
      className={`
        flex items-center justify-between p-3 rounded-2xl transition-all duration-300
        ${
          isConfirmed
            ? "bg-primary/10 border border-primary/20"
            : isFailed
              ? "bg-destructive/10 border border-destructive/20"
              : isActive
                ? "bg-accent border border-primary/30"
                : "bg-secondary border border-border"
        }
      `}
    >
      <div className="flex items-center gap-3">
        <div
          className={`
          relative h-9 w-9 overflow-hidden rounded-full ring-2
          ${
            isConfirmed
              ? "ring-primary/30"
              : isFailed
                ? "ring-destructive/30"
                : isActive
                  ? "ring-primary/40"
                  : "ring-border"
          }
        `}
        >
          <Image
            src={meta?.logo || "/placeholder.svg"}
            alt={item.symbol}
            fill
            className="object-cover"
          />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{item.symbol}</p>
          <p className="text-xs text-muted-foreground">
            {(item.amountUsdcUnits / 1_000_000).toFixed(2)} USDC
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isConfirmed && (
          <div className="flex items-center gap-1.5 text-primary">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-medium">Done</span>
          </div>
        )}
        {isFailed && (
          <div className="flex items-center gap-1.5 text-destructive">
            <XCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Failed</span>
          </div>
        )}
        {isActive && (
          <div className="flex items-center gap-1.5 text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs font-medium">Processing</span>
          </div>
        )}
        {!isConfirmed && !isFailed && !isActive && (
          <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function BundlesPanel({ ownerBase58 }: Props) {
  const { usdcUsd, displayCurrency, fxRate, refreshNow } = useBalance();
  const availableBalance = usdcUsd || 0;

  const bundle = useBundleSwap();

  // UI State
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(BUNDLES[0]?.id ?? "");
  const [amountDisplay, setAmountDisplay] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<
    RiskLevel | "all"
  >("all");
  const [isEditingWeights, setIsEditingWeights] = useState(false);
  const [customAllocations, setCustomAllocations] = useState<
    EditableAllocation[]
  >([]);

  const selected = useMemo(
    () => BUNDLES.find((b) => b.id === selectedId) ?? BUNDLES[0],
    [selectedId]
  );

  const filteredBundles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return BUNDLES.filter((b) => {
      const matchesSearch =
        q === "" ||
        b.name.toLowerCase().includes(q) ||
        b.subtitle.toLowerCase().includes(q) ||
        b.allocations.some((a) => a.symbol.toLowerCase().includes(q));
      const matchesRisk =
        selectedRiskFilter === "all" || b.risk === selectedRiskFilter;
      return matchesSearch && matchesRisk;
    });
  }, [searchQuery, selectedRiskFilter]);

  const amountNumber = useMemo(() => {
    const n = Number(amountDisplay);
    return Number.isFinite(n) ? n : 0;
  }, [amountDisplay]);

  // Initialize custom allocations when bundle changes
  useEffect(() => {
    if (selected) {
      setCustomAllocations(
        selected.allocations.map((a) => ({ ...a, locked: false }))
      );
      setIsEditingWeights(false);
    }
  }, [selected]);

  const handleWeightChange = useCallback((index: number, newWeight: number) => {
    setCustomAllocations((prev) => redistributeWeights(prev, index, newWeight));
  }, []);

  const handleLockToggle = useCallback((index: number) => {
    setCustomAllocations((prev) =>
      prev.map((a, i) => (i === index ? { ...a, locked: !a.locked } : a))
    );
  }, []);

  const resetToDefaults = useCallback(() => {
    if (selected) {
      setCustomAllocations(
        selected.allocations.map((a) => ({ ...a, locked: false }))
      );
    }
  }, [selected]);

  const hasCustomWeights = useMemo(() => {
    if (!selected) return false;
    return customAllocations.some((a, i) => {
      const original = selected.allocations[i];
      return Math.abs(a.weight - original.weight) > 0.1;
    });
  }, [customAllocations, selected]);

  const canBuy = useMemo(() => {
    if (!ownerBase58) return false;
    if (!selected) return false;
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return false;
    if (amountNumber > availableBalance) return false;
    if ((selected.allocations?.length ?? 0) < 2) return false;
    return true;
  }, [amountNumber, ownerBase58, selected, availableBalance]);

  const progress = useMemo(() => {
    if (bundle.state.items.length === 0) return 0;
    return (bundle.completedCount / bundle.state.items.length) * 100;
  }, [bundle.state.items.length, bundle.completedCount]);

  const statusLabel = useMemo(() => {
    if (!bundle.isExecuting) return "";
    const current = bundle.state.items[bundle.state.currentIndex];
    if (!current) return "Processing...";
    switch (current.status) {
      case "building":
        return `Preparing ${current.symbol}`;
      case "signing":
        return `Sign to buy ${current.symbol}`;
      case "sending":
        return `Sending ${current.symbol}`;
      case "confirming":
        return `Confirming ${current.symbol}`;
      default:
        return "Processing...";
    }
  }, [bundle.isExecuting, bundle.state.items, bundle.state.currentIndex]);

  const openBundle = useCallback(
    (id: string) => {
      setSelectedId(id);
      setAmountDisplay("");
      bundle.reset();
      setOpen(true);
    },
    [bundle]
  );

  const closeModal = useCallback(() => {
    if (bundle.isExecuting) bundle.cancel();
    setOpen(false);
  }, [bundle]);

  const closeAndRefresh = useCallback(async () => {
    await refreshNow().catch(() => {});
    closeModal();
  }, [refreshNow, closeModal]);

  const startPurchase = useCallback(async () => {
    if (!canBuy || !selected || bundle.isExecuting) return;

    const totalUsd = amountNumber / (fxRate || 1);

    // Use custom allocations with weights
    const swaps = customAllocations.map((allocation) => ({
      symbol: allocation.symbol,
      outputMint: requireMintBySymbol(allocation.symbol),
      amountUsd: (totalUsd * allocation.weight) / 100,
    }));

    await bundle.execute(ownerBase58, swaps);
  }, [
    canBuy,
    selected,
    amountNumber,
    fxRate,
    bundle,
    ownerBase58,
    customAllocations,
  ]);

  const handleRetry = useCallback(async () => {
    await bundle.retryFailed(ownerBase58);
  }, [bundle, ownerBase58]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) closeModal();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, closeModal]);

  // Quick amount presets
  const presets = [25, 50, 100, 250];

  return (
    <>
      {/* ═══════════════ Header Section ═══════════════ */}
      <div className="haven-glass p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 glow-mint">
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="haven-kicker">Bundles</p>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                1-Click Portfolios
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Smart weighted portfolios, fully customizable
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Available
            </p>
            <p className="text-base font-semibold text-foreground tabular-nums">
              {formatMoney(availableBalance, displayCurrency)}
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mt-5">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search portfolios or tokens..."
            className="haven-input pl-11"
          />
        </div>

        {/* Risk Filters */}
        <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
          {(["all", "low", "medium", "high", "degen"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setSelectedRiskFilter(risk)}
              className={`
                shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border
                ${
                  selectedRiskFilter === risk
                    ? "bg-primary/15 text-primary border-primary/25"
                    : "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                }
              `}
            >
              {risk === "all"
                ? "All Portfolios"
                : risk.charAt(0).toUpperCase() + risk.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════ Bundle Cards ═══════════════ */}
      <div className="mt-4 grid gap-3">
        {filteredBundles.length === 0 ? (
          <div className="haven-card p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary mx-auto mb-3">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No portfolios found
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Try a different search term or filter
            </p>
          </div>
        ) : (
          filteredBundles.map((b) => {
            const Icon = getRiskIcon(b.risk);
            // Show top 3 weights as preview
            const topWeights = [...b.allocations]
              .sort((a, b) => b.weight - a.weight)
              .slice(0, 3);

            return (
              <button
                key={b.id}
                type="button"
                onClick={() => openBundle(b.id)}
                className="
                  haven-row group w-full text-left p-4
                  transition-all duration-300 
                  hover:shadow-fintech-md hover:border-primary/20
                "
              >
                <div className="flex items-start justify-between gap-4 w-full">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={`
                        flex h-10 w-10 items-center justify-center rounded-2xl border
                        ${
                          b.risk === "low"
                            ? "bg-primary/10 border-primary/20"
                            : b.risk === "medium"
                              ? "bg-accent border-border"
                              : b.risk === "high"
                                ? "bg-amber-500/10 border-amber-500/20"
                                : "bg-destructive/10 border-destructive/20"
                        }
                      `}
                      >
                        <Icon
                          className={`h-4 w-4
                          ${
                            b.risk === "low"
                              ? "text-primary"
                              : b.risk === "medium"
                                ? "text-foreground"
                                : b.risk === "high"
                                  ? "text-amber-500"
                                  : "text-destructive"
                          }
                        `}
                        />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {b.name}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {b.allocations.length} assets • Smart weighted
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                      {b.subtitle}
                    </p>

                    {/* Weight preview badges */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {topWeights.map((a) => (
                        <span
                          key={a.symbol}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/80 text-[10px] font-medium text-muted-foreground"
                        >
                          {a.symbol}
                          <span className="text-foreground">{a.weight}%</span>
                        </span>
                      ))}
                      {b.allocations.length > 3 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary/80 text-[10px] text-muted-foreground">
                          +{b.allocations.length - 3} more
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <TokenStack allocations={b.allocations} size="sm" />
                      <RiskBadge risk={b.risk} />
                    </div>
                  </div>

                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-all duration-300">
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ═══════════════ Purchase Modal ═══════════════ */}
      <Dialog
        open={open}
        onOpenChange={(v) => (v ? setOpen(true) : closeModal())}
      >
        <DialogContent
          className="
            p-0 overflow-hidden flex flex-col gap-0
            bg-card border-border text-foreground shadow-fintech-lg
            sm:w-[min(92vw,520px)] sm:max-w-[520px] sm:max-h-[90vh] sm:rounded-3xl
            max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none
            max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none
            max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0
          "
        >
          {/* Progress bar */}
          {bundle.state.items.length > 0 && (
            <div className="h-1 w-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            {/* Modal Header */}
            <div className="shrink-0 px-5 pt-5 pb-4 border-b border-border">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {selected && (
                    <div
                      className={`
                      flex h-11 w-11 items-center justify-center rounded-2xl border
                      ${
                        selected.risk === "low"
                          ? "bg-primary/10 border-primary/20"
                          : selected.risk === "medium"
                            ? "bg-accent border-border"
                            : selected.risk === "high"
                              ? "bg-amber-500/10 border-amber-500/20"
                              : "bg-destructive/10 border-destructive/20"
                      }
                    `}
                    >
                      {React.createElement(getRiskIcon(selected.risk), {
                        className: `h-5 w-5 ${
                          selected.risk === "low"
                            ? "text-primary"
                            : selected.risk === "medium"
                              ? "text-foreground"
                              : selected.risk === "high"
                                ? "text-amber-500"
                                : "text-destructive"
                        }`,
                      })}
                    </div>
                  )}
                  <div>
                    <DialogTitle className="text-base font-semibold text-foreground">
                      {selected?.name ?? "Portfolio"}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                      {selected?.allocations.length ?? 0} assets •{" "}
                      {riskLabel(selected?.risk as RiskLevel)}
                      {hasCustomWeights && (
                        <span className="ml-2 text-primary">• Customized</span>
                      )}
                    </DialogDescription>
                  </div>
                </div>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
              {/* Amount Input - shown in idle phase */}
              {bundle.state.phase === "idle" && (
                <div className="haven-card-soft p-4 mb-4">
                  <label className="haven-kicker block mb-3">
                    Investment Amount
                  </label>

                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-lg font-medium text-muted-foreground">
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
                      className="
                        flex-1 bg-transparent text-3xl font-semibold text-foreground 
                        outline-none placeholder:text-muted-foreground/40 tabular-nums
                      "
                    />
                  </div>

                  {/* Quick Presets */}
                  <div className="flex gap-2 mb-4">
                    {presets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmountDisplay(preset.toString())}
                        className="
                          flex-1 py-2 rounded-xl text-xs font-medium
                          bg-secondary border border-border text-muted-foreground
                          hover:bg-accent hover:text-foreground hover:border-primary/20
                          transition-all duration-200
                        "
                      >
                        ${preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setAmountDisplay(availableBalance.toFixed(2))
                      }
                      className="haven-pill haven-pill-positive hover:bg-primary/15 transition-all duration-200"
                    >
                      Max
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Available Balance
                    </span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatMoney(availableBalance, displayCurrency)}
                    </span>
                  </div>
                </div>
              )}

              {/* Weight Editor */}
              {bundle.state.phase === "idle" &&
                customAllocations.length > 0 && (
                  <div className="haven-card-soft p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <PieChart className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Portfolio Weights
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasCustomWeights && (
                          <button
                            type="button"
                            onClick={resetToDefaults}
                            className="
                            inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                            text-xs font-medium text-muted-foreground
                            hover:bg-secondary hover:text-foreground
                            transition-all duration-200
                          "
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reset
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsEditingWeights(!isEditingWeights)}
                          className={`
                          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                          text-xs font-medium transition-all duration-200
                          ${
                            isEditingWeights
                              ? "bg-primary/15 text-primary border border-primary/25"
                              : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                          }
                        `}
                        >
                          <Sliders className="h-3 w-3" />
                          {isEditingWeights ? "Done" : "Customize"}
                        </button>
                      </div>
                    </div>

                    {isEditingWeights && (
                      <div className="mb-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            Tip:
                          </span>{" "}
                          Drag sliders to adjust weights. Lock{" "}
                          <Lock className="inline h-3 w-3 mx-0.5" /> allocations
                          you want to keep fixed.
                        </p>
                      </div>
                    )}

                    <div className="space-y-0">
                      {customAllocations.map((allocation, index) => (
                        <WeightEditorRow
                          key={allocation.symbol}
                          allocation={allocation}
                          index={index}
                          totalAmount={amountNumber}
                          currency={displayCurrency}
                          onWeightChange={handleWeightChange}
                          onLockToggle={handleLockToggle}
                          isEditing={isEditingWeights}
                        />
                      ))}
                    </div>

                    {/* Total verification */}
                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Total Allocation
                      </span>
                      <span
                        className={`
                        text-sm font-semibold tabular-nums
                        ${
                          Math.abs(
                            customAllocations.reduce(
                              (s, a) => s + a.weight,
                              0
                            ) - 100
                          ) < 0.1
                            ? "text-primary"
                            : "text-destructive"
                        }
                      `}
                      >
                        {customAllocations
                          .reduce((s, a) => s + a.weight, 0)
                          .toFixed(0)}
                        %
                      </span>
                    </div>
                  </div>
                )}

              {/* Execution Progress */}
              {bundle.state.items.length > 0 && (
                <div className="space-y-3">
                  {bundle.isExecuting && (
                    <div className="flex items-center justify-center gap-3 py-3 px-4 rounded-2xl bg-primary/10 border border-primary/20">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-sm text-primary font-medium">
                        {statusLabel}
                      </span>
                    </div>
                  )}

                  <div className="space-y-2">
                    {bundle.state.items.map((item, i) => (
                      <ExecutionStep
                        key={item.symbol}
                        item={item}
                        isActive={
                          bundle.isExecuting &&
                          bundle.state.currentIndex === i &&
                          [
                            "building",
                            "signing",
                            "sending",
                            "confirming",
                          ].includes(item.status)
                        }
                      />
                    ))}
                  </div>

                  {/* Retry Failed */}
                  {bundle.hasFailed && !bundle.isExecuting && (
                    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            {bundle.failedCount} of {bundle.state.items.length}{" "}
                            purchases failed
                          </p>
                          <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-1">
                            You can retry the failed transactions below
                          </p>
                          <button
                            type="button"
                            onClick={handleRetry}
                            className="
                              mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl
                              bg-amber-500/10 border border-amber-500/20
                              text-sm font-medium text-amber-600 dark:text-amber-400
                              hover:bg-amber-500/20 hover:border-amber-500/30
                              transition-all duration-200
                            "
                          >
                            <RefreshCw className="h-4 w-4" />
                            Retry Failed
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer CTA */}
            <DialogFooter className="shrink-0 border-t border-border bg-card px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              {bundle.state.phase === "idle" && (
                <p className="text-xs text-muted-foreground text-center mb-3">
                  {hasCustomWeights ? "Custom weights" : "Smart weighted"} •
                  Sequential execution • Network fees apply
                </p>
              )}

              <button
                type="button"
                onClick={bundle.isComplete ? closeAndRefresh : startPurchase}
                disabled={(!canBuy && !bundle.isComplete) || bundle.isExecuting}
                className={`
                  haven-btn-primary
                  ${
                    bundle.isComplete
                      ? "!bg-primary"
                      : !canBuy || bundle.isExecuting
                        ? "opacity-60 cursor-not-allowed"
                        : ""
                  }
                `}
              >
                {bundle.isExecuting ? (
                  <span className="flex items-center justify-center gap-2 text-black">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {statusLabel}
                  </span>
                ) : bundle.isComplete ? (
                  <span className="flex items-center justify-center gap-2 text-black">
                    <CheckCircle2 className="h-4 w-4" />
                    Complete ({bundle.completedCount}/
                    {bundle.state.items.length})
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2 text-black">
                    Build Portfolio
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
