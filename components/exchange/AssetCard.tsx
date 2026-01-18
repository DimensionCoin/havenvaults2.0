// components/exchange/AssetCard.tsx
"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import type { AssetRow } from "./types";

type Props = {
  asset: AssetRow;
  href?: string; // optional override
  onClick?: (asset: AssetRow) => void; // optional analytics / drawer
  rightSlot?: React.ReactNode;
};

function fmtUsd(n?: number) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6)}`;
}

function fmtPct(n?: number) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function AssetCard({ asset, href, onClick, rightSlot }: Props) {
  const change = asset.changePct24h;

  // default: mint is always unique
  const target = href ?? `/invest/${encodeURIComponent(asset.mint)}`;

  const changePill =
    change === undefined
      ? "border-border bg-secondary text-muted-foreground"
      : change >= 0
        ? "haven-pill-positive"
        : "haven-pill-negative";

  return (
    <Link
      href={target}
      onClick={() => onClick?.(asset)}
      className={[
        "block w-full",
        "rounded-3xl border bg-card text-card-foreground",
        "shadow-fintech-sm transition",
        "hover:bg-card/80",
        "active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      ].join(" ")}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Logo */}
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl border bg-background/60">
          <Image
            src={asset.logoURI}
            alt={`${asset.name} logo`}
            fill
            sizes="44px"
            className="object-cover"
          />
        </div>

        {/* Name / Symbol */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {asset.name}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {asset.symbol}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {/* Price + Change */}
          <div className="text-right">
            <div className="text-sm font-semibold text-foreground tabular-nums">
              {fmtUsd(asset.priceUsd)}
            </div>

            <div className="mt-1 flex justify-end">
              <span
                className={[
                  "inline-flex items-center rounded-full border px-2 py-0.5",
                  "text-[11px] font-semibold tabular-nums",
                  changePill,
                ].join(" ")}
              >
                {fmtPct(change)}
              </span>
            </div>
          </div>

          {/* Optional right-side control (button, sparkline, etc.) */}
          {rightSlot ? (
            <div
              className="shrink-0"
              onClick={(e) => {
                // prevent navigation, but let the child button receive the click
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {rightSlot}
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
