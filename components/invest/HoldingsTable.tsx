"use client";

import React from "react";
import Link from "next/link";
import { Plus, Minus, ArrowUpRight, ArrowDownLeft } from "lucide-react";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";

type HoldingsTableProps = {
  onBuy?: () => void;
  onSell?: () => void;
  onSend?: () => void;
  onReceive?: () => void;
};

const ENV_USDC_MINT = (process.env.NEXT_PUBLIC_USDC_MINT || "").toLowerCase();

const formatUsd = (n?: number) =>
  n === undefined || n === null || Number.isNaN(n)
    ? "$0.00"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });

// 🔗 Helper: build invest URL for a holding
const getInvestHref = (t: { symbol?: string | null; mint: string }) => {
  const slug = t.symbol || t.mint;
  return `/invest/${encodeURIComponent(slug)}`;
};

const HoldingsTable: React.FC<HoldingsTableProps> = ({
  onBuy,
  onSell,
  onSend,
  onReceive,
}) => {
  const {
    tokens,
    loading,
    totalUsd,
    usdcUsd,
    totalChange24hUsd,
    totalChange24hPct,
  } = useBalance();

  const { user } = useUser();

  // ── Avatar data ──────────────────────────────────────────────
  const avatarUrl = user?.profileImageUrl || null;
  const displayName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "You";

  const initials =
    !avatarUrl && user
      ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`
          .toUpperCase()
          .trim() || "HV"
      : "HV";

  // ── Derive non-USDC tokens + USDC USD value locally ─────────
  const { nonUsdcTokens, derivedUsdcUsd } = React.useMemo(() => {
    let usdcValue = 0;

    const filtered = tokens.filter((t) => {
      const mintLower = t.mint.toLowerCase();
      const isUsdcMint = ENV_USDC_MINT !== "" && mintLower === ENV_USDC_MINT;
      const isUsdcSymbol = (t.symbol ?? "").toUpperCase() === "USDC";

      if (isUsdcMint || isUsdcSymbol) {
        usdcValue += t.usdValue ?? 0;
        return false;
      }

      return true;
    });

    return { nonUsdcTokens: filtered, derivedUsdcUsd: usdcValue };
  }, [tokens]);

  const effectiveUsdcUsd =
    typeof usdcUsd === "number" && !Number.isNaN(usdcUsd) && usdcUsd > 0
      ? usdcUsd
      : derivedUsdcUsd;

  const investUsd = Math.max(0, (totalUsd || 0) - (effectiveUsdcUsd || 0));

  const pct = totalChange24hPct ?? 0;
  const changeIsUp = totalChange24hUsd > 0;
  const changeIsDown = totalChange24hUsd < 0;

  const changeColor = changeIsUp
    ? "text-emerald-400"
    : changeIsDown
    ? "text-red-400"
    : "text-slate-400";

  const changeBg =
    changeIsUp || changeIsDown
      ? "bg-black/40"
      : "bg-black/40 border border-white/10";

  const changeLabelUsd =
    totalChange24hUsd === 0 || totalChange24hUsd === undefined
      ? "$0.00"
      : `${totalChange24hUsd > 0 ? "+" : ""}${formatUsd(
          Math.abs(totalChange24hUsd)
        )}`;

  const changeLabelPct =
    !Number.isFinite(pct) && pct !== 0
      ? "0.00%"
      : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(2)}%`;

  const showEmptyState = !loading && nonUsdcTokens.length === 0;

  return (
    <div className="w-full">
      <div className="rounded-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <div className="glass-pill">Invest · Portfolio</div>

            <div className="mt-3">
              {loading ? (
                <div className="h-9 w-40 animate-pulse rounded-2xl bg-white/10" />
              ) : (
                <p className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
                  {formatUsd(investUsd)}
                </p>
              )}

              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${changeColor} ${changeBg}`}
                >
                  {loading ? (
                    <span className="h-3 w-10 animate-pulse rounded-full bg-white/10" />
                  ) : (
                    changeLabelPct
                  )}
                </span>
                <span className="text-slate-500">
                  {loading ? "Last 24h" : `${changeLabelUsd} in the last 24h`}
                </span>
              </div>
            </div>
          </div>

          {/* Avatar */}
          <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full border border-white/15 bg-black/60 text-[10px] text-slate-400">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={displayName}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xs font-semibold text-white">
                {initials}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 grid grid-cols-4 gap-3 text-center">
          <Link
            href="/invest/exchange"
            className="group flex flex-col items-center gap-1 text-[11px] text-slate-100"
          >
            <button
              type="button"
              onClick={onBuy}
              className="group flex flex-col items-center gap-1 text-[11px] text-slate-100"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-black/50 text-slate-50 transition group-hover:bg-white/5">
                <Plus className="h-4 w-4" />
              </div>
              <span className="text-[10px] text-slate-300">Buy</span>
            </button>
          </Link>

          <button
            type="button"
            onClick={onSell}
            className="group flex flex-col items-center gap-1 text-[11px] text-slate-100"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-black/50 text-slate-50 transition group-hover:bg-white/5">
              <Minus className="h-4 w-4" />
            </div>
            <span className="text-[10px] text-slate-300">Sell</span>
          </button>

          <button
            type="button"
            onClick={onSend}
            className="group flex flex-col items-center gap-1 text-[11px] text-slate-100"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-black/50 text-slate-50 transition group-hover:bg-white/5">
              <ArrowUpRight className="h-4 w-4" />
            </div>
            <span className="text-[10px] text-slate-300">Send</span>
          </button>

          <button
            type="button"
            onClick={onReceive}
            className="group flex flex-col items-center gap-1 text-[11px] text-slate-100"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-black/50 text-slate-50 transition group-hover:bg-white/5">
              <ArrowDownLeft className="h-4 w-4" />
            </div>
            <span className="text-[10px] text-slate-300">Receive</span>
          </button>
        </div>

        {/* Portfolio header */}
        <div className="mt-6 mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
            Portfolio
          </p>
          {!loading && (
            <span className="text-[10px] text-slate-500">
              {nonUsdcTokens.length} asset
              {nonUsdcTokens.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-3 py-3 sm:px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" />
                  <div className="space-y-2">
                    <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
                    <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
                <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        ) : showEmptyState ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 py-6 text-center text-[11px] text-slate-500">
            No non-USDC tokens detected yet.
          </div>
        ) : (
          <div className="space-y-2">
            {nonUsdcTokens.map((t) => {
              const isUp =
                (t.usdChange24h ?? 0) > 0 ||
                (t.usdChange24h === undefined && (t.priceChange24h ?? 0) > 0);
              const isDown =
                (t.usdChange24h ?? 0) < 0 ||
                (t.usdChange24h === undefined && (t.priceChange24h ?? 0) < 0);

              const rowChangeColor = isUp
                ? "text-emerald-300"
                : isDown
                ? "text-red-300"
                : "text-slate-400";

              const changeUsdLabel =
                t.usdChange24h !== undefined
                  ? `${t.usdChange24h >= 0 ? "+" : ""}${t.usdChange24h.toFixed(
                      2
                    )}`
                  : "—";

              const changePctLabel =
                t.priceChange24h !== undefined
                  ? `${t.priceChange24h >= 0 ? "+" : ""}${(
                      t.priceChange24h * 100
                    ).toFixed(2)}%`
                  : "—";

              return (
                <Link
                  key={t.mint}
                  href={getInvestHref(t)}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-xs text-slate-100 transition hover:border-emerald-500/30 hover:bg-white/5 sm:px-4"
                >
                  {/* Left */}
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full border border-white/12 bg-black/60 text-[11px] font-semibold text-slate-200">
                      {t.logoURI ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.logoURI}
                          alt={t.name || t.symbol || t.mint}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (t.symbol || "???").slice(0, 3).toUpperCase()
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {t.name || t.symbol || "Unknown"}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {t.amount.toLocaleString("en-US", {
                          maximumFractionDigits: 4,
                        })}{" "}
                        {t.symbol?.toUpperCase() || ""}
                      </p>
                    </div>
                  </div>

                  {/* Right */}
                  <div className="text-right">
                    <p className="text-[13px] font-semibold text-slate-50">
                      {formatUsd(t.usdValue)}
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] font-medium ${rowChangeColor}`}
                    >
                      {changeUsdLabel === "—"
                        ? "—"
                        : `${changeUsdLabel} (${changePctLabel})`}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default HoldingsTable;
