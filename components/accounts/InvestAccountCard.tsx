// components/accounts/InvestAccountCard.tsx
"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useBalance } from "@/providers/BalanceProvider";

const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "";

const formatUsd = (n?: number | null) =>
  n === undefined || n === null || Number.isNaN(n)
    ? "$0.00"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const looksLikeSavings = (t: {
  symbol?: string | null;
  name?: string | null;
}) => `${t.symbol ?? ""} ${t.name ?? ""}`.toLowerCase().includes("savings");

const InvestAccountCard: React.FC = () => {
  const {
    tokens,
    loading,
    usdcUsd,
    boosterTakeHomeUsd,
    boosterPositionsCount,
  } = useBalance();

  // Filter out USDC and savings tokens
  const investTokens = useMemo(() => {
    return (tokens || []).filter((t) => {
      if (!t?.mint) return false;
      const mintLower = (t.mint ?? "").toLowerCase();
      const isUsdcMint =
        USDC_MINT !== "" && mintLower === USDC_MINT.toLowerCase();
      const isUsdcSymbol = (t.symbol ?? "").toUpperCase() === "USDC";
      if (isUsdcMint || isUsdcSymbol) return false;
      if (looksLikeSavings(t)) return false;
      if ((t.usdValue ?? 0) <= 0 && (t.amount ?? 0) <= 0) return false;
      return true;
    });
  }, [tokens]);

  const investSpotUsd = useMemo(
    () => investTokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0),
    [investTokens],
  );

  const investTotalUsd = useMemo(() => {
    const b = Number.isFinite(boosterTakeHomeUsd) ? boosterTakeHomeUsd : 0;
    return investSpotUsd + b;
  }, [investSpotUsd, boosterTakeHomeUsd]);

  const hasAssets =
    investTotalUsd > 0.01 &&
    (investTokens.length > 0 || boosterPositionsCount > 0);

  // Sort tokens by USD value descending
  const sortedTokens = useMemo(() => {
    return [...investTokens].sort(
      (a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0),
    );
  }, [investTokens]);

  const visibleAssets = sortedTokens.slice(0, 5);
  const totalAssetCount = investTokens.length + boosterPositionsCount;
  const hasMoreAssets = totalAssetCount > 5;

  const positionsLabel = useMemo(() => {
    if (!hasAssets) return "No investments yet";
    return `${totalAssetCount} position${totalAssetCount === 1 ? "" : "s"}`;
  }, [hasAssets, totalAssetCount]);

  return (
    <div className="haven-card flex h-full w-full flex-col p-4 sm:p-6">
      {/* Header: Balance + View Portfolio */}
      <Link
        href="/invest"
        className="flex items-center justify-between group"
        aria-label="View portfolio"
      >
        <div>
          <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {loading ? "…" : formatUsd(investTotalUsd)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {positionsLabel}
          </p>
        </div>

        <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          <span>View portfolio</span>
          <ChevronRight className="h-4 w-4 opacity-70 group-hover:opacity-100 transition" />
        </div>
      </Link>

      {/* Asset List */}
      <div className="mt-5 flex-1">
        {hasAssets ? (
          <div className="space-y-2">
            {visibleAssets.map((t, idx) => (
              <div
                key={t.mint ?? `${t.symbol}-${idx}`}
                className="flex items-center justify-between py-1.5"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 overflow-hidden rounded-full border border-border bg-card shadow-fintech-sm flex items-center justify-center">
                    {t.logoURI ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.logoURI}
                        alt={t.symbol || "Token"}
                        width={32}
                        height={32}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {(t.symbol || "?").slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {(t.symbol || t.name || "Unknown").toUpperCase()}
                  </p>
                </div>
                <p className="text-sm font-medium text-foreground">
                  {formatUsd(t.usdValue)}
                </p>
              </div>
            ))}

            {/* Show multiplier summary if any */}
            {boosterPositionsCount > 0 && visibleAssets.length < 5 && (
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 overflow-hidden rounded-full border border-border bg-card shadow-fintech-sm flex items-center justify-center">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      M
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    Multipliers ({boosterPositionsCount})
                  </p>
                </div>
                <p className="text-sm font-medium text-foreground">
                  {formatUsd(boosterTakeHomeUsd)}
                </p>
              </div>
            )}

            {hasMoreAssets && (
              <Link
                href="/invest"
                className="flex items-center justify-center gap-1 py-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                <span>View all</span>
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        ) : (
          <Link
            href="/bundles"
            className="flex flex-col items-center justify-center py-6 text-center group"
          >
            <p className="text-sm text-muted-foreground">
              {usdcUsd > 0
                ? "You're holding USDC — move some into investments."
                : "Start building your portfolio"}
            </p>
            <div className="mt-2 flex items-center gap-1 text-sm font-medium text-primary group-hover:text-primary/80 transition-colors">
              <span>Explore investments</span>
              <ChevronRight className="h-4 w-4" />
            </div>
          </Link>
        )}
      </div>
    </div>
  );
};

export default InvestAccountCard;
