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
import ThemeToggle from "@/components/shared/ThemeToggle";

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
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
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
        className="pointer-events-none fixed h-[500px] w-[500px] rounded-full bg-primary/[0.07] blur-[100px] transition-transform duration-500 ease-out hidden md:block"
        style={{
          transform: `translate(${mousePosition.x - 250}px, ${mousePosition.y - 250}px)`,
        }}
      />

      {/* Top ambient glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-[400px] left-1/2 h-[800px] w-[1200px] -translate-x-1/2 rounded-full bg-primary/[0.08] blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
        {/* Navigation */}
        <header className="relative z-50 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-border bg-background/60 backdrop-blur-sm transition-all group-hover:border-primary/30">
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

          <ThemeToggle />
          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="hidden sm:inline-flex rounded-full px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-primary/90 "
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
            <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-background/60 px-4 py-2 backdrop-blur-sm">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                <Lock className="h-3 w-3 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">
                Non-custodial · Your keys, your money
              </span>
            </div>
          </div>

          {/* Headline */}
          <div className="text-center max-w-3xl">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1]">
              <span className="text-foreground">Banking that </span>
              <span className="bg-gradient-to-r from-primary via-primary to-primary bg-clip-text text-transparent">
                works for you
              </span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Haven gives you a savings account with real yield, instant
              investing, and complete control — all without the complexity of
              crypto.
            </p>
          </div>

          {/* CTA */}
          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <Link
              href="/sign-in"
              className="group relative overflow-hidden rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-[0_0_40px_hsl(var(--primary)/0.30)]"
            >
              <span className="flex items-center gap-2 text-black">
                Open your account
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>

            <span className="text-sm text-muted-foreground">
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
                className="rounded-2xl border border-border bg-background/60 p-5 text-center backdrop-blur-sm"
              >
                <div className="text-2xl font-bold text-primary">
                  {stat.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Problem/Solution */}
        <section className="py-20 border-t border-border">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              The bank account you deserve
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              Traditional banks pay you nothing. Crypto is confusing. Haven is
              the middle ground.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Traditional Banking - Problems */}
            <div className="rounded-3xl border border-border bg-background/60 p-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive mb-6">
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
                  <li
                    key={i}
                    className="flex items-start gap-3 text-muted-foreground"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-destructive/50 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Haven - Solutions */}
            <div className="rounded-3xl border border-primary/30 bg-primary/[0.06] p-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary mb-6">
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
                  <li
                    key={i}
                    className="flex items-start gap-3 text-foreground/90"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 border-t border-border">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Everything you need, nothing you don&apos;t
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
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
                className="group rounded-2xl border border-border bg-background/60 p-6 transition-all hover:border-border hover:bg-accent"
              >
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4 transition-all group-hover:bg-primary/15">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 border-t border-border">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Get started in minutes
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
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
                <div className="text-6xl font-bold text-foreground/5 absolute -top-4 left-0">
                  {item.step}
                </div>
                <div className="relative pt-8">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary mb-4">
                    {item.step}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Social proof / Trust */}
        <section className="py-20 border-t border-border">
          <div className="rounded-3xl border border-border bg-gradient-to-b from-background/60 to-transparent p-10 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary mb-6">
              <Shield className="h-4 w-4" />
              Built on Solana
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-foreground max-w-2xl mx-auto">
              Your money is secured by blockchain technology, not a bank vault
            </h2>

            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Every transaction is verified on Solana — one of the fastest, most
              secure blockchains. You can verify your funds anytime, anywhere.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-muted-foreground">
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
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Ready to make your money work?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-lg mx-auto">
            Join thousands who&apos;ve moved past 0% savings accounts. Your
            future self will thank you.
          </p>

          <div className="mt-8">
            <Link
              href="/sign-in"
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-[0_0_40px_hsl(var(--primary)/0.30)]"
            >
              Create free account
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            No credit check · No minimum balance · Start in 2 minutes
          </p>
        </section>

        {/* Footer */}
        <footer className="py-8 border-t border-border">
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
              <span className="text-sm text-muted-foreground">
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
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <p className="mt-6 text-xs text-muted-foreground text-center max-w-2xl mx-auto">
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
