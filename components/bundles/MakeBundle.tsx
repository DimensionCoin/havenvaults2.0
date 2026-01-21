// components/bundles/MakeBundle.tsx
"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import Image from "next/image";
import {
  Plus,
  X,
  Search,
  Trash2,
  Lock,
  Globe,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Minus,
  Sparkles,
  TrendingUp,
  Shield,
  Zap,
  ChevronDown,
  AlertCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

import { TOKENS, findTokenBySymbol, type TokenMeta } from "@/lib/tokenConfig";
import { useBalance } from "@/providers/BalanceProvider";
import { useBundleSwap } from "@/hooks/useBundleSwap";
import { requireMintBySymbol } from "@/lib/tokenConfig";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

type RiskLevel = "low" | "medium" | "high" | "degen";
type Visibility = "public" | "private";

type AllocationItem = {
  symbol: string;
  weight: number;
  locked: boolean;
};

type Props = {
  ownerBase58: string;
  onBundleCreated?: () => void;
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

function redistributeWeights(
  allocations: AllocationItem[],
  changedIndex: number,
  newWeight: number,
): AllocationItem[] {
  const result = [...allocations];
  const clampedWeight = Math.max(0, Math.min(100, newWeight));

  result[changedIndex] = { ...result[changedIndex], weight: clampedWeight };

  const totalAfterChange = result.reduce((sum, a) => sum + a.weight, 0);
  const excess = totalAfterChange - 100;

  if (Math.abs(excess) < 0.01) return result;

  const unlocked = result
    .map((a, i) => ({ ...a, index: i }))
    .filter((a, i) => !a.locked && i !== changedIndex);

  if (unlocked.length === 0) {
    return result.map((a) => ({
      ...a,
      weight: (a.weight / totalAfterChange) * 100,
    }));
  }

  const unlockedTotal = unlocked.reduce((sum, a) => sum + a.weight, 0);

  unlocked.forEach((item) => {
    const proportion =
      unlockedTotal > 0 ? item.weight / unlockedTotal : 1 / unlocked.length;
    const adjustment = excess * proportion;
    const newVal = Math.max(0, result[item.index].weight - adjustment);
    result[item.index] = { ...result[item.index], weight: newVal };
  });

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
   TOKEN SELECTOR COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

function TokenSelector({
  selectedSymbols,
  onSelect,
  onClose,
}: {
  selectedSymbols: string[];
  onSelect: (symbol: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filteredTokens = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TOKENS.filter((t) => {
      if (selectedSymbols.includes(t.symbol)) return false;
      if (q === "") return true;
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.categories.some((c) => c.toLowerCase().includes(q))
      );
    }).slice(0, 50);
  }, [search, selectedSymbols]);

  return (
    <div className="flex flex-col h-full max-h-[60vh]">
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assets..."
          autoFocus
          className="haven-input pl-10 text-black placeholder:text-black/50"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 -mx-4 px-4">
        {filteredTokens.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No assets found</p>
          </div>
        ) : (
          filteredTokens.map((token) => (
            <button
              key={token.symbol}
              type="button"
              onClick={() => {
                onSelect(token.symbol);
                onClose();
              }}
              className="
                w-full flex items-center gap-3 p-3 rounded-xl
                hover:bg-accent transition-colors text-left
              "
            >
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-secondary ring-2 ring-border">
                <Image
                  src={token.logo || "/placeholder.svg"}
                  alt={token.symbol}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {token.symbol}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {token.name}
                </p>
              </div>
              <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-secondary">
                {token.kind}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ALLOCATION ROW COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

function AllocationRow({
  allocation,
  index,
  totalAmount,
  currency,
  onWeightChange,
  onLockToggle,
  onRemove,
}: {
  allocation: AllocationItem;
  index: number;
  totalAmount: number;
  currency: string;
  onWeightChange: (index: number, weight: number) => void;
  onLockToggle: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const meta = findTokenBySymbol(allocation.symbol);
  const amount = (totalAmount * allocation.weight) / 100;
  const weight = Math.round(allocation.weight);

  const increment = () => {
    if (!allocation.locked) {
      onWeightChange(index, Math.min(100, allocation.weight + 5));
    }
  };

  const decrement = () => {
    if (!allocation.locked) {
      onWeightChange(index, Math.max(0, allocation.weight - 5));
    }
  };

  return (
    <div
      className={`
        rounded-2xl border transition-all duration-200 overflow-hidden
        ${allocation.locked ? "bg-secondary/30 border-border" : "bg-card border-primary/20"}
      `}
    >
      <div className="flex items-center gap-3 p-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-secondary ring-2 ring-border">
          <Image
            src={meta?.logo || "/placeholder.svg"}
            alt={allocation.symbol}
            fill
            className="object-cover"
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {allocation.symbol}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatMoney(amount, currency)}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onLockToggle(index)}
            className={`
              h-10 w-10 flex items-center justify-center rounded-xl
              transition-all duration-200 active:scale-95
              ${
                allocation.locked
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary text-muted-foreground"
              }
            `}
          >
            {allocation.locked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4 opacity-40" />
            )}
          </button>

          <div
            className={`
              flex items-center rounded-xl border overflow-hidden
              ${allocation.locked ? "opacity-50" : ""}
              ${allocation.locked ? "border-border" : "border-primary/30 bg-primary/5"}
            `}
          >
            <button
              type="button"
              onClick={decrement}
              disabled={allocation.locked || weight <= 0}
              className={`
                h-10 w-10 flex items-center justify-center
                transition-all duration-150 active:scale-90 active:bg-primary/20
                ${
                  allocation.locked || weight <= 0
                    ? "text-muted-foreground/40 cursor-not-allowed"
                    : "text-foreground hover:bg-primary/10"
                }
              `}
            >
              <Minus className="h-4 w-4" />
            </button>

            <span className="w-12 text-center text-sm font-bold tabular-nums text-foreground">
              {weight}%
            </span>

            <button
              type="button"
              onClick={increment}
              disabled={allocation.locked || weight >= 100}
              className={`
                h-10 w-10 flex items-center justify-center
                transition-all duration-150 active:scale-90 active:bg-primary/20
                ${
                  allocation.locked || weight >= 100
                    ? "text-muted-foreground/40 cursor-not-allowed"
                    : "text-foreground hover:bg-primary/10"
                }
              `}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onRemove(index)}
            className="h-10 w-10 flex items-center justify-center rounded-xl text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-all active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="h-1.5 w-full bg-secondary/50">
        <div
          className={`
            h-full transition-all duration-300 rounded-r-full
            ${allocation.locked ? "bg-muted-foreground/40" : "bg-primary"}
          `}
          style={{ width: `${allocation.weight}%` }}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function MakeBundle({ ownerBase58, onBundleCreated }: Props) {
  const { usdcUsd, displayCurrency, fxRate, refreshNow } = useBalance();
  const availableBalance = usdcUsd || 0;

  const bundle = useBundleSwap();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"create" | "buy">("create");
  const [showTokenSelector, setShowTokenSelector] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [allocations, setAllocations] = useState<AllocationItem[]>([]);
  const [risk, setRisk] = useState<RiskLevel>("medium");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [amountDisplay, setAmountDisplay] = useState("");

  // API state
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdBundleId, setCreatedBundleId] = useState<string | null>(null);

  const amountNumber = useMemo(() => {
    const n = Number(amountDisplay);
    return Number.isFinite(n) ? n : 0;
  }, [amountDisplay]);

  const totalWeight = useMemo(
    () => allocations.reduce((s, a) => s + a.weight, 0),
    [allocations],
  );

  const isWeightValid = Math.abs(totalWeight - 100) < 0.5;
  const canCreate =
    name.trim().length > 0 && allocations.length >= 2 && isWeightValid;

  const canBuy = useMemo(() => {
    if (!ownerBase58) return false;
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return false;
    if (amountNumber > availableBalance) return false;
    if (allocations.length < 2) return false;
    return true;
  }, [amountNumber, ownerBase58, allocations, availableBalance]);

  // Add asset
  const handleAddAsset = useCallback((symbol: string) => {
    setAllocations((prev) => {
      if (prev.length >= 5) return prev;
      if (prev.some((a) => a.symbol === symbol)) return prev;

      const newCount = prev.length + 1;
      const equalWeight = 100 / newCount;

      return [
        ...prev.map((a) => ({ ...a, weight: equalWeight })),
        { symbol, weight: equalWeight, locked: false },
      ];
    });
  }, []);

  // Remove asset
  const handleRemoveAsset = useCallback((index: number) => {
    setAllocations((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) return next;

      const equalWeight = 100 / next.length;
      return next.map((a) => ({ ...a, weight: equalWeight }));
    });
  }, []);

  // Weight change
  const handleWeightChange = useCallback((index: number, newWeight: number) => {
    setAllocations((prev) => redistributeWeights(prev, index, newWeight));
  }, []);

  // Lock toggle
  const handleLockToggle = useCallback((index: number) => {
    setAllocations((prev) =>
      prev.map((a, i) => (i === index ? { ...a, locked: !a.locked } : a)),
    );
  }, []);

  // Create bundle
  const handleCreate = useCallback(async () => {
    if (!canCreate) return;

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await fetch("/api/bundle/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subtitle: subtitle.trim() || undefined,
          allocations: allocations.map((a) => ({
            symbol: a.symbol,
            weight: a.weight,
          })),
          risk,
          visibility,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create bundle");
      }

      setCreatedBundleId(data.bundle._id);
      setStep("buy");
      onBundleCreated?.();
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : "Failed to create bundle",
      );
    } finally {
      setIsCreating(false);
    }
  }, [
    canCreate,
    name,
    subtitle,
    allocations,
    risk,
    visibility,
    onBundleCreated,
  ]);

  // Start purchase
  const startPurchase = useCallback(async () => {
    if (!canBuy || bundle.isExecuting) return;

    const totalUsd = amountNumber / (fxRate || 1);

    const swaps = allocations.map((allocation) => ({
      symbol: allocation.symbol,
      outputMint: requireMintBySymbol(allocation.symbol),
      amountUsd: (totalUsd * allocation.weight) / 100,
    }));

    await bundle.execute(ownerBase58, swaps);
  }, [canBuy, amountNumber, fxRate, bundle, ownerBase58, allocations]);

  // Close modal
  const closeModal = useCallback(() => {
    if (bundle.isExecuting) bundle.cancel();
    setOpen(false);

    // Reset state after animation
    setTimeout(() => {
      setStep("create");
      setName("");
      setSubtitle("");
      setAllocations([]);
      setRisk("medium");
      setVisibility("private");
      setAmountDisplay("");
      setCreateError(null);
      setCreatedBundleId(null);
      bundle.reset();
    }, 300);
  }, [bundle]);

  // Close and refresh
  const closeAndRefresh = useCallback(async () => {
    await refreshNow().catch(() => {});
    closeModal();
  }, [refreshNow, closeModal]);

  const presets = [25, 50, 100, 250];

  return (
    <>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          inline-flex items-center gap-2 px-4 py-2.5 rounded-xl
          bg-primary text-primary-foreground font-medium text-sm
          hover:bg-primary/90 active:scale-[0.98] transition-all
          shadow-fintech-sm
        "
      >
        <Plus className="h-4 w-4" />
        Create
      </button>

      {/* Modal */}
      <Dialog
        open={open}
        onOpenChange={(v) => (v ? setOpen(true) : closeModal())}
      >
        <DialogContent
          className={[
            "p-0 overflow-hidden flex flex-col gap-0",
            "bg-card border-border text-foreground shadow-fintech-lg",
            "min-h-0",
            "sm:w-[min(92vw,520px)] sm:max-w-[520px] sm:max-h-[90vh] sm:rounded-3xl",
            "max-sm:fixed",
            "max-sm:left-1/2 max-sm:top-1/2",
            "max-sm:-translate-x-1/2 max-sm:-translate-y-1/2",
            "max-sm:w-[calc(100vw-24px)]",
            "max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-24px)]",
            "max-sm:rounded-3xl",
          ].join(" ")}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-card/95 backdrop-blur px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl sm:rounded-2xl bg-primary/10 border border-primary/20">
                    <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  </div>

                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold text-foreground">
                      {step === "create"
                        ? "Create Your Bundle"
                        : "Invest in Bundle"}
                    </DialogTitle>
                    <DialogDescription className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                      {step === "create"
                        ? "Pick 2-5 assets and customize weights"
                        : "Choose an amount to invest"}
                    </DialogDescription>
                  </div>
                </div>

                <DialogClose asChild>
                  <button
                    type="button"
                    aria-label="Close"
                    className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary/60 text-muted-foreground hover:bg-accent hover:text-foreground active:scale-95 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </DialogClose>
              </div>
            </div>

            {/* Scrollable Content */}
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4"
              style={{ overflowX: "hidden", touchAction: "pan-y" }}
            >
              {showTokenSelector ? (
                <TokenSelector
                  selectedSymbols={allocations.map((a) => a.symbol)}
                  onSelect={handleAddAsset}
                  onClose={() => setShowTokenSelector(false)}
                />
              ) : step === "create" ? (
                <div className="space-y-4">
                  {/* Name Input */}
                  <div className="haven-card-soft p-4">
                    <label className="haven-kicker block mb-2">
                      Bundle Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My Awesome Portfolio"
                      maxLength={50}
                      className="haven-input text-black placeholder:text-black/50"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1 text-right">
                      {name.length}/50
                    </p>
                  </div>

                  {/* Subtitle Input */}
                  <div className="haven-card-soft p-4">
                    <label className="haven-kicker block mb-2">
                      Description{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      placeholder="A brief description of your strategy"
                      maxLength={100}
                      className="haven-input text-black placeholder:text-black/50"
                    />
                  </div>

                  {/* Assets */}
                  <div className="haven-card-soft p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="haven-kicker">
                        Assets ({allocations.length}/5)
                      </label>
                      <span
                        className={`
                          text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full
                          ${isWeightValid ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}
                        `}
                      >
                        {Math.round(totalWeight)}%
                      </span>
                    </div>

                    <div className="space-y-2 mb-3">
                      {allocations.map((allocation, index) => (
                        <AllocationRow
                          key={allocation.symbol}
                          allocation={allocation}
                          index={index}
                          totalAmount={100}
                          currency={displayCurrency}
                          onWeightChange={handleWeightChange}
                          onLockToggle={handleLockToggle}
                          onRemove={handleRemoveAsset}
                        />
                      ))}
                    </div>

                    {allocations.length < 5 && (
                      <button
                        type="button"
                        onClick={() => setShowTokenSelector(true)}
                        className="
                          w-full py-3 rounded-xl border-2 border-dashed border-border
                          text-sm font-medium text-muted-foreground
                          hover:border-primary/40 hover:text-primary hover:bg-primary/5
                          transition-all flex items-center justify-center gap-2
                        "
                      >
                        <Plus className="h-4 w-4" />
                        Add Asset
                      </button>
                    )}

                    {allocations.length < 2 && (
                      <p className="text-xs text-muted-foreground text-center mt-2">
                        Add at least 2 assets to create a bundle
                      </p>
                    )}
                  </div>

                  {/* Risk Level */}
                  <div className="haven-card-soft p-4">
                    <label className="haven-kicker block mb-3">
                      Risk Level
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {(["low", "medium", "high", "degen"] as RiskLevel[]).map(
                        (r) => {
                          const Icon = getRiskIcon(r);
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setRisk(r)}
                              className={`
                                flex flex-col items-center gap-1.5 py-3 rounded-xl border
                                transition-all active:scale-95
                                ${
                                  risk === r
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "bg-secondary border-border text-muted-foreground hover:bg-accent"
                                }
                              `}
                            >
                              <Icon className="h-4 w-4" />
                              <span className="text-[10px] font-medium capitalize">
                                {r}
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>

                  {/* Visibility */}
                  <div className="haven-card-soft p-4">
                    <label className="haven-kicker block mb-3">
                      Visibility
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setVisibility("private")}
                        className={`
                          flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-95
                          ${
                            visibility === "private"
                              ? "bg-primary/10 border-primary/30"
                              : "bg-secondary border-border hover:bg-accent"
                          }
                        `}
                      >
                        <Lock
                          className={`h-5 w-5 ${
                            visibility === "private"
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        />
                        <div className="text-left">
                          <p
                            className={`text-sm font-medium ${
                              visibility === "private"
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            Private
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Only you can see
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setVisibility("public")}
                        className={`
                          flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-95
                          ${
                            visibility === "public"
                              ? "bg-primary/10 border-primary/30"
                              : "bg-secondary border-border hover:bg-accent"
                          }
                        `}
                      >
                        <Globe
                          className={`h-5 w-5 ${
                            visibility === "public"
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        />
                        <div className="text-left">
                          <p
                            className={`text-sm font-medium ${
                              visibility === "public"
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            Public
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Share with everyone
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {createError && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                      <p className="text-sm text-destructive">{createError}</p>
                    </div>
                  )}
                </div>
              ) : (
                /* BUY STEP */
                <div className="space-y-4">
                  {/* Success Message */}
                  {!bundle.isExecuting && bundle.state.phase === "idle" && (
                    <div className="flex items-center gap-3 p-4 rounded-2xl bg-primary/10 border border-primary/20">
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Bundle created!
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Would you like to invest in it now?
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Amount Input */}
                  {bundle.state.phase === "idle" && (
                    <div className="haven-card-soft p-4">
                      <label className="haven-kicker block mb-3">
                        Investment Amount
                      </label>

                      <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-base sm:text-lg font-medium text-muted-foreground">
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
                            flex-1 bg-transparent text-2xl sm:text-3xl font-semibold text-foreground 
                            outline-none placeholder:text-muted-foreground/40 tabular-nums
                            min-w-0
                          "
                        />
                      </div>

                      <div className="grid grid-cols-5 gap-2 mb-4">
                        {presets.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setAmountDisplay(preset.toString())}
                            className="
                              py-2.5 rounded-xl text-xs font-medium
                              bg-secondary border border-border text-muted-foreground
                              hover:bg-accent hover:text-foreground hover:border-primary/20
                              active:scale-95 transition-all duration-200
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
                          className="haven-pill haven-pill-positive hover:bg-primary/15 active:scale-95 transition-all duration-200 py-2.5"
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

                  {/* Allocations Preview */}
                  {bundle.state.phase === "idle" && (
                    <div className="haven-card-soft p-4">
                      <label className="haven-kicker block mb-3">
                        Your Bundle
                      </label>
                      <div className="space-y-2">
                        {allocations.map((a) => {
                          const meta = findTokenBySymbol(a.symbol);
                          const amount = (amountNumber * a.weight) / 100;
                          return (
                            <div
                              key={a.symbol}
                              className="flex items-center justify-between p-2 rounded-xl bg-secondary"
                            >
                              <div className="flex items-center gap-2">
                                <div className="relative h-7 w-7 overflow-hidden rounded-full">
                                  <Image
                                    src={meta?.logo || "/placeholder.svg"}
                                    alt={a.symbol}
                                    fill
                                    className="object-cover"
                                  />
                                </div>
                                <span className="text-sm font-medium">
                                  {a.symbol}
                                </span>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold tabular-nums">
                                  {Math.round(a.weight)}%
                                </p>
                                <p className="text-[10px] text-muted-foreground tabular-nums">
                                  {formatMoney(amount, displayCurrency)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Execution Progress */}
                  {bundle.state.items.length > 0 && (
                    <div className="space-y-2">
                      {bundle.state.items.map((item, i) => {
                        const meta = findTokenBySymbol(item.symbol);
                        const isActive =
                          bundle.isExecuting &&
                          bundle.state.currentIndex === i &&
                          [
                            "building",
                            "signing",
                            "sending",
                            "confirming",
                          ].includes(item.status);

                        return (
                          <div
                            key={item.symbol}
                            className={`
                              flex items-center justify-between p-3 rounded-2xl transition-all
                              ${
                                item.status === "confirmed"
                                  ? "bg-primary/10 border border-primary/20"
                                  : item.status === "failed"
                                    ? "bg-destructive/10 border border-destructive/20"
                                    : isActive
                                      ? "bg-accent border border-primary/30"
                                      : "bg-secondary border border-border"
                              }
                            `}
                          >
                            <div className="flex items-center gap-3">
                              <div className="relative h-8 w-8 overflow-hidden rounded-full">
                                <Image
                                  src={meta?.logo || "/placeholder.svg"}
                                  alt={item.symbol}
                                  fill
                                  className="object-cover"
                                />
                              </div>
                              <div>
                                <p className="text-sm font-medium">
                                  {item.symbol}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {(item.amountUsdcUnits / 1_000_000).toFixed(
                                    2,
                                  )}{" "}
                                  USDC
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {item.status === "confirmed" && (
                                <CheckCircle2 className="h-4 w-4 text-primary" />
                              )}
                              {item.status === "failed" && (
                                <X className="h-4 w-4 text-destructive" />
                              )}
                              {isActive && (
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {!showTokenSelector && (
              <DialogFooter className="shrink-0 border-t border-border bg-card px-4 sm:px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
                {step === "create" ? (
                  <div className="w-full space-y-3">
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={!canCreate || isCreating}
                      className={`
                        haven-btn-primary
                        ${!canCreate || isCreating ? "opacity-60 cursor-not-allowed" : ""}
                      `}
                    >
                      {isCreating ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2 text-black">
                          Create Bundle
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="w-full space-y-3">
                    {bundle.state.phase === "idle" && (
                      <p className="text-[11px] text-muted-foreground text-center">
                        Sequential execution • {allocations.length} swaps
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="flex-1 haven-btn-secondary"
                      >
                        {bundle.isComplete ? "Done" : "Skip"}
                      </button>

                      <button
                        type="button"
                        onClick={
                          bundle.isComplete ? closeAndRefresh : startPurchase
                        }
                        disabled={
                          (!canBuy && !bundle.isComplete) || bundle.isExecuting
                        }
                        className={`
                          flex-1 haven-btn-primary
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
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Processing
                          </span>
                        ) : bundle.isComplete ? (
                          <span className="flex items-center justify-center gap-2 text-black">
                            <CheckCircle2 className="h-4 w-4" />
                            Complete
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2 text-black">
                            Invest Now
                            <ArrowRight className="h-4 w-4" />
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </DialogFooter>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
