// components/accounts/InvestAccountCard.tsx
"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useBalance } from "@/providers/BalanceProvider";

const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || ""; // build-time constant

const formatUsd = (n?: number | null) =>
  n === undefined || n === null || Number.isNaN(n)
    ? "$0.00"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const InvestAccountCard: React.FC = () => {
  const {
    tokens,
    loading,
    usdcUsd,
    boosterTakeHomeUsd,
    boosterPositionsCount,
  } = useBalance();

  // 🔹 Filter out USDC (by mint + symbol, same pattern as HoldingsTable)
  const nonUsdcTokens = useMemo(() => {
    return (tokens || []).filter((t) => {
      const mintLower = t.mint.toLowerCase();
      const isUsdcMint =
        USDC_MINT !== "" && mintLower === USDC_MINT.toLowerCase();

      const isUsdcSymbol = (t.symbol ?? "").toUpperCase() === "USDC";

      return !(isUsdcMint || isUsdcSymbol);
    });
  }, [tokens]);

  // non-USDC side = invest portfolio (spot investments)
  const investSpotUsd = useMemo(
    () => nonUsdcTokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0),
    [nonUsdcTokens]
  );

  // ✅ add boosted “take-home” equity to invest total
  const investTotalUsd = useMemo(() => {
    const b = Number.isFinite(boosterTakeHomeUsd) ? boosterTakeHomeUsd : 0;
    return investSpotUsd + b;
  }, [investSpotUsd, boosterTakeHomeUsd]);

  const hasAssets =
    investTotalUsd > 0.01 &&
    (nonUsdcTokens.length > 0 || boosterPositionsCount > 0);

  const visibleTokens = nonUsdcTokens.slice(0, 3);
  const extraCount =
    nonUsdcTokens.length > visibleTokens.length
      ? nonUsdcTokens.length - visibleTokens.length
      : 0;

  const positionsLabel = useMemo(() => {
    const spotCount = nonUsdcTokens.length;
    const boosterCount = boosterPositionsCount;

    if (!hasAssets) return "Tap to start investing with Haven";

    if (spotCount > 0 && boosterCount > 0) {
      return `${spotCount} Asset${spotCount === 1 ? "" : "s"} + ${
        boosterCount
      } Multiplied position${boosterCount === 1 ? "" : "s"}`;
    }

    if (boosterCount > 0) {
      return `${boosterCount} Multiplied position${boosterCount === 1 ? "" : "s"}`;
    }

    return `${spotCount} Asset${spotCount === 1 ? "" : "s"} in your portfolio`;
  }, [hasAssets, nonUsdcTokens.length, boosterPositionsCount]);

  return (
    <Link
      href="/invest"
      className="block h-full w-full"
      aria-label="Open Invest page"
    >
      <div className="haven-card flex h-full w-full flex-col justify-between p-4 sm:p-6 transition hover:shadow-fintech-lg">
        {/* Header + value (same layout) */}
        <div>
          <p className="haven-kicker">Invest Account</p>

          <div className="mt-4">
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {loading ? "…" : formatUsd(investTotalUsd)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {positionsLabel}
            </p>
          </div>
        </div>

        {/* Footer: logos + meta (same layout) */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] text-muted-foreground">
              {hasAssets
                ? "Top holdings"
                : usdcUsd > 0
                  ? "You’re holding USDC — move some into investments."
                  : "No invest assets yet."}
            </span>

            {!hasAssets && (
              <span className="text-[10px] text-muted-foreground">
                You&apos;ll see your assets here after you invest.
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {nonUsdcTokens.length > 0 ? (
              <>
                <div className="flex -space-x-1.5">
                  {visibleTokens.map((t, idx) => (
                    <div
                      key={t.mint ?? `${t.symbol}-${idx}`}
                      className="h-7 w-7 overflow-hidden rounded-full border bg-card shadow-fintech-sm flex items-center justify-center"
                    >
                      {t.logoURI ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.logoURI}
                          alt={t.symbol || t.name || "Token"}
                          width={28}
                          height={28}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">
                          {t.symbol || "?"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {extraCount > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    +{extraCount}
                  </span>
                )}
              </>
            ) : boosterPositionsCount > 0 ? (
              <div className="h-7 w-7 rounded-full border bg-card shadow-fintech-sm flex items-center justify-center text-[9px] text-muted-foreground">
                B
              </div>
            ) : (
              <div className="h-7 w-7 rounded-full border bg-card shadow-fintech-sm flex items-center justify-center text-[9px] text-muted-foreground">
                —
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
};

export default InvestAccountCard;
