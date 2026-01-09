// components/shared/Loading.tsx
"use client";

import React from "react";
import Image from "next/image";

const Loading: React.FC = () => {
  return (
    <main className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background text-foreground">
      {/* Ambient mint glow + subtle grid (works in light + dark via tokens) */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-56 left-1/2 h-[760px] w-[760px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-[-380px] right-[-260px] h-[760px] w-[760px] rounded-full bg-primary/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04] dark:opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,0,0,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.55) 1px, transparent 1px)",
            backgroundSize: "86px 86px",
          }}
        />
      </div>

      {/* Splash */}
      <div className="relative flex w-full max-w-[420px] flex-col items-center px-6">
        {/* Logo badge */}
        <div className="relative">
          <div className="absolute -inset-6 rounded-full bg-primary/10 blur-2xl" />
          <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[22px] border border-border bg-card shadow-fintech-md">
            <Image
              src="/logo.jpg"
              alt="Haven"
              fill
              className="object-contain"
            />
          </div>
        </div>

        {/* Brand text */}
        <div className="mt-5 text-center">
          <p className="haven-kicker">Haven</p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">
            Loading your account
          </h1>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Securing your session & syncing balances.
          </p>
        </div>

        {/* Futuristic progress rail */}
        <div className="mt-7 w-full">
          <div className="relative h-2 w-full overflow-hidden rounded-full border border-border bg-card shadow-fintech-sm">
            {/* moving sheen */}
            <div className="absolute inset-0 opacity-70">
              <div className="absolute left-[-40%] top-0 h-full w-[40%] animate-[haven-sheen_1.1s_ease-in-out_infinite] rounded-full bg-primary/45 blur-[1px]" />
            </div>
            {/* soft inner highlight */}
            <div className="absolute inset-x-0 top-0 h-px bg-white/20 dark:bg-white/10" />
          </div>

          {/* Tiny status chips (minimal, bank-like) */}
          <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/30" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary/80" />
              </span>
              Live sync
            </span>

            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-primary/60" />
              Non-custodial
            </span>
          </div>
        </div>
      </div>

      {/* Local keyframes (no global CSS changes needed) */}
      <style jsx>{`
        @keyframes haven-sheen {
          0% {
            transform: translateX(0%);
            opacity: 0.35;
          }
          50% {
            opacity: 0.75;
          }
          100% {
            transform: translateX(260%);
            opacity: 0.35;
          }
        }
      `}</style>
    </main>
  );
};

export default Loading;
