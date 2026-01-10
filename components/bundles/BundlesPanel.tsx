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
  Info,
} from "lucide-react";

import { BUNDLES, type RiskLevel } from "./bundlesConfig";
import { findTokenBySymbol, requireMintBySymbol } from "@/lib/tokenConfig";
import { useBalance } from "@/providers/BalanceProvider";
import { useBundleSwap } from "@/hooks/useBundleSwap";

import {
  Dialog,
  DialogContent,
  DialogHeader,
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
  if (risk === "low") return "Low risk";
  if (risk === "medium") return "Medium risk";
  if (risk === "high") return "High risk";
  return "Degen";
}

function riskClasses(risk: RiskLevel) {
  if (risk === "low") return "border-primary/25 bg-primary/10 text-foreground";
  if (risk === "medium") return "border-border/60 bg-card/40 text-foreground";
  if (risk === "high")
    return "border-amber-500/25 bg-amber-500/10 text-foreground";
  return "border-destructive/25 bg-destructive/10 text-foreground";
}

function riskPill(risk: RiskLevel) {
  const Icon = getRiskIcon(risk);
  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5",
        "text-[11px] font-bold uppercase tracking-wider backdrop-blur",
        riskClasses(risk),
      ].join(" ")}
    >
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

// ✅ Uses narrowSymbol so CAD renders like "$28.00" (not "CA$28.00")
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
              className="relative h-9 w-9 overflow-hidden rounded-full border-2 border-background/70 bg-card shadow-fintech-sm"
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
        <div className="ml-2 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/40 shadow-fintech-sm">
          <span className="text-[11px] font-bold text-muted-foreground">
            +{extra}
          </span>
        </div>
      )}
    </div>
  );
}

