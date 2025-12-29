// components/shared/Loading.tsx
"use client";

import React from "react";
import { Loader2 } from "lucide-react";

const Loading: React.FC = () => {
  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4">
      <div className="relative w-full max-w-sm rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-zinc-950 via-black to-zinc-900 px-5 py-6 shadow-[0_18px_45px_rgba(0,0,0,0.65)]">
        {/* Top: tiny brand + text */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-500/20">
            <span className="text-xs font-semibold tracking-[0.16em] text-emerald-100">
              HV
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Haven is getting ready
            </span>
            <span className="text-sm font-semibold text-zinc-50">
              Loading your portfolio…
            </span>
          </div>
        </div>

        {/* Spinner + copy */}
        <div className="mt-4 flex items-center gap-3">
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-300" />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-zinc-400">
            Fetching your balances and personalizing your dashboard. This will
            only take a moment.
          </p>
        </div>

        {/* Subtle skeleton bars */}
        <div className="mt-5 space-y-2">
          <div className="h-2 w-3/4 animate-pulse rounded-full bg-zinc-800" />
          <div className="h-2 w-1/2 animate-pulse rounded-full bg-zinc-900" />
          <div className="h-2 w-5/6 animate-pulse rounded-full bg-zinc-800" />
        </div>
      </div>
    </div>
  );
};

export default Loading;
