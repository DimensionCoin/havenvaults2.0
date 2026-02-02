// components/shared/Loading.tsx
"use client";

import React from "react";
import Image from "next/image";

const Loading: React.FC = () => {
  return (
    <main className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background text-foreground">
      {/* Soft ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-[-320px] right-[-220px] h-[560px] w-[560px] rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-[420px] px-6">
        <div className="rounded-3xl border border-border bg-card/90 p-6 shadow-fintech-md backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-border bg-background">
              <Image
                src="/logo.jpg"
                alt="Haven Financial"
                fill
                className="object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Haven Financial
              </span>
              <span className="text-sm font-semibold">Preparing your account</span>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[13px] text-muted-foreground">
              Securing your session and syncing balances.
            </p>

            <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-primary/70" />
                Secure session
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-primary/50" />
                Self-custodial
              </span>
            </div>

            <div className="mt-5 flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-[dot_1.2s_ease-in-out_infinite] rounded-full bg-primary/70" />
              <span className="h-2.5 w-2.5 animate-[dot_1.2s_ease-in-out_infinite_0.2s] rounded-full bg-primary/50" />
              <span className="h-2.5 w-2.5 animate-[dot_1.2s_ease-in-out_infinite_0.4s] rounded-full bg-primary/40" />
              <span className="ml-1 text-[11px] text-muted-foreground">
                Please wait…
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Local keyframes (no global CSS changes needed) */}
      <style jsx global>{`
        @keyframes dot {
          0%,
          100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          50% {
            transform: translateY(-3px);
            opacity: 1;
          }
        }
      `}</style>
    </main>
  );
};

export default Loading;
