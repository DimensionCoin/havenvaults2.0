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
    <div className="haven-card-soft px-4 py-3 sm:px-5 sm:py-4">
      <div className="flex items-center justify-center">
        <div className="relative inline-flex items-center gap-1 rounded-2xl border bg-card/60 p-1 shadow-fintech-sm backdrop-blur">
          {/* subtle inner glow */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-border/60" />

          {tokens.map((t) => {
            const active = t === activeToken;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChangeToken(t)}
                className={[
                  "relative rounded-xl px-5 py-2 text-[12px] font-semibold tracking-[0.22em] transition",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  active
                    ? [
                        "bg-primary text-primary-foreground",
                        "shadow-fintech-sm",
                        "ring-1 ring-primary/30",
                      ].join(" ")
                    : "text-foreground/70 hover:text-foreground hover:bg-secondary",
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
