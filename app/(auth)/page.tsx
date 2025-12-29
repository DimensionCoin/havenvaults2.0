"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, Lock, Zap, ArrowUpRight } from "lucide-react";

const Landing = () => {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient glow (match app vibe) */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-72 left-1/2 h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-primary/18 blur-3xl" />
        <div className="absolute bottom-[-320px] right-[-220px] h-[680px] w-[680px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-y-0 left-0 w-[40%] bg-gradient-to-tr from-primary/10 via-transparent to-transparent" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-10">
        {/* Top nav */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-black/30 backdrop-blur-xl">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
                priority
              />
            </div>

            <div className="flex flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/70">
                Haven
              </span>
              <span className="text-[11px] text-white/50">
                Saving & investing, simplified.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/sign-in">
              <Button
                variant="ghost"
                className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur-xl hover:bg-white/10 sm:inline-flex"
              >
                Sign in
              </Button>
            </Link>

            <Link href="/sign-in">
              <Button className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] hover:brightness-105">
                Get started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </header>

        {/* Center content */}
        <section className="flex flex-1 flex-col items-center justify-center py-12">
          <div className="w-full max-w-2xl">
            {/* Hero panel */}
            <div className="rounded-3xl border border-zinc-800 bg-white/10 p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/70">
                  <Lock className="h-3 w-3" />
                  Non-custodial
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/70">
                  <Zap className="h-3 w-3 text-primary" />
                  Gas sponsored in-app
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/70">
                  <Shield className="h-3 w-3 text-primary" />
                  Secure by design
                </span>
              </div>

              <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                A better way to save and invest.
              </h1>

              <p className="mt-3 text-sm text-white/70 sm:text-base">
                Haven makes it easy to put money to work with simple accounts,
                clear tracking, and powerful tools — without the usual setup,
                confusion, or hidden friction.
              </p>

              {/* What we solve */}
              <div className="mt-5 space-y-2">
                {[
                  {
                    title: "What Haven solves",
                    body: "Most apps are either too complicated or too limited. Haven gives you a clean home for saving, investing, and managing your money in one place.",
                  },
                  {
                    title: "What you get",
                    body: "Savings accounts, investing access, portfolio tracking, and tools designed to maximize returns — all inside one dashboard.",
                  },
                  {
                    title: "Why sign up",
                    body: "Start in minutes, stay in control, and grow with features that scale from beginner to power user.",
                  },
                ].map((row) => (
                  <div
                    key={row.title}
                    className="rounded-2xl border border-zinc-800 bg-black/25 px-4 py-3"
                  >
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
                      {row.title}
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-white/70">
                      {row.body}
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/sign-in" className="w-full sm:w-auto">
                  <button className="haven-primary-btn w-full sm:w-auto px-5">
                    Create account
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </Link>

                <div className="flex items-center gap-2 text-[11px] text-white/55">
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                  <span>Sign in → dashboard → start using tools</span>
                </div>
              </div>
            </div>

            {/* Minimal footer note */}
            <p className="mt-4 text-center text-[11px] text-white/40">
              Haven is non-custodial — you remain in control of your assets.
            </p>
          </div>
        </section>

        <footer className="pb-6 text-center text-[10px] text-white/30">
          © {new Date().getFullYear()} Haven Labs.
        </footer>
      </div>
    </main>
  );
};

export default Landing;
