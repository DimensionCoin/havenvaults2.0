// components/exchange/advertisement/adds/InstantTradesAd.tsx
"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import type { Token } from "@/components/exchange/types";

type InstantTradesAdProps = {
  tokens: Token[];
};

const getInvestHref = (t: Token) => {
  const slug = t.symbol || t.mint;
  return `/invest/${encodeURIComponent(slug)}`;
};

const InstantTradesAd: React.FC<InstantTradesAdProps> = ({ tokens }) => {
  // 🔒 filter out LSTs so this ad never shows them
  const nonLSTTokens = tokens.filter(
    (t) => (t.category || "").toUpperCase() !== "LST"
  );

  const displayTokens = nonLSTTokens.slice(0, 5);
  const hasDisplayTokens = displayTokens.length > 0;

  return (
    <div className="group relative flex w-full items-stretch overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-900/50 via-emerald-900/20 to-zinc-950 px-4 py-4 text-left sm:px-6 sm:py-5">
      {/* subtle glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-500/15 blur-3xl" />

      {/* left icon */}
      <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 sm:mr-4">
        <Zap className="h-5 w-5" />
      </div>

      {/* center content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-emerald-100 sm:text-base">
              Instant trades from just $1
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-400 sm:text-xs">
              Flat 1.5% Haven fee on everything listed.
            </p>
          </div>

          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
            Trading · 1.5% fee
          </span>
        </div>

        {/* logos + token links */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* logo pills (each links to its invest page) */}
          {hasDisplayTokens && (
            <div className="flex -space-x-2">
              {displayTokens.map((t) => (
                <Link
                  key={t.mint}
                  href={getInvestHref(t)}
                  className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-emerald-500/30 bg-zinc-950 text-[10px] font-semibold text-zinc-100 transition hover:border-emerald-300 hover:ring-1 hover:ring-emerald-400/70"
                >
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
                </Link>
              ))}
            </div>
          )}

          {/* text row with token links */}
          <div className="ml-2 flex flex-wrap items-center gap-1 text-[11px] text-zinc-400 sm:text-xs">
            {hasDisplayTokens ? (
              <>
                {displayTokens.map((t, idx) => (
                  <React.Fragment key={`${t.mint}-label`}>
                    <Link
                      href={getInvestHref(t)}
                      className="font-medium text-zinc-100 hover:text-emerald-300"
                    >
                      {t.symbol || t.name || t.mint.slice(0, 4)}
                    </Link>
                    {idx < displayTokens.length - 1 && (
                      <span className="mx-0.5 text-zinc-500">·</span>
                    )}
                  </React.Fragment>
                ))}
                
              </>
            ) : (
              // fallback if (somehow) every token was an LST
              <span>
                Trade{" "}
                <span className="font-medium text-zinc-100">
                  SOL · USDC · BONK · JUP
                </span>{" "}
                and more from{" "}
                <span className="font-semibold text-emerald-200">$1</span>.
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <span className="inline-flex rounded-full bg-zinc-900/70 px-2 py-0.5">
            Haven fee{" "}
            <span className="ml-1 font-semibold text-emerald-200">1.5%</span>
          </span>
          <span className="inline-flex rounded-full bg-zinc-900/70 px-2 py-0.5">
            No minimum size beyond $1
          </span>
        </div>
      </div>

      {/* right CTA */}
      <div className="ml-3 hidden items-center sm:flex">
        <Link
          href="/invest/exchange"
          className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-100 transition group-hover:border-emerald-400 group-hover:bg-emerald-500/20"
        >
          Start trading
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};

export default InstantTradesAd;
