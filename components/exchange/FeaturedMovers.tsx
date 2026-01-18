// components/exchange/FeaturedMovers.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { AssetRow, Movers } from "./types";

type Props = {
  title?: string; // optional, but we’ll keep the “two sections” look
  movers: Movers;
  className?: string;

  /** how many to show per side */
  limit?: number;

  /** optional override for where to link */
  hrefFor?: (asset: AssetRow) => string;

  /** optional click handler (analytics, etc.) */
  onAssetClick?: (asset: AssetRow) => void;

  /** show skeleton look while loading */
  loading?: boolean;
};

function fmtUsd(n?: number) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6)}`;
}

function fmtChange(n?: number) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

const defaultHrefFor = (a: AssetRow) => `/invest/${encodeURIComponent(a.mint)}`;

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

function MoverCard({
  asset,
  type,
  href,
  onClick,
}: {
  asset: AssetRow;
  type: "gainer" | "loser";
  href: string;
  onClick?: () => void;
}) {
  const isGainer = type === "gainer";
  const change = asset.changePct24h;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={[
        "group relative flex min-w-[178px] flex-col overflow-hidden",
        "rounded-3xl border border-border",
        "bg-card/80 backdrop-blur-xl",
        "transition active:scale-[0.985]",
        "hover:bg-card",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      ].join(" ")}
    >
      {/* subtle top wash */}
      <div
        className={[
          "pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b to-transparent",
          isGainer ? "from-primary/12" : "from-destructive/10",
        ].join(" ")}
      />

      <div className="relative p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-border bg-background/60">
            {asset.logoURI ? (
              <Image
                src={asset.logoURI}
                alt={asset.name || asset.symbol || "Asset"}
                fill
                sizes="40px"
                className="object-cover"
              />
            ) : (
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                {(asset.symbol || "?").slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {asset.symbol || "—"}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {asset.name || ""}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-foreground">
              {fmtUsd(asset.priceUsd)}
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
            {fmtChange(change)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function FeaturedMovers({
  movers,
  className,
  limit = 5,
  hrefFor,
  onAssetClick,
  loading = false,
}: Props) {
  const gainers = movers.gainers.slice(0, limit);
  const losers = movers.losers.slice(0, limit);

 if (loading) {
   return (
     <div className={["space-y-6", className ?? ""].join(" ")}>
       <div>
         <div className="mb-2 flex items-center justify-between">
           <div className="h-5 w-28 animate-pulse rounded-full bg-border/60" />
           <div className="h-3 w-10 animate-pulse rounded bg-border/60" />
         </div>
         <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
           {Array.from({ length: limit }).map((_, i) => (
             <div
               key={i}
               className="h-[112px] w-[178px] shrink-0 animate-pulse rounded-3xl border border-border bg-card/60"
             />
           ))}
         </div>
       </div>

       <div>
         <div className="mb-2 flex items-center justify-between">
           <div className="h-5 w-24 animate-pulse rounded-full bg-border/60" />
           <div className="h-3 w-10 animate-pulse rounded bg-border/60" />
         </div>
         <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
           {Array.from({ length: limit }).map((_, i) => (
             <div
               key={i}
               className="h-[112px] w-[178px] shrink-0 animate-pulse rounded-3xl border border-border bg-card/60"
             />
           ))}
         </div>
       </div>
     </div>
   );
 }


  if (gainers.length === 0 && losers.length === 0) return null;

  const toHref = hrefFor ?? defaultHrefFor;

  return (
    <div className={["space-y-6", className ?? ""].join(" ")}>
      {gainers.length > 0 && (
        <div>
          <SectionHeader
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            title="Top gainers"
            right="24h"
          />

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {gainers.map((a) => (
              <MoverCard
                key={`g:${a.mint}`}
                asset={a}
                type="gainer"
                href={toHref(a)}
                onClick={() => onAssetClick?.(a)}
              />
            ))}
          </div>
        </div>
      )}

      {losers.length > 0 && (
        <div>
          <SectionHeader
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            title="Top losers"
            right="24h"
          />

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {losers.map((a) => (
              <MoverCard
                key={`l:${a.mint}`}
                asset={a}
                type="loser"
                href={toHref(a)}
                onClick={() => onAssetClick?.(a)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
