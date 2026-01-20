"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import type { AssetRow } from "./types";
import { useUser } from "@/providers/UserProvider";

type Props = {
  asset: AssetRow;
  href?: string; // optional override
  onClick?: (asset: AssetRow) => void; // optional analytics / drawer
  rightSlot?: React.ReactNode;
};

function norm3(s?: string) {
  return (s || "").trim().toUpperCase();
}

// Intl doesn't know "USDC" as a currency code, so we format it as USD (same symbol),
// but still let you treat it as a "display currency" in your app.
function intlCurrencyCode(displayCurrency?: string) {
  const c = norm3(displayCurrency);
  return c === "USDC" ? "USD" : c || "USD";
}

function fmtMoney(n: number | undefined, displayCurrency?: string) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";

  const code = intlCurrencyCode(displayCurrency);

  // choose decimals similar to your old fmtUsd logic
  const opts: Intl.NumberFormatOptions =
    n >= 1
      ? { style: "currency", currency: code, maximumFractionDigits: 2 }
      : { style: "currency", currency: code, maximumFractionDigits: 6 };

  try {
    return new Intl.NumberFormat(undefined, opts).format(n);
  } catch {
    // ultra-safe fallback
    const prefix = code === "USD" ? "$" : `${code} `;
    return n >= 1 ? `${prefix}${n.toFixed(2)}` : `${prefix}${n.toFixed(6)}`;
  }
}

function fmtPct(n?: number) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Fetch USD -> target fx rate (cached in-memory per currency)
 */
const fxMemo = new Map<string, { rate: number; ts: number }>();
const FX_TTL_MS = 5 * 60 * 1000;

function useUsdToFxRate(displayCurrency?: string) {
  const target = intlCurrencyCode(displayCurrency);

  const [rate, setRate] = React.useState<number>(1);
  const [loading, setLoading] = React.useState<boolean>(target !== "USD");

  React.useEffect(() => {
    let cancelled = false;

    // USD (and USDC treated as USD for conversion) => 1:1
    if (target === "USD") {
      setRate(1);
      setLoading(false);
      return;
    }

    const key = `USD:${target}`;
    const cached = fxMemo.get(key);
    if (cached && Date.now() - cached.ts < FX_TTL_MS) {
      setRate(cached.rate);
      setLoading(false);
      return;
    }

    const run = async () => {
      try {
        setLoading(true);

        const res = await fetch(`/api/fx?to=${encodeURIComponent(target)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!res.ok) throw new Error(`FX HTTP ${res.status}`);

        const j = (await res.json()) as { rate?: number; target?: string };
        const r = Number(j?.rate);

        if (!isFinite(r) || r <= 0) throw new Error("FX missing rate");

        fxMemo.set(key, { rate: r, ts: Date.now() });

        if (!cancelled) {
          setRate(r);
          setLoading(false);
        }
      } catch {
        // fail soft: show USD if FX fails
        if (!cancelled) {
          setRate(1);
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [target]);

  return { rate, loading, target };
}

export default function AssetCard({ asset, href, onClick, rightSlot }: Props) {
  const { user } = useUser();
  const displayCurrency = user?.displayCurrency || "USD";

  const change = asset.changePct24h;

  // default: mint is always unique
  const targetHref = href ?? `/invest/${encodeURIComponent(asset.mint)}`;

  const changePill =
    change === undefined
      ? "border-border bg-secondary text-muted-foreground"
      : change >= 0
        ? "haven-pill-positive"
        : "haven-pill-negative";

  const { rate, loading: fxLoading } = useUsdToFxRate(displayCurrency);

  const priceDisplay =
    typeof asset.priceUsd === "number" && isFinite(asset.priceUsd)
      ? asset.priceUsd * rate
      : undefined;

  return (
    <Link
      href={targetHref}
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
              {fxLoading ? "—" : fmtMoney(priceDisplay, displayCurrency)}
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
