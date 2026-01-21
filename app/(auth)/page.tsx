// app/(marketing)/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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

type ApyResponse = {
  apy?: number; // decimal (e.g. 0.0587)
  apyPercentage?: string; // "5.87"
  error?: string;
};

const Landing = () => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Dynamic APY (fetched once, used everywhere on page)
  const [apyPct, setApyPct] = useState<number | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (window.innerWidth > 768) {
        setMousePosition({ x: e.clientX, y: e.clientY });
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/savings/plus/apy", {
          cache: "no-store",
          signal: controller.signal,
        });

        const data = (await res.json()) as ApyResponse;

        // Prefer pre-formatted percent string from API
        const n = Number(data?.apyPercentage);

        if (Number.isFinite(n)) {
          setApyPct(n);
          return;
        }

        // Fallback to decimal if provided
        if (typeof data?.apy === "number" && Number.isFinite(data.apy)) {
          setApyPct(data.apy * 100);
        }
      } catch {
        // leave apyPct null -> fallback copy
      }
    })();

    return () => controller.abort();
  }, []);

  const apyText = useMemo(() => {
    if (apyPct == null) return null;
    // Remove trailing .00 for cleaner marketing
    return apyPct.toFixed(2).replace(/\.00$/, "");
  }, [apyPct]);

  // Strings used throughout the page (no “crypto”/USDC talk)
  const apyStatValue = apyText ? `${apyText}%` : "—";

  const heroSubcopy =
    "Haven is a modern money app with a high-yield savings account, simple investing, and total control — with a clean experience that feels familiar from day one.";

  const havenSavingsLine = apyText
    ? `Earn ${apyText}% APY with Haven Savings`
    : "Earn high-yield savings with Haven";

  const highYieldDesc = apyText
    ? `Earn ${apyText}% APY on your savings balance. Your money can grow automatically, with a smooth experience and clear control.`
    : `Earn high-yield savings on your balance. Your money can grow automatically, with a smooth experience and clear control.`;

  // ✅ Updated (no “audited” claims, no unverifiable promises)
  const trustTitle = "Built for control, built with care";
  const trustBody =
    "We’re building Haven with a security-first mindset: strong sign-in protections, careful handling of sensitive data, and clear user control over assets.";

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
          transform: `translate(${mousePosition.x - 250}px, ${
            mousePosition.y - 250
          }px)`,
        }}
      />

      {/* Top ambient glow */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-[400px] left=1/2 h-[800px] w-[1200px] -translate-x-1/2 rounded-full bg-primary/[0.08] blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
        {/* Navigation */}
        <header className="relative z-50 flex items-center justify-between">
          <div className="flex gap-4 md:gap-6 items-center">
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
              <span className="text-lg font-semibold tracking-tight">
                Haven
              </span>
            </Link>

            <ThemeToggle />
          </div>
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
                Self-directed · You stay in control
              </span>
            </div>
          </div>

          {/* Headline */}
          <div className="text-center max-w-3xl">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1]">
              <span className="text-foreground">Your money, </span>
              <span className="bg-gradient-to-r from-primary via-primary to-primary bg-clip-text text-transparent">
                upgraded
              </span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {heroSubcopy}
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
              { value: apyStatValue, label: "Savings APY" },
              { value: "50+", label: "Investable assets" },
              { value: "~1s", label: "Fast settlement" },
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
              A better way to save and invest
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              Most finance apps still feel like tradeoffs: low interest, slow
              movement, and limited flexibility. Haven is built to feel modern —
              without the learning curve.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Traditional - Problems */}
            <div className="rounded-3xl border border-border bg-background/60 p-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive mb-6">
                Typical apps & banks
              </div>
              <ul className="space-y-4">
                {[
                  "Tiny interest rates on cash",
                  "Transfers that take days",
                  "Complex menus and hidden tradeoffs",
                  "Fees that are hard to understand",
                  "Limited control over how your money works",
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
                  havenSavingsLine,
                  "Move any amount of money fast",
                  "Simple, clean interface that feels familiar",
                  "Clear pricing with no surprises",
                  "More control and more freedom",
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
              A modern experience for saving and investing — built for clarity,
              speed, and control.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: Banknote,
                title: "High-Yield Savings",
                description: highYieldDesc,
              },
              {
                icon: TrendingUp,
                title: "Simple Investing",
                description:
                  "Build a portfolio with a few taps. No jargon, no messy screens — just clean choices and clear pricing.",
              },
              {
                icon: Clock,
                title: "Fast Access",
                description:
                  "Deposits, withdrawals, and trades are designed to feel instant — so your money is ready when you are.",
              },
              {
                icon: Shield,
                title: "Security-First",
                description:
                  "Strong security from day one: protected sessions, modern authentication, and careful handling of sensitive data.",
              },
              {
                icon: Smartphone,
                title: "Familiar UI",
                description:
                  "Feels like the best consumer finance apps — minimal, fast, and easy to understand.",
              },
              {
                icon: Percent,
                title: "Transparent Fees",
                description:
                  "Pricing is clear before you confirm. No surprise charges and no confusing fine print.",
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
              No paperwork. No waiting. Just a clean setup and you&apos;re in.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Create your account",
                description:
                  "Sign up in seconds. We’ll guide you through a smooth, secure setup.",
              },
              {
                step: "02",
                title: "Add funds",
                description:
                  "Add funds the way you prefer, then choose savings or investing — all in one place.",
              },
              {
                step: "03",
                title: "Start growing",
                description:
                  "Earn a competitive savings rate, build a portfolio, and stay in control the whole time.",
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
              How we think about safety
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-foreground max-w-2xl mx-auto">
              {trustTitle}
            </h2>

            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              {trustBody}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-muted-foreground">
              <span>Protected sign-in</span>
              <span className="hidden sm:inline">·</span>
              <span>Privacy-minded design</span>
              <span className="hidden sm:inline">·</span>
              <span>User-controlled assets</span>
              <span className="hidden sm:inline">·</span>
              <span>Clear, simple UX</span>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
            Ready to upgrade your money?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-lg mx-auto">
            A modern place to save and invest — built for people who want more
            control, more freedom, and a better experience.
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
            No credit checks · No minimum balance · Start in under 1 minute
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
                © {new Date().getFullYear()} Haven Vaults
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
            Haven is non-custodial software. You control your assets. Rates can
            change and are not guaranteed. Savings yield may be generated using
            tokenized cash equivalents (e.g., stable-value digital dollars). Not
            available in all regions. Investing involves risk.
          </p>
        </footer>
      </div>
    </main>
  );
};

export default Landing;
