// app/(app)/invest/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";

import { useBalance } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";

import OpenPositionsMini from "@/components/invest/OpenPositionsMini";
import SellDrawer from "@/components/invest/Sell";
import TransferSPL from "@/components/invest/TransferSPL";

import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokenConfig";
import type { WalletToken } from "@/providers/BalanceProvider";

type ViewMode = "all" | "crypto" | "stocks";

const CLUSTER = getCluster();
const ENV_USDC_MINT = (process.env.NEXT_PUBLIC_USDC_MINT || "").toLowerCase();

/* ----------------------------- helpers ----------------------------- */

const formatUsd = (n?: number) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      })
    : "$0.00";

const formatPct = (pct?: number | null) => {
  const n = typeof pct === "number" && Number.isFinite(pct) ? pct : 0;
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
};

const looksLikeSavings = (t: {
  symbol?: string | null;
  name?: string | null;
}) => `${t.symbol ?? ""} ${t.name ?? ""}`.toLowerCase().includes("savings");

const isUsdc = (t: { mint: string; symbol?: string | null }) => {
  const mintLower = (t.mint || "").toLowerCase();
  const isMint = ENV_USDC_MINT && mintLower === ENV_USDC_MINT;
  const isSym = (t.symbol ?? "").toUpperCase() === "USDC";
  return Boolean(isMint || isSym);
};

// Build mint -> meta map (tokenConfig)
function buildMintToMeta(): Record<string, TokenMeta> {
  const map: Record<string, TokenMeta> = {};
  for (const meta of TOKENS as TokenMeta[]) {
    const mint = getMintFor(meta, CLUSTER);
    if (!mint) continue;
    map[mint] = meta;
  }
  return map;
}

// Decide holding kind from tokenConfig meta first, then categories fallback.
function inferKind(
  mint: string,
  categories?: string[]
): "crypto" | "stock" | "unknown" {
  // if tokenConfig includes a kind field, use it
  const metaKind = MINT_TO_META[mint]?.kind;

  if (metaKind === "crypto" || metaKind === "stock") return metaKind;

  // fallback: treat anything categorized as Stocks as stock
  if ((categories ?? []).includes("Stocks")) return "stock";

  return "crypto"; // default bias (most are crypto)
}

const MINT_TO_META = buildMintToMeta();

function investHref(mint: string, symbol?: string | null) {
  // keep your existing routing behavior
  const slug = (symbol && symbol.trim()) || mint;
  return `/invest/${encodeURIComponent(slug)}`;
}

/* ----------------------------- UI bits ----------------------------- */

