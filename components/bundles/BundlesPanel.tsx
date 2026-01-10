// components/bundles/BundlesPanel.tsx
"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
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
} from "lucide-react";

import { BUNDLES, type RiskLevel } from "./bundlesConfig";
import { findTokenBySymbol, requireMintBySymbol } from "@/lib/tokenConfig";
import { useBalance } from "@/providers/BalanceProvider";
import { useBundleSwap } from "@/hooks/useBundleSwap";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

type Props = {
  ownerBase58: string;
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

function riskPill(risk: RiskLevel) {
  const Icon = getRiskIcon(risk);
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground/80 backdrop-blur">
      <Icon className="h-3 w-3 text-primary" />
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

/* ═══════════════════════════════════════════════════════════════════════════
   TOKEN ICONS
   ═══════════════════════════════════════════════════════════════════════════ */

function TokenIconsCompact({ symbols }: { symbols: string[] }) {
  const shown = symbols.slice(0, 4);
  const extra = Math.max(0, symbols.length - shown.length);

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2.5">
        {shown.map((s) => {
          const meta = findTokenBySymbol(s);
          return (
            <div
              key={s}
              className="relative h-8 w-8 overflow-hidden rounded-full border-2 border-background/70 bg-card"
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
        <div className="ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-border/60 bg-card">
          <span className="text-[11px] font-bold text-muted-foreground">
            +{extra}
          </span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function BundlesPanel({ ownerBase58 }: Props) {
  // Balance
  const { usdcUsd, displayCurrency, fxRate } = useBalance();
  const availableBalance = usdcUsd;

  // Bundle swap hook
  const bundle = useBundleSwap();

  // UI State
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(BUNDLES[0]?.id ?? "");
  const [amountDisplay, setAmountDisplay] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<
    RiskLevel | "all"
  >("all");

  // Computed
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
        b.symbols.some((s) => s.toLowerCase().includes(q));
      const matchesRisk =
        selectedRiskFilter === "all" || b.risk === selectedRiskFilter;
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

  // Progress
  const progress = useMemo(() => {
    if (bundle.state.items.length === 0) return 0;
    return (bundle.completedCount / bundle.state.items.length) * 100;
  }, [bundle.state.items.length, bundle.completedCount]);

  // Status label
  const statusLabel = useMemo(() => {
    if (!bundle.isExecuting) return "";
    const current = bundle.state.items[bundle.state.currentIndex];
    if (!current) return "Processing...";

    switch (current.status) {
      case "building":
        return `Preparing ${current.symbol}...`;
      case "signing":
        return `Sign to buy ${current.symbol}`;
      case "sending":
        return `Sending ${current.symbol}...`;
      case "confirming":
        return `Confirming ${current.symbol}...`;
      default:
        return "Processing...";
    }
  }, [bundle.isExecuting, bundle.state.items, bundle.state.currentIndex]);

  // Handlers
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
    if (bundle.isExecuting) {
      bundle.cancel();
    }
    setOpen(false);
  }, [bundle]);

  const startPurchase = useCallback(async () => {
    if (!canBuy || !selected || bundle.isExecuting) return;

    const amt = Number(amountDisplay);
    const perUsd = amt / fxRate / selected.symbols.length;

    const swaps = selected.symbols.map((symbol) => ({
      symbol,
      outputMint: requireMintBySymbol(symbol),
      amountUsd: perUsd,
    }));

    await bundle.execute(ownerBase58, swaps);
  }, [canBuy, selected, amountDisplay, fxRate, bundle, ownerBase58]);

  const handleRetry = useCallback(async () => {
    await bundle.retryFailed(ownerBase58);
  }, [bundle, ownerBase58]);

  // Close on escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) closeModal();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, closeModal]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Main Panel */}
      <div className="glass-panel bg-card/30 p-5">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-card/50 backdrop-blur">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Bundles</h3>
            <p className="text-xs text-muted-foreground">
              Diversify with one tap
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bundles..."
            className="w-full rounded-xl border border-border/60 bg-card/40 py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground outline-none backdrop-blur focus:border-border focus:ring-2 focus:ring-primary/25"
          />
        </div>

        {/* Risk Filter */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(["all", "low", "medium", "high", "degen"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setSelectedRiskFilter(risk)}
              className={[
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                selectedRiskFilter === risk
                  ? "bg-primary/15 text-primary border border-primary/25"
                  : "bg-card/40 text-muted-foreground border border-border/60 hover:text-foreground hover:bg-card/60",
              ].join(" ")}
            >
              {risk}
            </button>
          ))}
        </div>

        {/* Bundle List */}
        <div className="grid gap-3">
          {filteredBundles.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No bundles found
            </div>
          ) : (
            filteredBundles.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => openBundle(b.id)}
                className={[
                  "group flex items-center justify-between rounded-2xl border p-4 text-left transition",
                  "border-border/60 bg-card/30 hover:bg-card/50 hover:border-border",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
                ].join(" ")}
              >
                <div className="flex items-center gap-3">
                  <TokenIconsCompact symbols={b.symbols} />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {b.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.symbols.length} assets
                    </p>
                  </div>
                </div>
                {riskPill(b.risk)}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          onClick={closeModal}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

          {/* Modal */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl border border-border/60 bg-background/90 shadow-[0_30px_90px_rgba(0,0,0,0.65)] backdrop-blur"
          >
            {/* Progress Bar */}
            {bundle.state.items.length > 0 && (
              <div className="absolute left-0 right-0 top-0 h-1 overflow-hidden rounded-t-3xl bg-foreground/5">
                <div
                  className="h-full bg-primary/70 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background/85 px-5 py-4 backdrop-blur">
              <div className="flex items-center gap-3">
                {selected && (
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-card/40">
                    {React.createElement(getRiskIcon(selected.risk), {
                      className: "h-5 w-5 text-primary",
                    })}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {selected?.name ?? "Bundle"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {selected?.symbols.length} assets • {selected?.risk} risk
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/40 text-muted-foreground hover:text-foreground hover:bg-card/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="space-y-4 p-5">
              {/* Amount Input - Only before execution */}
              {bundle.state.phase === "idle" && (
                <>
                  <div className="rounded-2xl border border-border/60 bg-card/30 p-4">
                    <label className="mb-2 block text-xs font-medium text-muted-foreground">
                      Investment Amount
                    </label>

                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-muted-foreground">
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
                        className="flex-1 bg-transparent text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Available</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAmountDisplay(availableBalance.toFixed(2))
                        }
                        className="font-medium text-primary hover:text-primary/90"
                      >
                        {availableBalance.toFixed(2)} {displayCurrency}
                      </button>
                    </div>
                  </div>

                  {/* Distribution Preview */}
                  {perTokenDisplay > 0 && (
                    <div className="rounded-2xl border border-border/60 bg-card/30 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Distribution
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Equal weight
                        </span>
                      </div>

                      <div className="space-y-2">
                        {(selected?.symbols ?? []).map((s) => {
                          const meta = findTokenBySymbol(s);
                          return (
                            <div
                              key={s}
                              className="flex items-center justify-between py-1.5"
                            >
                              <div className="flex items-center gap-2">
                                <div className="relative h-6 w-6 overflow-hidden rounded-full border border-border/60 bg-card">
                                  <Image
                                    src={meta?.logo || "/placeholder.svg"}
                                    alt={s}
                                    fill
                                    className="object-cover"
                                  />
                                </div>
                                <span className="text-sm text-foreground/90">
                                  {s}
                                </span>
                              </div>
                              <span className="text-sm text-muted-foreground">
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
              {bundle.state.items.length > 0 && (
                <div className="space-y-2">
                  {/* Phase indicator */}
                  {bundle.isExecuting && (
                    <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      {statusLabel}
                    </div>
                  )}

                  {/* Items */}
                  {bundle.state.items.map((item) => {
                    const meta = findTokenBySymbol(item.symbol);
                    const isConfirmed = item.status === "confirmed";
                    const isFailed = item.status === "failed";
                    const isActive = [
                      "building",
                      "signing",
                      "sending",
                      "confirming",
                    ].includes(item.status);

                    return (
                      <div
                        key={item.symbol}
                        className={[
                          "flex items-center justify-between rounded-2xl border p-3 transition",
                          isConfirmed
                            ? "border-primary/25 bg-primary/10"
                            : isFailed
                              ? "border-destructive/25 bg-destructive/10"
                              : isActive
                                ? "border-primary/20 bg-primary/5"
                                : "border-border/60 bg-card/30",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative h-8 w-8 overflow-hidden rounded-full border border-border/60 bg-card">
                            <Image
                              src={meta?.logo || "/placeholder.svg"}
                              alt={item.symbol}
                              fill
                              className="object-cover"
                            />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {item.symbol}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {(item.amountUsdcUnits / 1_000_000).toFixed(2)}{" "}
                              USDC
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isConfirmed && (
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          )}
                          {isFailed && (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                          {isActive && (
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          )}
                          {item.status === "pending" && (
                            <div className="h-5 w-5 rounded-full border-2 border-border/60" />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Fee info */}
                  {bundle.state.totalFeeUnits > 0 &&
                    bundle.completedCount > 0 && (
                      <div className="pt-2 text-center text-xs text-muted-foreground">
                        Fee:{" "}
                        {(bundle.state.totalFeeUnits / 1_000_000).toFixed(4)}{" "}
                        USDC
                      </div>
                    )}

                  {/* Error Summary */}
                  {bundle.hasFailed && !bundle.isExecuting && (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                        <div className="flex-1">
                          <p className="text-sm text-amber-200">
                            {bundle.failedCount} of {bundle.state.items.length}{" "}
                            purchases failed
                          </p>
                          <button
                            type="button"
                            onClick={handleRetry}
                            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-amber-300 hover:text-amber-200"
                          >
                            <RefreshCw className="h-4 w-4" />
                            Retry failed
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CTA Button */}
              <button
                type="button"
                onClick={bundle.isComplete ? closeModal : startPurchase}
                disabled={(!canBuy && !bundle.isComplete) || bundle.isExecuting}
                className={[
                  "w-full rounded-2xl py-4 text-base font-semibold transition border",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
                  bundle.isComplete
                    ? "bg-primary text-primary-foreground border-primary/25 hover:bg-primary/90"
                    : canBuy && !bundle.isExecuting
                      ? "bg-primary text-primary-foreground border-primary/25 hover:bg-primary/90 active:scale-[0.99]"
                      : "bg-card/30 text-muted-foreground border-border/60 cursor-not-allowed",
                ].join(" ")}
              >
                {bundle.isExecuting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {statusLabel}
                  </span>
                ) : bundle.isComplete ? (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    Done ({bundle.completedCount}/{bundle.state.items.length})
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Purchase Bundle
                    <ArrowRight className="h-5 w-5" />
                  </span>
                )}
              </button>

              {/* Footer */}
              {bundle.state.phase === "idle" && (
                <p className="text-center text-xs text-muted-foreground">
                  Sequential execution • One fee for entire bundle
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
