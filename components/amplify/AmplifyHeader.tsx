"use client";

import React from "react";
import type { AmplifyTokenSymbol } from "./types";

type Props = {
  tokens: AmplifyTokenSymbol[];
  activeToken: AmplifyTokenSymbol;
  onChangeToken: (t: AmplifyTokenSymbol) => void;
};

export default function AmplifyHeader({
  tokens,
  activeToken,
  onChangeToken,
}: Props) {
  return (
    <div className="glass-panel bg-white/10 px-4 py-3 sm:px-5 sm:py-4">
      <div className="flex items-center justify-center">
        <div className="relative inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-black/45 p-1 shadow-[0_10px_35px_rgba(0,0,0,0.55)]">
          {/* subtle inner glow */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/5" />

          {tokens.map((t) => {
            const active = t === activeToken;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChangeToken(t)}
                className={[
                  "relative rounded-xl px-5 py-2 text-[12px] font-semibold tracking-[0.22em] transition",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/40",
                  active
                    ? [
                        "text-black",
                        "bg-emerald-400",
                        "shadow-[0_10px_30px_rgba(16,185,129,0.25)]",
                        "ring-1 ring-emerald-200/60",
                      ].join(" ")
                    : "text-white/70 hover:text-white/90 hover:bg-white/5",
                ].join(" ")}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
