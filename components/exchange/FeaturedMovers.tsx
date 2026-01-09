"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { Token, PriceEntry } from "./types";
import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokenConfig";

const CLUSTER = getCluster();

const MINT_TO_META: Record<string, TokenMeta> = (() => {
  const map: Record<string, TokenMeta> = {};
  TOKENS.forEach((meta: TokenMeta) => {
    const mint = getMintFor(meta, CLUSTER);
    if (!mint) return;
    map[mint] = meta;
  });
  return map;
})();

const getTokenSlug = (token: Token) => {
  const meta = MINT_TO_META[token.mint];
  if (meta?.id) return meta.id.toLowerCase();
  if (meta?.symbol) return meta.symbol.toLowerCase();
  return (token.symbol || token.mint).toLowerCase();
};

// "$" only, no "CA$"
const formatMoneyNoCode = (v?: number | null) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: n < 1 ? 6 : 2,
  });
};

const formatChange = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

type FeaturedMoversProps = {
  tokens: Token[];
  prices: Record<string, PriceEntry>;
  displayCurrency: string;
  fxRate: number;
  loading?: boolean;
};

const MoverCard: React.FC<{
  token: Token;
  price?: PriceEntry;
  fxRate: number;
  type: "gainer" | "loser";
}> = ({ token, price, fxRate, type }) => {
  const slug = getTokenSlug(token);
  const priceDisplay = price?.price ? price.price * fxRate : null;
  const change = price?.priceChange24hPct ?? null;

  const isGainer = type === "gainer";

  return (
    <Link
      href={`/invest/${slug}`}
      className={[
        "group relative flex min-w-[178px] flex-col overflow-hidden",
        "rounded-3xl border border-border",
        "bg-card/80 backdrop-blur-xl",
        "shadow-fintech-md",
        "transition active:scale-[0.985]",
        "hover:bg-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      ].join(" ")}
    >
      {/* subtle top wash (token-based, light/dark safe) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-primary/10 to-transparent" />

      <div className="relative p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-border bg-background/60">
            {token.logoURI ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={token.logoURI}
                alt={token.name || token.symbol || "Token"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                {(token.symbol || "?").slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {token.symbol || "—"}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {token.name || ""}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-foreground">
              {priceDisplay === null ? "—" : formatMoneyNoCode(priceDisplay)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Price</div>
          </div>

          <span
            className={[
              "shrink-0 inline-flex items-center gap-1 rounded-full",
              "border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
              isGainer
                ? "border-primary/25 bg-primary/10 text-foreground"
                : "border-destructive/25 bg-destructive/10 text-foreground",
            ].join(" ")}
          >
            {isGainer ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {formatChange(change)}
          </span>
        </div>
      </div>
    </Link>
  );
};

const FeaturedMovers: React.FC<FeaturedMoversProps> = ({
  tokens,
  prices,
  fxRate,
  loading = false,
}) => {
  const { gainers, losers } = useMemo(() => {
    const withPrices = tokens
      .map((t) => ({
        token: t,
        price: prices[t.mint],
        change: prices[t.mint]?.priceChange24hPct ?? null,
      }))
      .filter((x) => x.change !== null && Number.isFinite(x.change));

    const sorted = [...withPrices].sort(
      (a, b) => (b.change as number) - (a.change as number)
    );

    return {
      gainers: sorted.filter((x) => (x.change as number) > 0).slice(0, 3),
      losers: sorted
        .filter((x) => (x.change as number) < 0)
        .slice(-3)
        .reverse(),
    };
  }, [tokens, prices]);

  if (loading) {
    return (
      <div className="space-y-5">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-3 w-28 animate-pulse rounded bg-border/60" />
          <div className="h-3 w-10 animate-pulse rounded bg-border/60" />
        </div>

        {/* Cards skeleton */}
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[112px] w-[178px] shrink-0 animate-pulse rounded-3xl border border-border bg-card/60"
            />
          ))}
        </div>
      </div>
    );
  }

  if (gainers.length === 0 && losers.length === 0) return null;

  const SectionHeader = ({
    icon,
    title,
    right,
  }: {
    icon: React.ReactNode;
    title: string;
    right?: string;
  }) => (
    <div className="mb-2 flex items-center justify-between">
      <span className="haven-pill">
        {icon}
        <span className="ml-1">{title}</span>
      </span>
      <span className="text-[11px] text-muted-foreground">{right}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Top Gainers */}
      {gainers.length > 0 && (
        <div>
          <SectionHeader
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            title="Top gainers"
            right="24h"
          />

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {gainers.map(({ token, price }) => (
              <MoverCard
                key={token.mint}
                token={token}
                price={price}
                fxRate={fxRate}
                type="gainer"
              />
            ))}
          </div>
        </div>
      )}

      {/* Top Losers */}
      {losers.length > 0 && (
        <div>
          <SectionHeader
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            title="Top losers"
            right="24h"
          />

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {losers.map(({ token, price }) => (
              <MoverCard
                key={token.mint}
                token={token}
                price={price}
                fxRate={fxRate}
                type="loser"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FeaturedMovers;
