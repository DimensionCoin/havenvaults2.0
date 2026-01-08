// components/bundles/BundlesPanel.tsx
"use client";

import React, { useMemo, useState, useCallback } from "react";
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
  Filter,
} from "lucide-react";

import { BUNDLES, type RiskLevel } from "./bundlesConfig";
import { findTokenBySymbol, requireMintBySymbol } from "@/lib/tokenConfig";
import { useServerSponsoredUsdcSwap } from "@/hooks/useServerSponsoredUsdcSwap";
import { useBalance } from "@/providers/BalanceProvider";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  ownerBase58: string;
};

type BuyRow = {
  symbol: string;
  status:
    | "idle"
    | "building"
    | "signing"
    | "sending"
    | "confirming"
    | "done"
    | "error";
  sig?: string;
  error?: string;
  amountDisplay: number;
};

// Risk icon mapping
function getRiskIcon(risk: RiskLevel) {
  if (risk === "low") return Shield;
  if (risk === "medium") return TrendingUp;
  if (risk === "high") return Zap;
  if (risk === "degen") return Sparkles;
  return Sparkles;
}

// Haven-style risk pill
function riskPill(risk: RiskLevel) {
  const Icon = getRiskIcon(risk);

  const configs: Record<
    RiskLevel,
    { bg: string; border: string; text: string; glow: string }
  > = {
    low: {
      bg: "bg-gradient-to-r from-emerald-500/12 to-teal-500/12",
      border: "border-emerald-400/25",
      text: "text-emerald-200",
      glow: "shadow-[0_0_12px_rgba(16,185,129,0.12)]",
    },
    medium: {
      bg: "bg-gradient-to-r from-emerald-500/12 to-teal-500/12",
      border: "border-emerald-400/25",
      text: "text-emerald-200",
      glow: "shadow-[0_0_12px_rgba(16,185,129,0.12)]",
    },
    high: {
      bg: "bg-gradient-to-r from-emerald-500/12 to-teal-500/12",
      border: "border-emerald-400/25",
      text: "text-emerald-200",
      glow: "shadow-[0_0_12px_rgba(16,185,129,0.12)]",
    },
    degen: {
      bg: "bg-gradient-to-r from-emerald-500/12 to-teal-500/12",
      border: "border-emerald-400/25",
      text: "text-emerald-200",
      glow: "shadow-[0_0_12px_rgba(16,185,129,0.12)]",
    },
  };

  const config = configs[risk];

  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all",
        config.bg,
        config.border,
        config.text,
        config.glow,
      ].join(" ")}
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

// Compact token icons
function TokenIconsCompact({ symbols }: { symbols: string[] }) {
  const shown = symbols.slice(0, 4);
  const extra = Math.max(0, symbols.length - shown.length);

  return (
    <div className="flex items-center">
      <div className="flex -space-x-3">
        {shown.map((s, idx) => {
          const meta = findTokenBySymbol(s);
          return (
            <div
              key={s}
              className="group/icon relative h-8 w-8 overflow-hidden rounded-full border-2 border-black/50 bg-gradient-to-br from-white/10 to-white/5 transition-all hover:scale-110 hover:z-10"
              title={s}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <Image
                src={meta?.logo || "/placeholder.svg"}
                alt={`${s} logo`}
                fill
                className="object-cover transition-transform group-hover/icon:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity group-hover/icon:opacity-100" />
            </div>
          );
        })}
      </div>

      {extra > 0 && (
        <div className="ml-2.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-300/15 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm">
          <span className="text-[11px] font-bold text-white/80">+{extra}</span>
        </div>
      )}
    </div>
  );
}

