// components/bundles/UserBundles.tsx
"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
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
  Lock,
  Globe,
  User,
  Trash2,
  MoreVertical,
  Eye,
  EyeOff,
  X,
} from "lucide-react";

import { findTokenBySymbol, requireMintBySymbol } from "@/lib/tokenConfig";
import { useBalance } from "@/providers/BalanceProvider";
import { useBundleSwap } from "@/hooks/useBundleSwap";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import MakeBundle from "./MakeBundle";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

type RiskLevel = "low" | "medium" | "high" | "degen";
type Visibility = "public" | "private";

type BundleAllocation = {
  symbol: string;
  weight: number;
};

type BundleCreator = {
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
};

type UserBundle = {
  _id: string;
  userId: string;
  name: string;
  subtitle?: string;
  allocations: BundleAllocation[];
  risk: RiskLevel;
  kind: "stocks" | "crypto" | "mixed";
  visibility: Visibility;
  totalPurchases: number;
  totalVolume: string;
  createdAt: string;
  creator?: BundleCreator;
};

type Props = {
  ownerBase58: string;
  currentUserId?: string;
};

type FilterMode = "all" | "mine" | "public";

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

function getRiskIcon(risk: RiskLevel) {
  if (risk === "low") return Shield;
  if (risk === "medium") return TrendingUp;
  if (risk === "high") return Zap;
  return Sparkles;
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

function riskLabel(risk: RiskLevel) {
  if (risk === "low") return "Conservative";
  if (risk === "medium") return "Balanced";
  if (risk === "high") return "Aggressive";
  return "Speculative";
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLED COMPONENTS
═══════════════════════════════════════════════════════════════════════════ */

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

function TokenStack({
  allocations,
  size = "md",
}: {
  allocations: BundleAllocation[];
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

function CreatorBadge({
  creator,
  isOwn,
}: {
  creator?: BundleCreator;
  isOwn: boolean;
}) {
  if (isOwn) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-[10px] font-medium text-primary">
        <User className="h-3 w-3" />
        You
      </span>
    );
  }

  if (!creator) return null;

  const name =
    [creator.firstName, creator.lastName].filter(Boolean).join(" ") ||
    "Anonymous";

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-[10px] font-medium text-muted-foreground">
      <User className="h-3 w-3" />
      {name}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXECUTION STEP
═══════════════════════════════════════════════════════════════════════════ */

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

export default function UserBundles({ ownerBase58, currentUserId }: Props) {
  const { usdcUsd, displayCurrency, fxRate, refreshNow } = useBalance();
  const availableBalance = usdcUsd || 0;

  const bundle = useBundleSwap();

  // Data state
  const [userBundles, setUserBundles] = useState<UserBundle[]>([]);
  const [publicBundles, setPublicBundles] = useState<UserBundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<
    RiskLevel | "all"
  >("all");

  // Modal state
  const [open, setOpen] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState<UserBundle | null>(null);
  const [amountDisplay, setAmountDisplay] = useState<string>("");

  // Action state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(
    null,
  );

  // Fetch data
  const fetchBundles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const userPromise = currentUserId
        ? fetch("/api/bundle/user").then((r) => r.json())
        : Promise.resolve({ bundles: [] });

      const publicPromise = fetch("/api/bundle/public?limit=50").then((r) =>
        r.json(),
      );

      const [userData, publicData] = await Promise.all([
        userPromise,
        publicPromise,
      ]);

      if (userData.bundles) {
        setUserBundles(userData.bundles);
      }

      if (publicData.bundles) {
        setPublicBundles(publicData.bundles);
      }
    } catch (e) {
      setError("Failed to load bundles");
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchBundles();
  }, [fetchBundles]);

  // Combine and filter bundles
  const displayedBundles = useMemo(() => {
    let combined: UserBundle[] = [];

    if (filterMode === "mine") {
      combined = userBundles;
    } else if (filterMode === "public") {
      combined = publicBundles.filter((b) => b.userId !== currentUserId);
    } else {
      const userIds = new Set(userBundles.map((b) => b._id));
      const publicFiltered = publicBundles.filter((b) => !userIds.has(b._id));
      combined = [...userBundles, ...publicFiltered];
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      combined = combined.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          (b.subtitle && b.subtitle.toLowerCase().includes(q)) ||
          b.allocations.some((a) => a.symbol.toLowerCase().includes(q)),
      );
    }

    if (selectedRiskFilter !== "all") {
      combined = combined.filter((b) => b.risk === selectedRiskFilter);
    }

    return combined;
  }, [
    userBundles,
    publicBundles,
    filterMode,
    searchQuery,
    selectedRiskFilter,
    currentUserId,
  ]);

  const amountNumber = useMemo(() => {
    const n = Number(amountDisplay);
    return Number.isFinite(n) ? n : 0;
  }, [amountDisplay]);

  const canBuy = useMemo(() => {
    if (!ownerBase58) return false;
    if (!selectedBundle) return false;
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return false;
    if (amountNumber > availableBalance) return false;
    if ((selectedBundle.allocations?.length ?? 0) < 2) return false;
    return true;
  }, [amountNumber, ownerBase58, selectedBundle, availableBalance]);

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
    (b: UserBundle) => {
      setSelectedBundle(b);
      setAmountDisplay("");
      bundle.reset();
      setOpen(true);
    },
    [bundle],
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
    if (!canBuy || !selectedBundle || bundle.isExecuting) return;

    const totalUsd = amountNumber / (fxRate || 1);

    const swaps = selectedBundle.allocations.map((allocation) => ({
      symbol: allocation.symbol,
      outputMint: requireMintBySymbol(allocation.symbol),
      amountUsd: (totalUsd * allocation.weight) / 100,
    }));

    await bundle.execute(ownerBase58, swaps);
  }, [canBuy, amountNumber, fxRate, bundle, ownerBase58, selectedBundle]);

  const handleDelete = useCallback(
    async (bundleId: string) => {
      if (deletingId) return;

      setDeletingId(bundleId);
      try {
        const res = await fetch(`/api/bundle/${bundleId}`, {
          method: "DELETE",
        });

        if (!res.ok) throw new Error("Failed to delete");

        setUserBundles((prev) => prev.filter((b) => b._id !== bundleId));
        setPublicBundles((prev) => prev.filter((b) => b._id !== bundleId));
      } catch (e) {
        console.error(e);
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  const handleToggleVisibility = useCallback(
    async (bundleId: string, newVisibility: Visibility) => {
      if (togglingVisibility) return;

      setTogglingVisibility(bundleId);
      try {
        const res = await fetch(`/api/bundle/${bundleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: newVisibility }),
        });

        if (!res.ok) throw new Error("Failed to update");

        setUserBundles((prev) =>
          prev.map((b) =>
            b._id === bundleId ? { ...b, visibility: newVisibility } : b,
          ),
        );

        if (newVisibility === "private") {
          setPublicBundles((prev) => prev.filter((b) => b._id !== bundleId));
        } else {
          fetchBundles();
        }
      } catch (e) {
        console.error(e);
      } finally {
        setTogglingVisibility(null);
      }
    },
    [togglingVisibility, fetchBundles],
  );

  const handleRetry = useCallback(async () => {
    await bundle.retryFailed(ownerBase58);
  }, [bundle, ownerBase58]);

  const presets = [25, 50, 100, 250];

  return (
    <>
      {/* ═══════════════ Header Section ═══════════════ */}
      <div className="haven-glass p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 glow-mint">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="haven-kicker">Community</p>
              <h2 className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
                User Bundles
              </h2>
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                Portfolios created by the community
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MakeBundle
              ownerBase58={ownerBase58}
              onBundleCreated={fetchBundles}
            />
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mt-4 sm:mt-5">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search user bundles..."
            className="haven-input pl-11 text-black placeholder:text-black/50"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mt-3 sm:mt-4 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar">
          {currentUserId && (
            <>
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`
                  shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border
                  ${
                    filterMode === "all"
                      ? "bg-primary/15 text-primary border-primary/25"
                      : "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                  }
                `}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("mine")}
                className={`
                  shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border flex items-center gap-1.5
                  ${
                    filterMode === "mine"
                      ? "bg-primary/15 text-primary border-primary/25"
                      : "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                  }
                `}
              >
                <User className="h-3 w-3" />
                My Bundles
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setFilterMode("public")}
            className={`
              shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border flex items-center gap-1.5
              ${
                filterMode === "public"
                  ? "bg-primary/15 text-primary border-primary/25"
                  : "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground"
              }
            `}
          >
            <Globe className="h-3 w-3" />
            Public
          </button>
        </div>

        {/* Risk Filters */}
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar">
          {(["all", "low", "medium", "high", "degen"] as const).map((risk) => (
            <button
              key={risk}
              type="button"
              onClick={() => setSelectedRiskFilter(risk)}
              className={`
                shrink-0 px-3 sm:px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 border
                ${
                  selectedRiskFilter === risk
                    ? "bg-primary/15 text-primary border-primary/25"
                    : "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                }
              `}
            >
              {risk === "all"
                ? "All"
                : risk.charAt(0).toUpperCase() + risk.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════ Bundle Cards ═══════════════ */}
      <div className="mt-3 sm:mt-4 grid gap-3">
        {isLoading ? (
          <div className="haven-card p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading bundles...</p>
          </div>
        ) : error ? (
          <div className="haven-card p-8 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto mb-3" />
            <p className="text-sm text-destructive">{error}</p>
            <button
              type="button"
              onClick={fetchBundles}
              className="mt-3 text-xs text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : displayedBundles.length === 0 ? (
          <div className="haven-card p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary mx-auto mb-3">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {filterMode === "mine"
                ? "You haven't created any bundles yet"
                : "No bundles found"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {filterMode === "mine"
                ? "Create your first bundle to get started"
                : "Try a different search term or filter"}
            </p>
          </div>
        ) : (
          displayedBundles.map((b) => {
            const Icon = getRiskIcon(b.risk);
            const isOwn = b.userId === currentUserId;
            const topWeights = [...b.allocations]
              .sort((a, bb) => bb.weight - a.weight)
              .slice(0, 3);

            return (
              <div
                key={b._id}
                className="haven-row group w-full text-left p-3 sm:p-4 transition-all duration-300 hover:shadow-fintech-md hover:border-primary/20"
              >
                <div className="flex items-start justify-between gap-3 sm:gap-4 w-full">
                  <button
                    type="button"
                    onClick={() => openBundle(b)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 mb-2 sm:mb-3">
                      <div
                        className={`
                          flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl border
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
                          className={`h-4 w-4 ${
                            b.risk === "low"
                              ? "text-primary"
                              : b.risk === "medium"
                                ? "text-foreground"
                                : b.risk === "high"
                                  ? "text-amber-500"
                                  : "text-destructive"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                          {b.name}
                        </h3>
                        <p className="text-[11px] text-muted-foreground">
                          {b.allocations.length} assets
                        </p>
                      </div>
                    </div>

                    {b.subtitle && (
                      <p className="text-xs text-muted-foreground mb-2.5 sm:mb-3 line-clamp-2">
                        {b.subtitle}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-1.5 mb-2.5 sm:mb-3">
                      {topWeights.map((a) => (
                        <span
                          key={a.symbol}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/80 text-[10px] font-medium text-muted-foreground"
                        >
                          {a.symbol}
                          <span className="text-foreground">
                            {Math.round(a.weight)}%
                          </span>
                        </span>
                      ))}
                      {b.allocations.length > 3 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary/80 text-[10px] text-muted-foreground">
                          +{b.allocations.length - 3}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <TokenStack allocations={b.allocations} size="sm" />
                        <CreatorBadge creator={b.creator} isOwn={isOwn} />
                        {isOwn && (
                          <span
                            className={`
                            inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium
                            ${
                              b.visibility === "public"
                                ? "bg-primary/10 text-primary"
                                : "bg-secondary text-muted-foreground"
                            }
                          `}
                          >
                            {b.visibility === "public" ? (
                              <Globe className="h-3 w-3" />
                            ) : (
                              <Lock className="h-3 w-3" />
                            )}
                            {b.visibility}
                          </span>
                        )}
                      </div>
                      <RiskBadge risk={b.risk} />
                    </div>
                  </button>

                  <div className="flex items-start gap-2 shrink-0">
                    {isOwn && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="h-8 w-8 flex items-center justify-center rounded-lg bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem
                            onClick={() =>
                              handleToggleVisibility(
                                b._id,
                                b.visibility === "public"
                                  ? "private"
                                  : "public",
                              )
                            }
                            disabled={togglingVisibility === b._id}
                          >
                            {togglingVisibility === b._id ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : b.visibility === "public" ? (
                              <EyeOff className="h-4 w-4 mr-2" />
                            ) : (
                              <Eye className="h-4 w-4 mr-2" />
                            )}
                            Make{" "}
                            {b.visibility === "public" ? "Private" : "Public"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(b._id)}
                            disabled={deletingId === b._id}
                            className="text-destructive focus:text-destructive"
                          >
                            {deletingId === b._id ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Delete Bundle
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    <button
                      type="button"
                      onClick={() => openBundle(b)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-all duration-300"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
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
          {/* Progress bar */}
          {bundle.state.items.length > 0 && (
            <div className="h-1 w-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-card/95 backdrop-blur px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {selectedBundle && (
                    <div
                      className={`
                        flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl sm:rounded-2xl border
                        ${
                          selectedBundle.risk === "low"
                            ? "bg-primary/10 border-primary/20"
                            : selectedBundle.risk === "medium"
                              ? "bg-accent border-border"
                              : selectedBundle.risk === "high"
                                ? "bg-amber-500/10 border-amber-500/20"
                                : "bg-destructive/10 border-destructive/20"
                        }
                      `}
                    >
                      {React.createElement(getRiskIcon(selectedBundle.risk), {
                        className: `h-4 w-4 sm:h-5 sm:w-5 ${
                          selectedBundle.risk === "low"
                            ? "text-primary"
                            : selectedBundle.risk === "medium"
                              ? "text-foreground"
                              : selectedBundle.risk === "high"
                                ? "text-amber-500"
                                : "text-destructive"
                        }`,
                      })}
                    </div>
                  )}

                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold text-foreground truncate">
                      {selectedBundle?.name ?? "Portfolio"}
                    </DialogTitle>
                    <DialogDescription className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                      {selectedBundle?.allocations.length ?? 0} assets •{" "}
                      {riskLabel(selectedBundle?.risk as RiskLevel)}
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
              {/* Amount Input */}
              {bundle.state.phase === "idle" && selectedBundle && (
                <div className="haven-card-soft p-4 mb-4">
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
              {bundle.state.phase === "idle" && selectedBundle && (
                <div className="haven-card-soft p-4">
                  <label className="haven-kicker block mb-3">Allocations</label>
                  <div className="space-y-2">
                    {selectedBundle.allocations.map((a) => {
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
                            You can retry the failed transactions
                          </p>
                          <button
                            type="button"
                            onClick={handleRetry}
                            className="
                              mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl
                              bg-amber-500/10 border border-amber-500/20
                              text-sm font-medium text-amber-600 dark:text-amber-400
                              hover:bg-amber-500/20 active:scale-95
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

            {/* Footer */}
            <DialogFooter className="shrink-0 border-t border-border bg-card px-4 sm:px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
              {bundle.state.phase === "idle" && (
                <p className="text-[11px] text-muted-foreground text-center mb-3">
                  Sequential execution •{" "}
                  {selectedBundle?.allocations.length ?? 0} swaps
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
