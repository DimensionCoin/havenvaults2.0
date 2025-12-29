// components/exchange/advertisement/adds/AmplifyTop3Ad.tsx
"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Rocket } from "lucide-react";
import type { Token } from "@/components/exchange/types";

type AmplifyTop3AdProps = {
  tokens: Token[];
};

const getInvestHref = (t: Token) => {
  const slug = t.symbol || t.mint;
  return `/invest/${encodeURIComponent(slug)}`;
};

const AmplifyTop3Ad: React.FC<AmplifyTop3AdProps> = ({ tokens }) => {
  // focus on the “big 3”
  const bigThreeSymbols = new Set(["SOL", "BTC", "ETH"]);

  const bigThreeTokens = tokens
    .filter((t) => bigThreeSymbols.has((t.symbol || "").toUpperCase()))
    .slice(0, 3);

  const hasBigThree = bigThreeTokens.length > 0;

  return (
    <div className="group relative flex w-full items-stretch overflow-hidden rounded-2xl border border-emerald-500/25 bg-black/15 px-4 py-4 text-left sm:px-6 sm:py-5">
      {/* subtle glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-500/15 blur-3xl" />

      {/* left icon */}
      <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 sm:mr-4">
        <Rocket className="h-5 w-5" />
      </div>

      {/* center content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-emerald-100 sm:text-base">
              Amplify SOL, BTC & ETH
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-400 sm:text-xs">
              Tap UP or DOWN on the big 3 and let Haven boost the impact up to
              4×.
            </p>
          </div>

          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
            Amplify · Up to 4×
          </span>
        </div>

        {/* logos + quick labels for SOL / BTC / ETH */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {hasBigThree && (
            <div className="flex -space-x-2">
              {bigThreeTokens.map((t) => (
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

          <div className="ml-2 text-[11px] text-zinc-400 sm:text-xs">
            <span className="font-medium text-zinc-100">SOL · BTC · ETH</span> —
            simple boosted bets, one tap away.
          </div>
        </div>
      </div>

      {/* right CTA to your amplify page */}
      <div className="ml-3  items-center flex">
        <Link
          href="/amplify"
          className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-100 transition group-hover:border-emerald-400 group-hover:bg-emerald-500/20"
        >
           Amplify
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};

export default AmplifyTop3Ad;
