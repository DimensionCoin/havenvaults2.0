// components/exchange/advertisement/adds/LSTYieldAd.tsx
"use client";

import React from "react";
import { Percent, ArrowRight } from "lucide-react";
import type { Token } from "@/components/exchange/types";

type LSTYieldAdProps = {
  lstTokens: Token[];
  onFilterLSTs: () => void;
};

const LSTYieldAd: React.FC<LSTYieldAdProps> = ({ lstTokens, onFilterLSTs }) => {
  const displayTokens = lstTokens.slice(0, 5);

  return (
    <button
      type="button"
      onClick={onFilterLSTs}
      className="group relative flex w-full items-stretch overflow-hidden rounded-2xl border border-emerald-500/25 bg-white/15 px-4 py-4 text-left sm:px-6 sm:py-5"
    >
      {/* subtle glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-500/15 blur-3xl" />

      {/* left icon */}
      <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 sm:mr-4">
        <Percent className="h-5 w-5" />
      </div>

      {/* center content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-emerald-100 sm:text-base">
              Earn 7–9% on SOL with LSTs
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-400 sm:text-xs">
              Stay liquid, keep trading, earn staking yield.
            </p>
          </div>

          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
            LST · Passive yield
          </span>
        </div>

        {/* logos row */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex -space-x-2">
            {displayTokens.map((t) => (
              <div
                key={t.mint}
                className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-emerald-500/30 bg-zinc-950 text-[10px] font-semibold text-zinc-100"
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
              </div>
            ))}
          </div>

          <div className="ml-2 flex flex-col text-[11px] text-zinc-400 sm:text-xs">
            <span className="font-medium text-zinc-100">
              dSOL · mSOL · JitoSOL · JupSOL
            </span>
            <span>Hold to earn staking rewards.</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <span className="inline-flex rounded-full bg-zinc-900/70 px-2 py-0.5">
            APY range{" "}
            <span className="ml-1 font-semibold text-emerald-200">7–9%</span>
          </span>
          <span className="inline-flex rounded-full bg-zinc-900/70 px-2 py-0.5">
            No lockups · Liquid SOL
          </span>
        </div>
      </div>

      {/* right arrow / CTA */}
      <div className="ml-3 hidden items-center sm:flex">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-100 group-hover:border-emerald-400 group-hover:bg-emerald-500/20">
          View LSTs
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
};

export default LSTYieldAd;
