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
  const { tokens, loading, usdcUsd } = useBalance();

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

  // non-USDC side = invest portfolio
  const investUsd = useMemo(
    () => nonUsdcTokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0),
    [nonUsdcTokens]
  );

  const hasAssets = investUsd > 0.01 && nonUsdcTokens.length > 0;
  const visibleTokens = nonUsdcTokens.slice(0, 3);
  const extraCount =
    nonUsdcTokens.length > visibleTokens.length
      ? nonUsdcTokens.length - visibleTokens.length
      : 0;

  return (
    <Link
      href="/invest"
      className="block h-full w-full"
      aria-label="Open Invest page"
    >
      <div className="flex h-full w-full flex-col justify-between rounded-2xl border border-zinc-800 bg-white/10 px-4 py-4 sm:px-6 sm:py-6 transition hover:border-emerald-400/40 hover:bg-white/15">
        {/* Header + value */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-200/80">
            Invest Account
          </p>

          <div className="mt-4">
            <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-50 sm:text-4xl">
              {loading ? "…" : formatUsd(investUsd)}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {hasAssets
                ? `${nonUsdcTokens.length} position${
                    nonUsdcTokens.length === 1 ? "" : "s"
                  } in your portfolio`
                : "Tap to start investing with Haven"}
            </p>
          </div>
        </div>

        {/* Footer: logos + meta */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] text-zinc-500">
              {hasAssets
                ? "Top holdings"
                : usdcUsd > 0
                ? "You’re holding USDC — move some into investments."
                : "No invest assets yet."}
            </span>
            {!hasAssets && (
              <span className="text-[10px] text-zinc-600">
                You&apos;ll see your tokens here after you invest.
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {hasAssets ? (
              <>
                <div className="flex -space-x-1.5">
                  {visibleTokens.map((t, idx) => (
                    <div
                      key={t.mint ?? `${t.symbol}-${idx}`}
                      className="w-7 h-7 rounded-full border border-zinc-800 bg-black/40 overflow-hidden flex items-center justify-center"
                    >
                      {t.logoURI ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.logoURI}
                          alt={t.symbol || t.name || "Token"}
                          width={28}
                          height={28}
                          className="object-contain"
                        />
                      ) : (
                        <span className="text-[9px] text-zinc-300">
                          {t.symbol || "?"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {extraCount > 0 && (
                  <span className="ml-1 text-[10px] text-zinc-400">
                    +{extraCount}
                  </span>
                )}
              </>
            ) : (
              <div className="w-7 h-7 rounded-full border border-zinc-800 bg-black/40 flex items-center justify-center text-[9px] text-zinc-300">
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
