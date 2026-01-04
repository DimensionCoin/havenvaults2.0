// components/invest/HoldingsTable.tsx
"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";

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

// ✅ best-effort: exclude “savings”
const looksLikeSavings = (t: {
  symbol?: string | null;
  name?: string | null;
}) => `${t.symbol ?? ""} ${t.name ?? ""}`.toLowerCase().includes("savings");

const HoldingsTable: React.FC<HoldingsTableProps> = ({
  onSell,
  onSend,
  onBuy,
  onReceive,
}) => {
  const {
    tokens,
    loading,
    boosterTakeHomeUsd, // ✅ needed for investTotalUsd
    totalChange24hUsd,
    totalChange24hPct,
  } = useBalance();

  const { user } = useUser();

  const avatarUrl = user?.profileImageUrl || null;

  const firstName =
    user?.firstName?.trim() ||
    user?.fullName?.split(" ")?.[0]?.trim() ||
    "there";

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

  // ✅ SAME BALANCE LOGIC AS InvestAccountCard:
  // invest = (non-USDC spot tokens) + (boosted take-home)
  const nonUsdcTokens = useMemo(() => {
    return (tokens || []).filter((t) => {
      const mintLower = (t.mint || "").toLowerCase();
      const isUsdcMint = ENV_USDC_MINT !== "" && mintLower === ENV_USDC_MINT;
      const isUsdcSymbol = (t.symbol ?? "").toUpperCase() === "USDC";
      return !(isUsdcMint || isUsdcSymbol);
    });
  }, [tokens]);

  const investSpotUsd = useMemo(() => {
    return nonUsdcTokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);
  }, [nonUsdcTokens]);

  const investTotalUsd = useMemo(() => {
    const b = Number.isFinite(boosterTakeHomeUsd) ? boosterTakeHomeUsd : 0;
    return investSpotUsd + b;
  }, [investSpotUsd, boosterTakeHomeUsd]);

  // ── Only show wallet assets in the list (exclude cash + savings) ─────────
  const walletAssets = useMemo(() => {
    return (tokens || []).filter((t) => {
      const mintLower = (t.mint || "").toLowerCase();
      const isCashMint = ENV_USDC_MINT !== "" && mintLower === ENV_USDC_MINT;
      const isCashSymbol = (t.symbol ?? "").toUpperCase() === "USDC";
      if (isCashMint || isCashSymbol) return false;
      if (looksLikeSavings(t)) return false;
      return true;
    });
  }, [tokens]);

  const pct = totalChange24hPct ?? 0;
  const changeIsUp = (totalChange24hUsd ?? 0) > 0;
  const changeIsDown = (totalChange24hUsd ?? 0) < 0;

  const changeColor = changeIsUp
    ? "text-emerald-300"
    : changeIsDown
      ? "text-red-300"
      : "text-zinc-300";

  const changeChipBg = changeIsUp
    ? "border-emerald-500/25 bg-emerald-500/10"
    : changeIsDown
      ? "border-red-500/25 bg-red-500/10"
      : "border-white/10 bg-white/5";

  const changeLabelUsd =
    !totalChange24hUsd || !Number.isFinite(totalChange24hUsd)
      ? "$0.00"
      : `${totalChange24hUsd > 0 ? "+" : ""}${formatUsd(
          Math.abs(totalChange24hUsd)
        )}`;

  const changeLabelPct =
    !Number.isFinite(pct) && pct !== 0
      ? "0.00%"
      : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(2)}%`;

  const showEmptyState = !loading && walletAssets.length === 0;

  // ── Mobile-first action button (SHORT) ───────────────────────
  const ActionButton = ({
    label,
    icon,
    onClick,
    variant = "solid",
    disabled,
  }: {
    label: string;
    icon: React.ReactNode;
    onClick?: () => void;
    variant?: "solid" | "ghost";
    disabled?: boolean;
  }) => {
    const base =
      "w-full h-11 rounded-2xl px-3 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40";
    const solid =
      "border border-white/10 bg-black/25 text-white hover:bg-secondary";
    const ghost =
      "border border-white/10 bg-white/5 text-white hover:bg-white/10";

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || !onClick}
        className={[
          base,
          variant === "solid" ? solid : ghost,
          disabled || !onClick ? "cursor-not-allowed opacity-60" : "",
        ].join(" ")}
      >
        <div className="flex items-center justify-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-black/5 text-black">
            {icon}
          </span>
          <span className="text-sm font-semibold">{label}</span>
        </div>
      </button>
    );
  };

  return (
    <div className="w-full">
      <div className="rounded-3xl">
        {/* ───────────────────────── Header / Balance / 2 Buttons ───────────────────────── */}
        <div className="rounded-3xl border border-white/10 bg-black/35 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)] backdrop-blur-xl sm:p-5">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full border border-white/15 bg-black/60 text-[10px] text-zinc-400">
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

              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  Hi, {firstName}
                </p>
                <p className="truncate text-[11px] text-zinc-400">
                  Welcome back
                </p>
              </div>
            </div>
          </div>

          {/* Balance */}
          <div className="mt-4">
            <p className="text-[11px] font-medium text-zinc-400">
              Your Balance
            </p>

            {loading ? (
              <div className="mt-2 h-11 w-48 animate-pulse rounded-2xl bg-white/10" />
            ) : (
              <p className="mt-1 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                {/* ✅ INVESTMENTS + POSITIONS (same as InvestAccountCard) */}
                {formatUsd(investTotalUsd)}
              </p>
            )}

            {/* Tiny change row (wrap-safe on mobile) */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={[
                  "inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold",
                  changeChipBg,
                  changeColor,
                ].join(" ")}
              >
                {loading ? (
                  <span className="h-4 w-14 animate-pulse rounded-full bg-white/10" />
                ) : (
                  changeLabelPct
                )}
              </span>
              <span className="text-[11px] text-zinc-400">
                {loading ? "Last 24h" : `${changeLabelUsd} today`}
              </span>
            </div>

            {/* 2 buttons: always short on mobile, roomy on desktop */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ActionButton
                label="Swap assets"
                icon={<ArrowDownLeft className="h-4 w-4 text-white" />}
                onClick={onSell ?? onBuy}
                variant="solid"
                disabled={loading}
              />
              <ActionButton
                label="Send assets"
                icon={<ArrowUpRight className="h-4 w-4 text-white" />}
                onClick={onSend ?? onReceive}
                variant="ghost"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* ───────────────────────── Assets List ───────────────────────── */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
              Assets
            </p>
            {!loading && (
              <span className="text-[11px] text-zinc-500">
                {walletAssets.length} asset
                {walletAssets.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/35 px-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-white/10" />
                    <div className="space-y-2">
                      <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
                      <div className="h-3 w-36 animate-pulse rounded bg-white/10" />
                    </div>
                  </div>
                  <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : showEmptyState ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/25 py-8 text-center">
              <p className="text-sm font-medium text-zinc-200">No assets yet</p>
              <p className="mt-1 text-[12px] text-zinc-500">
                When you swap into an asset, it’ll show up here.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
              {walletAssets.map((t, idx) => {
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
                    : "text-zinc-400";

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
                    className={[
                      "flex items-center justify-between gap-3 px-4 py-4 text-white transition",
                      "hover:bg-white/5",
                      idx !== 0 ? "border-t border-white/8" : "",
                    ].join(" ")}
                  >
                    {/* Left */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full border border-white/12 bg-black/55 text-[11px] font-semibold text-zinc-200">
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
                        <p className="truncate text-[14px] font-semibold text-white">
                          {t.symbol?.toUpperCase() || t.name || "Unknown"}
                        </p>
                        <p className="truncate text-[12px] text-zinc-400">
                          {t.amount.toLocaleString("en-US", {
                            maximumFractionDigits: 6,
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Right */}
                    <div className="shrink-0 text-right">
                      <p className="text-[14px] font-semibold text-white">
                        {formatUsd(t.usdValue)}
                      </p>
                      <p
                        className={[
                          "mt-0.5 text-[12px] font-medium md:block",
                          rowChangeColor,
                        ].join(" ")}
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
    </div>
  );
};

export default HoldingsTable;