export default function BundlesPanel({ ownerBase58 }: Props) {
  const swap = useServerSponsoredUsdcSwap();

  // Get balance from provider - this is the correct source!
  const { usdcUsd, displayCurrency, fxRate } = useBalance();

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

  const [rows, setRows] = useState<BuyRow[]>([]);
  const busy = swap.isBusy;

  // Available balance is USDC in display currency
  const availableBalance = usdcUsd;

  const canBuy = useMemo(() => {
    const amt = Number(amountDisplay);
    if (!ownerBase58) return false;
    if (!selected) return false;
    if (!Number.isFinite(amt) || amt <= 0) return false;
    if (amt > availableBalance) return false;
    if ((selected.symbols?.length ?? 0) < 3) return false;
    return true;
  }, [amountDisplay, ownerBase58, selected, availableBalance]);

  const openBundle = useCallback(
    (id: string) => {
      setSelectedId(id);
      setRows([]);
      swap.reset?.();
      setOpen(true);
    },
    [swap]
  );

  const closeModal = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  const startBundleBuy = useCallback(async () => {
    if (!canBuy || !selected) return;

    const amt = Number(amountDisplay);
    const symbols = selected.symbols;
    const per = amt / symbols.length;

    setRows(
      symbols.map((symbol) => ({
        symbol,
        status: "idle",
        amountDisplay: per,
      }))
    );

    for (const symbol of symbols) {
      const outputMint = requireMintBySymbol(symbol);

      setRows((prev) =>
        prev.map((r) =>
          r.symbol === symbol ? { ...r, status: "building" } : r
        )
      );

      try {
        setRows((prev) =>
          prev.map((r) =>
            r.symbol === symbol ? { ...r, status: "signing" } : r
          )
        );

        const res = await swap.swap({
          kind: "buy",
          fromOwnerBase58: ownerBase58,
          outputMint,
          amountDisplay: per,
          fxRate,
          slippageBps: 50,
        });

        setRows((prev) =>
          prev.map((r) =>
            r.symbol === symbol
              ? { ...r, status: "done", sig: res.signature }
              : r
          )
        );
      } catch (e) {
        const msg = String((e as Error)?.message || "Swap failed");
        setRows((prev) =>
          prev.map((r) =>
            r.symbol === symbol ? { ...r, status: "error", error: msg } : r
          )
        );
      }
    }
  }, [canBuy, selected, amountDisplay, ownerBase58, fxRate, swap]);

  const allDone = rows.length > 0 && rows.every((r) => r.status === "done");
  const progress =
    rows.length > 0
      ? (rows.filter((r) => r.status === "done").length / rows.length) * 100
      : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-black/40 via-black/30 to-black/40 p-6 shadow-2xl backdrop-blur-xl">
      {/* Haven green ambient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/6 via-transparent to-teal-500/6 opacity-60" />
      <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-teal-500/10 blur-3xl" />

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 shadow-lg shadow-emerald-500/10">
                <Sparkles className="h-4 w-4 text-emerald-200" />
              </div>
              <h3 className="text-lg font-bold tracking-tight text-white/95">
                Curated Bundles
              </h3>
            </div>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/50">
              Diversify instantly with expert-curated portfolios. One-tap
              balanced exposure.
            </p>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="mt-5 space-y-3">
          {/* Search */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <Search className="h-4 w-4 text-white/40" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bundles, assets..."
              className="w-full rounded-xl border border-white/10 bg-black/30 py-3 pl-11 pr-10 text-sm text-white/90 placeholder:text-white/40 outline-none transition-all focus:border-emerald-400/30 focus:bg-black/40 focus:shadow-lg focus:shadow-emerald-500/10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-white/40 transition-colors hover:text-white/70"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Risk pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <Filter className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap font-semibold">Risk:</span>
            </div>

            {(["all", "low", "medium", "high", "degen"] as const).map(
              (risk) => {
                const isActive = selectedRiskFilter === risk;
                const Icon =
                  risk === "all" ? Sparkles : getRiskIcon(risk as RiskLevel);

                return (
                  <button
                    key={risk}
                    type="button"
                    onClick={() => setSelectedRiskFilter(risk)}
                    className={[
                      "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all",
                      isActive
                        ? "border-emerald-400/40 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-200 shadow-lg shadow-emerald-500/20"
                        : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:bg-white/10 hover:text-white/70",
                    ].join(" ")}
                  >
                    <Icon className="h-3 w-3" />
                    {risk}
                  </button>
                );
              }
            )}
          </div>

          {/* Count + clear */}
          {(searchQuery || selectedRiskFilter !== "all") && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50">
                {filteredBundles.length}{" "}
                {filteredBundles.length === 1 ? "bundle" : "bundles"} found
              </span>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedRiskFilter("all");
                }}
                className="font-semibold text-emerald-300/70 transition-colors hover:text-emerald-300"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Bundle grid */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {filteredBundles.length === 0 ? (
            <div className="col-span-2 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.02] to-transparent p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
                <Search className="h-6 w-6 text-white/40" />
              </div>
              <p className="text-sm font-semibold text-white/60">
                No bundles found
              </p>
              <p className="mt-1 text-xs text-white/40">
                Try adjusting your search or filters
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedRiskFilter("all");
                }}
                className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/70 transition-all hover:bg-white/10 hover:text-white"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            filteredBundles.map((b, idx) => {
              const Icon = getRiskIcon(b.risk);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => openBundle(b.id)}
                  style={{ animationDelay: `${idx * 75}ms` }}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-4 text-left transition-all duration-300 hover:scale-[1.02] hover:border-white/20 hover:shadow-xl hover:shadow-emerald-500/5 active:scale-[0.98]"
                >
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-teal-500/0 opacity-0 transition-opacity duration-300 group-hover:from-emerald-500/10 group-hover:to-teal-500/10 group-hover:opacity-100" />

                  <div className="relative z-10">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <Icon className="h-4 w-4 text-white/60 transition-colors group-hover:text-white/80" />
                          <h4 className="truncate text-sm font-bold text-white/90 transition-colors group-hover:text-white">
                            {b.name}
                          </h4>
                        </div>
                        <p className="line-clamp-2 text-xs text-white/40 transition-colors group-hover:text-white/50">
                          {b.subtitle}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <TokenIconsCompact symbols={b.symbols} />
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2">
                      {riskPill(b.risk)}
                      <div className="text-[11px] font-semibold text-white/40">
                        {b.symbols.length} assets
                      </div>
                    </div>
                  </div>

                  {/* Shine */}
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Modal */}
      <Dialog
        open={open}
        onOpenChange={(v) => (v ? setOpen(true) : closeModal())}
      >
        <DialogContent className="max-w-xl rounded-3xl border border-white/10 bg-black/90 p-0 text-white shadow-2xl backdrop-blur-2xl sm:max-w-2xl">
          {/* Progress */}
          {rows.length > 0 && (
            <div className="absolute left-0 right-0 top-0 h-1 overflow-hidden rounded-t-3xl bg-white/5">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <div className="p-6 sm:p-8">
            <DialogHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    {selected && (
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
                        {React.createElement(getRiskIcon(selected.risk), {
                          className: "h-5 w-5 text-emerald-200",
                        })}
                      </div>
                    )}
                    <div>
                      <DialogTitle className="text-xl font-bold text-white/95">
                        {selected?.name ?? "Bundle"}
                      </DialogTitle>
                      <div className="mt-1 text-sm text-white/50">
                        {selected?.subtitle ?? ""}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={busy}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </DialogHeader>

            <div className="mt-6 flex items-center justify-between">
              {selected && (
                <div className="flex items-center gap-4">
                  <TokenIconsCompact symbols={selected.symbols} />
                  {riskPill(selected.risk)}
                </div>
              )}
            </div>

            {/* Amount */}
            <div className="mt-6 rounded-2xl border border-white/15 bg-gradient-to-br from-white/5 to-white/[0.02] p-5 transition-all focus-within:border-emerald-400/30 focus-within:shadow-lg focus-within:shadow-emerald-500/10">
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">
                Investment Amount
              </label>

              <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3 transition-all focus-within:border-emerald-400/30 focus-within:bg-black/40">
                <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70">
                  {displayCurrency}
                </span>
                <input
                  value={amountDisplay}
                  inputMode="decimal"
                  onChange={(e) =>
                    setAmountDisplay(cleanNumberInput(e.target.value))
                  }
                  placeholder="0.00"
                  disabled={busy}
                  className="flex-1 bg-transparent text-lg font-semibold text-white/95 outline-none placeholder:text-white/30 disabled:opacity-60"
                />
              </div>

              {/* Available Balance - now correctly from useBalance */}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-white/40">Available Balance</span>
                <button
                  type="button"
                  onClick={() => setAmountDisplay(availableBalance.toFixed(2))}
                  disabled={busy}
                  className="font-semibold text-emerald-300/70 transition-colors hover:text-emerald-300 disabled:opacity-50"
                >
                  {availableBalance.toFixed(2)} {displayCurrency}
                </button>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-5 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400/60" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/60">
                    Distribution
                  </h4>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/50">
                  Equal weight
                </div>
              </div>

              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white/95">
                  {perTokenDisplay > 0 ? perTokenDisplay.toFixed(2) : "0.00"}
                </span>
                <span className="text-sm text-white/50">
                  {displayCurrency} per asset
                </span>
              </div>

              <div className="mt-4 space-y-2">
                {(selected?.symbols ?? []).map((s, idx) => {
                  const meta = findTokenBySymbol(s);
                  return (
                    <div
                      key={s}
                      style={{ animationDelay: `${idx * 40}ms` }}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3 transition-all hover:bg-black/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative h-7 w-7 overflow-hidden rounded-full border-2 border-white/10 bg-gradient-to-br from-white/10 to-white/5">
                          <Image
                            src={meta?.logo || "/placeholder.svg"}
                            alt={`${s} logo`}
                            fill
                            className="object-cover"
                          />
                        </div>
                        <span className="text-sm font-bold text-white/85">
                          {s}
                        </span>
                      </div>

                      <span className="text-sm font-semibold text-white/60">
                        {perTokenDisplay > 0
                          ? perTokenDisplay.toFixed(2)
                          : "0.00"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CTA */}
            <button
              type="button"
              onClick={startBundleBuy}
              disabled={!canBuy || busy}
              className={[
                "group relative mt-6 w-full overflow-hidden rounded-2xl px-6 py-4 text-base font-bold transition-all duration-300",
                canBuy && !busy
                  ? "border border-emerald-400/30 bg-gradient-to-r from-emerald-500/20 via-teal-500/20 to-emerald-500/20 text-emerald-100 shadow-lg shadow-emerald-500/20 hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-500/30 active:scale-[0.98]"
                  : "cursor-not-allowed border border-white/10 bg-white/5 text-white/35",
              ].join(" ")}
            >
              {canBuy && !busy && (
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
              )}

              <span className="relative flex items-center justify-center gap-2.5">
                {busy ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Executing Bundle Purchase
                  </>
                ) : allDone ? (
                  <>
                    <CheckCircle2 className="h-5 w-5" />
                    Bundle Complete
                  </>
                ) : (
                  <>
                    Purchase Bundle
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </span>
            </button>

            {!busy && rows.length === 0 && (
              <p className="mt-3 text-center text-xs text-white/40">
                Atomic execution • Each asset secured individually
              </p>
            )}

            {/* Execution */}
            {rows.length > 0 && (
              <div className="mt-6">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/60">
                    Transaction Status
                  </h4>
                  <div className="text-xs font-semibold text-white/50">
                    {rows.filter((r) => r.status === "done").length} of{" "}
                    {rows.length} complete
                  </div>
                </div>

                <div className="max-h-60 space-y-2.5 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {rows.map((r, idx) => {
                    const meta = findTokenBySymbol(r.symbol);
                    const ok = r.status === "done";
                    const bad = r.status === "error";
                    const active = !ok && !bad;

                    return (
                      <div
                        key={r.symbol}
                        style={{ animationDelay: `${idx * 50}ms` }}
                        className={[
                          "flex items-center justify-between gap-4 rounded-xl border p-4 transition-all duration-300",
                          ok ? "border-emerald-400/30 bg-emerald-500/10" : "",
                          bad ? "border-rose-400/30 bg-rose-500/10" : "",
                          active
                            ? "animate-pulse border-white/10 bg-white/5"
                            : "",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative h-9 w-9 overflow-hidden rounded-full border-2 border-white/10 bg-gradient-to-br from-white/10 to-white/5">
                            <Image
                              src={meta?.logo || "/placeholder.svg"}
                              alt={`${r.symbol} logo`}
                              fill
                              className="object-cover"
                            />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white/90">
                              {r.symbol}
                            </div>
                            <div className="text-xs text-white/45">
                              {r.amountDisplay.toFixed(2)} {displayCurrency}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          {ok && (
                            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                          )}
                          {bad && <XCircle className="h-5 w-5 text-rose-300" />}
                          {active && (
                            <Loader2 className="h-5 w-5 animate-spin text-white/60" />
                          )}

                          <span
                            className={[
                              "text-xs font-semibold",
                              ok ? "text-emerald-300" : "",
                              bad ? "text-rose-300" : "",
                              active ? "text-white/60" : "",
                            ].join(" ")}
                          >
                            {ok ? "Complete" : bad ? "Failed" : r.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {swap.error && (
                  <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-300" />
                      <div className="text-sm text-rose-200/90">
                        {swap.error.message}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
