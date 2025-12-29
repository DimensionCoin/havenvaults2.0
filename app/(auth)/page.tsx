"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Shield, Lock, Zap } from "lucide-react";
import React from "react";

const Landing = () => {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient mint glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-60 left-1/2 h-[540px] w-[540px] -translate-x-1/2 rounded-full bg-[#9ee1b7]/18 blur-3xl" />
        <div className="absolute bottom-[-260px] right-[-160px] h-[520px] w-[520px] rounded-full bg-[#6fb28a]/18 blur-3xl" />
        <div className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-tr from-[#9ee1b7]/8 via-transparent to-transparent" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-10">
        {/* Top nav */}
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-2xl bg-black/70 shadow-[0_0_0_1px_rgba(148,163,184,0.4)] backdrop-blur-xl">
              <Image
                src="/logo.jpg" // update path if needed
                alt="Haven"
                fill
                className="rounded-2xl object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/80">
                Haven
              </span>
              <span className="text-[11px] text-slate-400/80">
                The mint-green home for your USDC.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/sign-in">
              <Button
                variant="ghost"
                className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-100/85 backdrop-blur-xl hover:bg-white/10 sm:inline-flex"
              >
                Sign in
              </Button>
            </Link>

            <Link href="/sign-in">
              <Button className="rounded-full bg-[#6fb28a] px-4 py-1.5 text-xs font-semibold text-black shadow-[0_14px_32px_rgba(111,178,138,0.7)] hover:bg-[#9ee1b7]">
                Get started
              </Button>
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="flex flex-1 flex-col items-center gap-10 pb-10 lg:flex-row lg:items-stretch">
          {/* Left: copy */}
          <div className="flex w-full flex-1 flex-col justify-center">
            <span className="glass-pill mb-4 text-[10px]">
              <Lock className="h-3 w-3" />
              Non-custodial • Solana • USDC
            </span>

            <h1 className="text-balance text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl lg:text-[2.7rem]">
              Live in USDC, with{" "}
              <span className="bg-gradient-to-r from-[#9ee1b7] to-[#6fb28a] bg-clip-text text-transparent">
                gasless saving & investing
              </span>
              .
            </h1>

            <p className="mt-4 max-w-xl text-sm text-slate-300/85 sm:text-base">
              Haven wraps your on-chain accounts in a calm, mint-green shell.
              Earn yield, move money, and stay fully self-custodial — everything
              happens from one glassy, secure dashboard.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/sign-in">
                <button className="haven-primary-btn w-auto px-5">
                  Enter Haven
                  <ArrowRight className="h-4 w-4" />
                </button>
              </Link>

              <div className="flex items-center gap-2 text-[11px] text-slate-400/90">
                <Shield className="h-3.5 w-3.5 text-[#9ee1b7]" />
                <span>Embedded wallets by Privy · Non-custodial keys</span>
              </div>
            </div>
          </div>

          {/* Right: glass stats card */}
          <div className="mt-8 flex w-full max-w-md justify-center lg:mt-0">
            <div className="glass-panel w-full max-w-md px-6 py-5 sm:px-7 sm:py-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400/80">
                  Snapshot
                </p>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#9ee1b7]/10 px-2.5 py-1 text-[10px] font-medium text-[#9ee1b7]">
                  <Zap className="h-3 w-3" />
                  Real-time on-chain
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-2xl border border-white/8 bg-black/40 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                    Total balance
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-50">
                    $24,320.12
                  </p>
                  <p className="mt-1 text-[10px] text-emerald-300/90">
                    +4.2% this month
                  </p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/40 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                    Earning yield
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-50">
                    $18,900.00
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400/80">
                    In Haven Flex & Plus
                  </p>
                </div>
              </div>

              {/* Fake mini chart */}
              <div className="mt-4 rounded-2xl border border-white/8 bg-black/40 px-3 py-3">
                <div className="mb-2 flex items-center justify-between text-[10px] text-slate-400/80">
                  <span>30-day cashflow</span>
                  <span className="text-[#9ee1b7]">+ $1,280</span>
                </div>
                <div className="flex items-end gap-1.5">
                  {[24, 40, 65, 52, 78, 60, 90].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-full bg-gradient-to-t from-[#6fb28a]/25 to-[#9ee1b7]"
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>
              </div>

              <p className="mt-4 text-[10px] leading-relaxed text-slate-400/90">
                Haven connects directly to your Solana wallet. No seed phrases
                in random tabs. No blind signing. Just one secure, mint-green
                surface for your USDC life.
              </p>
            </div>
          </div>
        </section>

        {/* Bottom footer-ish line */}
        <footer className="mt-4 flex items-center justify-between text-[10px] text-slate-500">
          <span>
            © {new Date().getFullYear()} Haven Labs. All rights reserved.
          </span>
          <span className="hidden gap-4 sm:flex">
            <button className="text-slate-500 hover:text-slate-300">
              Terms
            </button>
            <button className="text-slate-500 hover:text-slate-300">
              Privacy
            </button>
          </span>
        </footer>
      </div>
    </main>
  );
};

export default Landing;