function Segmented({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const Item = ({ v, label }: { v: ViewMode; label: string }) => {
    const active = value === v;
    return (
      <button
        type="button"
        onClick={() => onChange(v)}
        className={[
          "rounded-full border px-3 py-1.5 text-[12px] font-semibold transition",
          active
            ? "border-primary/30 bg-primary/15 text-foreground"
            : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
        ].join(" ")}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
      <Item v="all" label="All" />
      <Item v="crypto" label="Crypto" />
      <Item v="stocks" label="Stocks" />
    </div>
  );
}

function SectionHeader({
  title,
  right,
  onToggle,
  open,
}: {
  title: string;
  right: string;
  onToggle?: () => void;
  open?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <div>
        <div className="haven-kicker">{title}</div>
        <div className="text-sm font-semibold text-foreground">{right}</div>
      </div>

      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className="haven-icon-btn h-9 w-9"
          aria-label="Toggle section"
        >
          <ChevronDown
            className={[
              "h-4 w-4 transition-transform",
              open ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>
      ) : null}
    </div>
  );
}

function HoldingRow({
  t,
}: {
  t: {
    mint: string;
    symbol?: string | null;
    name?: string | null;
    logoURI?: string | null;
    amount: number;
    usdValue?: number;
    priceChange24h?: number | null; // if present
    usdChange24h?: number; // if present
  };
}) {
  const href = investHref(t.mint, t.symbol);

  const isUp =
    (typeof t.usdChange24h === "number" && t.usdChange24h > 0) ||
    (typeof t.priceChange24h === "number" && t.priceChange24h > 0);

  const isDown =
    (typeof t.usdChange24h === "number" && t.usdChange24h < 0) ||
    (typeof t.priceChange24h === "number" && t.priceChange24h < 0);

  const changeColor = isUp
    ? "text-primary"
    : isDown
      ? "text-destructive"
      : "text-muted-foreground";

  const pctLabel =
    typeof t.priceChange24h === "number" && Number.isFinite(t.priceChange24h)
      ? formatPct(t.priceChange24h)
      : "—";

  return (
    <Link
      href={href}
      className={["haven-row", "px-4 py-3", "transition hover:bg-accent"].join(
        " "
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background/60">
          {t.logoURI ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={t.logoURI}
              alt={t.name || t.symbol || "Asset"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-[11px] font-semibold text-foreground">
              {(t.symbol || "??").slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {(t.symbol || t.name || "Unknown").toString().toUpperCase()}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {(t.name || "").toString()}{" "}
            {t.amount
              ? `• ${t.amount.toLocaleString("en-US", {
                  maximumFractionDigits: 6,
                })}`
              : ""}
          </div>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold text-foreground">
          {formatUsd(t.usdValue)}
        </div>
        <div className={["text-[12px] font-medium", changeColor].join(" ")}>
          {pctLabel}
        </div>
      </div>
    </Link>
  );
}

/* ----------------------------- Page ----------------------------- */

export default function InvestPage() {
  const [sellOpen, setSellOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const { user } = useUser();
  const walletAddress = user?.walletAddress || "";

  const {
    tokens,
    loading,
    boosterTakeHomeUsd,
    totalChange24hUsd,
    totalChange24hPct,
  } = useBalance();

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

  // Keep view simple
  const [view, setView] = useState<ViewMode>("all");

  // Optional collapsible sections on "All" (mobile friendly)
  const [openCrypto, setOpenCrypto] = useState(true);
  const [openStocks, setOpenStocks] = useState(true);

  const { cryptoHoldings, stockHoldings, totals } = useMemo(() => {
    const raw = (tokens || []).filter((t) => {
      if (!t?.mint) return false;
      if (isUsdc(t)) return false;
      if (looksLikeSavings(t)) return false;
      if ((t.usdValue ?? 0) <= 0 && (t.amount ?? 0) <= 0) return false;
      return true;
    });

    const crypto: WalletToken[] = [];
    const stocks: WalletToken[] = [];

    for (const t of raw) {
      const meta = MINT_TO_META[t.mint];
      const categories = meta?.categories;
      const kind = inferKind(t.mint, categories);

      if (kind === "stock") stocks.push(t);
      else crypto.push(t);
    }

    const sortByValueDesc = (a: WalletToken, b: WalletToken) =>
      (b.usdValue ?? 0) - (a.usdValue ?? 0);

    crypto.sort(sortByValueDesc);
    stocks.sort(sortByValueDesc);

    const cryptoUsd = crypto.reduce((s, t) => s + (t.usdValue ?? 0), 0);
    const stocksUsd = stocks.reduce((s, t) => s + (t.usdValue ?? 0), 0);

    const investSpotUsd = cryptoUsd + stocksUsd;
    const booster = Number.isFinite(boosterTakeHomeUsd)
      ? boosterTakeHomeUsd
      : 0;

    return {
      cryptoHoldings: crypto,
      stockHoldings: stocks,
      totals: {
        cryptoUsd,
        stocksUsd,
        investSpotUsd,
        portfolioUsd: investSpotUsd + booster,
      },
    };
  }, [tokens, boosterTakeHomeUsd]);

  const changeIsUp = (totalChange24hUsd ?? 0) > 0;
  const changeIsDown = (totalChange24hUsd ?? 0) < 0;

  const changeChipClass = changeIsUp
    ? "haven-pill haven-pill-positive"
    : changeIsDown
      ? "haven-pill haven-pill-negative"
      : "haven-pill";

  const changeUsdLabel =
    typeof totalChange24hUsd === "number" && Number.isFinite(totalChange24hUsd)
      ? `${totalChange24hUsd > 0 ? "+" : ""}${formatUsd(Math.abs(totalChange24hUsd))}`
      : "$0.00";

  const displayedCrypto = view === "stocks" ? [] : cryptoHoldings;
  const displayedStocks = view === "crypto" ? [] : stockHoldings;

  const showEmpty =
    !loading && cryptoHoldings.length === 0 && stockHoldings.length === 0;

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6">
        {/* Top summary */}
        <div className="haven-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background/60">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-semibold text-foreground">
                    {initials}
                  </span>
                )}
              </div>

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  Portfolio
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {displayName}
                </div>
              </div>
            </div>

            <div className="hidden sm:block text-right">
              <div className="haven-kicker">24h</div>
              <span className={changeChipClass}>
                {loading ? "—" : formatPct(totalChange24hPct ?? 0)}
              </span>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-medium text-muted-foreground">
              Total value
            </div>

            {loading ? (
              <div className="mt-2 h-11 w-52 animate-pulse rounded-2xl bg-accent/60" />
            ) : (
              <div className="mt-1 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                {formatUsd(totals.portfolioUsd)}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={changeChipClass}>
                {loading ? "—" : formatPct(totalChange24hPct ?? 0)}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {loading ? "Last 24h" : `${changeUsdLabel} today`}
              </span>
            </div>

            {/* Actions (simple + fast) */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSellOpen(true)}
                disabled={loading}
                className="haven-btn-primary"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-foreground">
                  <ArrowDownLeft className="h-4 w-4" />
                </span>
                Swap
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!walletAddress) return;
                  setTransferOpen(true);
                }}
                disabled={loading || !walletAddress}
                className="haven-btn-primary"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-foreground">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
                Send
              </button>
            </div>
          </div>
        </div>

        {/* View toggle */}
        <div className="mt-5">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <div className="haven-kicker">Holdings</div>
              <div className="text-sm font-semibold text-foreground">
                {loading
                  ? "Loading…"
                  : `${cryptoHoldings.length + stockHoldings.length} assets`}
              </div>
            </div>
          </div>

          <Segmented value={view} onChange={setView} />
        </div>

        {/* Content */}
        <div className="mt-4 space-y-6">
          {showEmpty ? (
            <div className="haven-card-soft p-6 text-center">
              <div className="text-sm font-semibold text-foreground">
                No holdings yet
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                When you swap into an asset, it will show here under Crypto or
                Stocks.
              </div>
            </div>
          ) : null}

          {/* Crypto section */}
          {view !== "stocks" ? (
            <div className="space-y-3">
              <SectionHeader
                title="Crypto"
                right={
                  loading
                    ? "Loading…"
                    : `${formatUsd(totals.cryptoUsd)} • ${cryptoHoldings.length} assets`
                }
                onToggle={
                  view === "all" ? () => setOpenCrypto((v) => !v) : undefined
                }
                open={openCrypto}
              />

              {loading ? (
                <SkeletonRows />
              ) : view === "all" &&
                !openCrypto ? null : cryptoHoldings.length ? (
                <div className="flex flex-col gap-2">
                  {displayedCrypto.map((t) => (
                    <HoldingRow key={t.mint} t={t} />
                  ))}
                </div>
              ) : (
                <div className="haven-card-soft p-4 text-[12px] text-muted-foreground">
                  No crypto holdings yet.
                </div>
              )}
            </div>
          ) : null}

          {/* Stocks section */}
          {view !== "crypto" ? (
            <div className="space-y-3">
              <SectionHeader
                title="Stocks"
                right={
                  loading
                    ? "Loading…"
                    : `${formatUsd(totals.stocksUsd)} • ${stockHoldings.length} assets`
                }
                onToggle={
                  view === "all" ? () => setOpenStocks((v) => !v) : undefined
                }
                open={openStocks}
              />

              {loading ? (
                <SkeletonRows />
              ) : view === "all" &&
                !openStocks ? null : stockHoldings.length ? (
                <div className="flex flex-col gap-2">
                  {displayedStocks.map((t) => (
                    <HoldingRow key={t.mint} t={t} />
                  ))}
                </div>
              ) : (
                <div className="haven-card-soft p-4 text-[12px] text-muted-foreground">
                  No stock holdings yet.
                </div>
              )}
            </div>
          ) : null}

          {/* Positions mini stays clean + below holdings */}
          <div className="pt-2">
            <OpenPositionsMini />
          </div>
        </div>
      </div>

      {/* Drawers */}
      <SellDrawer open={sellOpen} onOpenChange={setSellOpen} />

      {walletAddress ? (
        <TransferSPL
          open={transferOpen}
          onOpenChange={setTransferOpen}
          walletAddress={walletAddress}
          onSuccess={() => setTransferOpen(false)}
        />
      ) : null}
    </>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="haven-row h-[64px] animate-pulse opacity-60" />
      ))}
    </div>
  );
}