function TokenIconsRow({ symbols }: { symbols: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {symbols.map((s) => {
        const meta = findTokenBySymbol(s);
        return (
          <div
            key={s}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/30 px-3 py-2"
          >
            <div className="relative h-5 w-5 overflow-hidden rounded-full border border-border/60 bg-card">
              <Image
                src={meta?.logo || "/placeholder.svg"}
                alt={s}
                fill
                className="object-cover"
              />
            </div>
            <span className="text-[12px] font-semibold text-foreground/90">
              {s}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN
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

  const amountNumber = useMemo(() => {
    const n = Number(amountDisplay);
    return Number.isFinite(n) ? n : 0;
  }, [amountDisplay]);

  const perTokenDisplay = useMemo(() => {
    const n = selected?.symbols.length ?? 0;
    if (!Number.isFinite(amountNumber) || amountNumber <= 0 || n <= 0) return 0;
    return amountNumber / n;
  }, [amountNumber, selected]);

  const canBuy = useMemo(() => {
    if (!ownerBase58) return false;
    if (!selected) return false;
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return false;
    if (amountNumber > availableBalance) return false;
    if ((selected.symbols?.length ?? 0) < 2) return false;
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
    // ✅ refresh balance provider after a successful bundle buy
    await refreshNow().catch(() => {});
    closeModal();
  }, [refreshNow, closeModal]);

  const startPurchase = useCallback(async () => {
    if (!canBuy || !selected || bundle.isExecuting) return;

    // amountDisplay is in display currency
    const perUsd = amountNumber / (fxRate || 1) / selected.symbols.length;

    const swaps = selected.symbols.map((symbol) => ({
      symbol,
      outputMint: requireMintBySymbol(symbol),
      amountUsd: perUsd,
    }));

    await bundle.execute(ownerBase58, swaps);
  }, [canBuy, selected, amountNumber, fxRate, bundle, ownerBase58]);

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

  return (
    <>
      {/* ───────────────── Top / Header strip ───────────────── */}
      <div className="haven-glass p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-card/40 glow-mint">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>

            <div className="min-w-0">
              <p className="haven-kicker">INVEST</p>
              <h3 className="text-[18px] font-semibold leading-tight text-foreground">
                Bundles
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                One click portfolios — one purchase, multiple assets.
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Available</p>
            <p className="text-[14px] font-semibold text-foreground">
              {formatMoney(availableBalance, displayCurrency)}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bundles, tokens, themes…"
            className="haven-input pl-10"
          />
        </div>

        {/* Filters */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(["all", "low", "medium", "high", "degen"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setSelectedRiskFilter(risk)}
              className={[
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition border",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                selectedRiskFilter === risk
                  ? "bg-primary/15 text-primary border-primary/25"
                  : "bg-card/30 text-muted-foreground border-border/60 hover:text-foreground hover:bg-card/50",
              ].join(" ")}
            >
              {risk}
            </button>
          ))}
        </div>
      </div>

      {/* ───────────────── List ───────────────── */}
      <div className="mt-4 grid gap-3">
        {filteredBundles.length === 0 ? (
          <div className="haven-card p-6 text-center">
            <p className="text-sm font-medium text-foreground">
              No bundles found
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different keyword or risk filter.
            </p>
          </div>
        ) : (
          filteredBundles.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => openBundle(b.id)}
              className={[
                "haven-row",
                "text-left transition",
                "hover:bg-accent/60 hover:border-border",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
              ].join(" ")}
            >
              <div className="flex items-center gap-3 min-w-0">
                <TokenIconsCompact symbols={b.symbols} />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">
                    {b.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {b.subtitle} • {b.symbols.length} assets
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {riskPill(b.risk)}
                <div className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/30 text-muted-foreground">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* ───────────────── Modal (safe-area, pinned CTA) ───────────────── */}
      <Dialog
        open={open}
        onOpenChange={(v) => (v ? setOpen(true) : closeModal())}
      >
        <DialogContent
          className={[
            "p-0 overflow-hidden flex flex-col",
            "border border-border bg-card text-card-foreground text-foreground shadow-fintech-lg",

            // Desktop sizing
            "sm:w-[min(92vw,520px)] sm:max-w-[520px]",
            "sm:max-h-[90vh] sm:rounded-[28px]",

            // Mobile fullscreen
            "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
            "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
            "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",
          ].join(" ")}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Progress */}
            {bundle.state.items.length > 0 && (
              <div className="h-1 w-full bg-foreground/5">
                <div
                  className="h-full bg-primary/70 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {/* Scroll body */}
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar overscroll-contain px-3 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] sm:px-5 sm:pb-5 sm:pt-5">
              <DialogHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {selected ? (
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-card/40 glow-mint">
                        {React.createElement(getRiskIcon(selected.risk), {
                          className: "h-5 w-5 text-primary",
                        })}
                      </div>
                    ) : null}

                    <div className="min-w-0">
                      <DialogTitle className="text-base font-semibold text-foreground">
                        {selected?.name ?? "Bundle"}
                      </DialogTitle>
                      <DialogDescription className="mt-0.5 text-[11px] text-muted-foreground">
                        {selected?.symbols.length ?? 0} assets •{" "}
                        {riskLabel((selected?.risk as RiskLevel) ?? "low")}
                      </DialogDescription>
                    </div>
                  </div>

                  {selected ? riskPill(selected.risk) : null}
                </div>
              </DialogHeader>

              {/* Bundle info */}
              {selected?.symbols?.length ? (
                <div className="haven-card-soft px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-foreground">
                        What you’re buying
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Equal-weight allocation across the bundle.
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/30 px-2.5 py-1 text-[10px] text-muted-foreground">
                      <Info className="h-3.5 w-3.5" />1 fee total
                    </div>
                  </div>
                  <TokenIconsRow symbols={selected.symbols} />
                </div>
              ) : null}

              <div className="mt-4 space-y-4">
                {/* Amount */}
                {bundle.state.phase === "idle" && (
                  <div className="haven-card-soft p-4">
                    <label className="mb-2 block text-[11px] font-medium text-muted-foreground">
                      Investment Amount
                    </label>

                    <div className="flex items-end justify-between gap-3">
                      <div className="flex items-end gap-2">
                        <span className="mb-[2px] text-[12px] font-semibold text-muted-foreground">
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
                          className="w-[170px] bg-transparent text-3xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setAmountDisplay(availableBalance.toFixed(2))
                        }
                        className="haven-pill haven-pill-positive hover:bg-primary/15"
                      >
                        Max: {formatMoney(availableBalance, displayCurrency)}
                      </button>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Available</span>
                      <span className="font-semibold text-foreground">
                        {formatMoney(availableBalance, displayCurrency)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Distribution */}
                {bundle.state.phase === "idle" && perTokenDisplay > 0 && (
                  <div className="haven-card-soft p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        Distribution
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Equal weight
                      </span>
                    </div>

                    <div className="space-y-2">
                      {(selected?.symbols ?? []).map((s) => {
                        const meta = findTokenBySymbol(s);
                        return (
                          <div
                            key={s}
                            className="flex items-center justify-between py-1"
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
                              <span className="text-[12px] font-semibold text-foreground/90">
                                {s}
                              </span>
                            </div>

                            <span className="text-[12px] text-muted-foreground">
                              {perTokenDisplay.toFixed(2)} {displayCurrency}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Execution */}
                {bundle.state.items.length > 0 && (
                  <div className="space-y-2">
                    {bundle.isExecuting && (
                      <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        {statusLabel}
                      </div>
                    )}

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

                    {bundle.hasFailed && !bundle.isExecuting && (
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                          <div className="flex-1">
                            <p className="text-sm text-amber-200">
                              {bundle.failedCount} of{" "}
                              {bundle.state.items.length} purchases failed
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
              </div>

              {bundle.state.phase === "idle" && (
                <p className="mt-4 text-center text-[11px] text-muted-foreground">
                  Sequential execution • One fee for the entire bundle
                </p>
              )}
            </div>

            {/* Pinned footer */}
            <DialogFooter className="shrink-0 border-t border-border bg-card/95 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+14px)] sm:px-5 sm:pb-5">
              <button
                type="button"
                onClick={bundle.isComplete ? closeAndRefresh : startPurchase}
                disabled={(!canBuy && !bundle.isComplete) || bundle.isExecuting}
                className={[
                  "haven-btn-primary",
                  (!canBuy && !bundle.isComplete) || bundle.isExecuting
                    ? "opacity-60"
                    : "",
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
                    Purchase bundle
                    <ArrowRight className="h-5 w-5" />
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
