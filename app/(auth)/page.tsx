// app/(marketing)/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Shield,
  Percent,
  Clock,
  Smartphone,
  Lock,
  TrendingUp,
  Banknote,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

const Landing = () => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (window.innerWidth > 768) {
        setMousePosition({ x: e.clientX, y: e.clientY });
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] text-white">
      {/* Subtle grid */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Mouse follow glow - subtle */}
      <div
        className="pointer-events-none fixed h-[500px] w-[500px] rounded-full bg-emerald-500/[0.07] blur-[100px] transition-transform duration-500 ease-out hidden md:block"
        style={{
          transform: `translate(${mousePosition.x - 250}px, ${mousePosition.y - 250}px)`,
        }}
      />

      {/* Top ambient glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-[400px] left-1/2 h-[800px] w-[1200px] -translate-x-1/2 rounded-full bg-emerald-500/[0.08] blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
        {/* Navigation */}
        <header className="relative z-50 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm transition-all group-hover:border-emerald-500/30">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
                priority
              />
            </div>
            <span className="text-lg font-semibold tracking-tight">Haven</span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="hidden sm:inline-flex rounded-full px-5 py-2.5 text-sm font-medium text-white/70 transition-colors hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-emerald-400"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="flex flex-1 flex-col items-center justify-center py-16 md:py-24">
          {/* Trust badge */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 backdrop-blur-sm">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20">
                <Lock className="h-3 w-3 text-emerald-400" />
              </div>
              <span className="text-sm text-white/60">
                Non-custodial · Your keys, your money
              </span>
            </div>
          </div>

          {/* Headline */}
          <div className="text-center max-w-3xl">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1]">
              <span className="text-white">Banking that </span>
              <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
                works for you
              </span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-white/50 max-w-2xl mx-auto leading-relaxed">
              Haven gives you a savings account with real yield, instant
              investing, and complete control — all without the complexity of
              crypto.
            </p>
          </div>

          {/* CTA */}
          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <Link
              href="/sign-in"
              className="group relative overflow-hidden rounded-full bg-emerald-500 px-8 py-4 text-base font-semibold text-black transition-all hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.3)]"
            >
              <span className="flex items-center gap-2">
                Open your account
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>

            <span className="text-sm text-white/40">
              Free to start · No minimum deposit
            </span>
          </div>

          {/* Value props row */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-3xl">
            {[
              { value: "8%", label: "APY on savings" },
              { value: "50+", label: "Assets to invest" },
              { value: "<1s", label: "Transaction speed" },
              { value: "24/7", label: "Always available" },
            ].map((stat, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-center backdrop-blur-sm"
              >
                <div className="text-2xl font-bold text-emerald-400">
                  {stat.value}
                </div>
                <div className="mt-1 text-xs text-white/40">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Problem/Solution */}
        <section className="py-20 border-t border-white/[0.06]">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              The bank account you deserve
            </h2>
            <p className="mt-4 text-lg text-white/40 max-w-xl mx-auto">
              Traditional banks pay you nothing. Crypto is confusing. Haven is
              the middle ground.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Traditional Banking - Problems */}
            <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 mb-6">
                Traditional Banking
              </div>
              <ul className="space-y-4">
                {[
                  "0.01% APY on savings",
                  "Limited to bank hours",
                  "Days to transfer money",
                  "Hidden fees everywhere",
                  "They control your money",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-white/50">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-500/50 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Haven - Solutions */}
            <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.03] p-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 mb-6">
                <Sparkles className="h-3 w-3" />
                Haven
              </div>
              <ul className="space-y-4">
                {[
                  "Up to 8% APY on savings",
                  "Available 24/7, no downtime",
                  "Instant transfers, always",
                  "Transparent, minimal fees",
                  "You own your money completely",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-white/80">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 border-t border-white/[0.06]">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Everything you need, nothing you don&apos;t
            </h2>
            <p className="mt-4 text-lg text-white/40 max-w-xl mx-auto">
              We handle the complexity of DeFi so you can focus on what matters
              — growing your money.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: Banknote,
                title: "High-Yield Savings",
                description:
                  "Earn 3-8% APY on your deposits. Your money works while you sleep, powered by battle-tested DeFi protocols.",
              },
              {
                icon: TrendingUp,
                title: "Simple Investing",
                description:
                  "Buy stocks, crypto, and more with a few taps. No jargon, no complicated interfaces — just clear choices.",
              },
              {
                icon: Clock,
                title: "Instant Everything",
                description:
                  "Deposits, withdrawals, trades — all happen in seconds. No waiting days for your money to move.",
              },
              {
                icon: Shield,
                title: "You&apos;re in Control",
                description:
                  "Non-custodial means we never hold your funds. Your keys, your money — always.",
              },
              {
                icon: Smartphone,
                title: "Familiar Interface",
                description:
                  "Looks like the banking apps you know. No crypto complexity — just a clean, simple experience.",
              },
              {
                icon: Percent,
                title: "No Hidden Fees",
                description:
                  "Transparent pricing on everything. See exactly what you&apos;re paying before you confirm.",
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 transition-all hover:border-white/10 hover:bg-white/[0.03]"
              >
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 mb-4 transition-all group-hover:bg-emerald-500/15">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-white/40 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 border-t border-white/[0.06]">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Get started in minutes
            </h2>
            <p className="mt-4 text-lg text-white/40">
              No paperwork. No waiting. No crypto knowledge required.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Create your account",
                description:
                  "Sign up with email or phone. We&apos;ll create a secure wallet for you automatically.",
              },
              {
                step: "02",
                title: "Add funds",
                description:
                  "Deposit USDC or connect your bank. Your money is ready to use instantly.",
              },
              {
                step: "03",
                title: "Start earning",
                description:
                  "Put your money in savings for yield, or invest in assets you believe in.",
              },
            ].map((item, i) => (
              <div key={i} className="relative">
                <div className="text-6xl font-bold text-white/[0.03] absolute -top-4 left-0">
                  {item.step}
                </div>
                <div className="relative pt-8">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-semibold text-emerald-400 mb-4">
                    {item.step}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-white/40 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Social proof / Trust */}
        <section className="py-20 border-t border-white/[0.06]">
          <div className="rounded-3xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent p-10 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 mb-6">
              <Shield className="h-4 w-4" />
              Built on Solana
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-white max-w-2xl mx-auto">
              Your money is secured by blockchain technology, not a bank vault
            </h2>

            <p className="mt-4 text-white/40 max-w-xl mx-auto">
              Every transaction is verified on Solana — one of the fastest, most
              secure blockchains. You can verify your funds anytime, anywhere.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-white/30">
              <span>Audited protocols</span>
              <span className="hidden sm:inline">·</span>
              <span>Open source</span>
              <span className="hidden sm:inline">·</span>
              <span>Non-custodial</span>
              <span className="hidden sm:inline">·</span>
              <span>Your keys</span>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Ready to make your money work?
          </h2>
            <p className="mt-4 text-lg text-white/40 max-w-lg mx-auto">
            Join thousands who&apos;ve moved past 0% savings accounts. Your future
            self will thank you.
          </p>

          <div className="mt-8">
            <Link
              href="/sign-in"
              className="group inline-flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-4 text-base font-semibold text-black transition-all hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.3)]"
            >
              Create free account
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <p className="mt-4 text-sm text-white/30">
            No credit check · No minimum balance · Start in 2 minutes
          </p>
        </section>

        {/* Footer */}
        <footer className="py-8 border-t border-white/[0.06]">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative h-8 w-8 overflow-hidden rounded-lg">
                <Image
                  src="/logo.jpg"
                  alt="Haven"
                  fill
                  className="object-contain"
                />
              </div>
              <span className="text-sm text-white/40">
                © {new Date().getFullYear()} Haven Labs
              </span>
            </div>

            <div className="flex items-center gap-6">
              {[
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
                { label: "Security", href: "/security" },
              ].map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-sm text-white/40 transition-colors hover:text-white/60"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <p className="mt-6 text-xs text-white/20 text-center max-w-2xl mx-auto">
            Haven is non-custodial software. You maintain sole control of your
            private keys and assets. Haven Labs does not have access to your
            funds. Cryptocurrency investments are volatile and may lose value.
          </p>
        </footer>
      </div>
    </main>
  );
};

export default Landing;
