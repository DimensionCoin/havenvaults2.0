"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Zap,
  Sparkles,
  Wallet,
  BarChart3,
} from "lucide-react";
import { FloatingParticles } from "@/components/floating-particles";
import { AnimatedCounter } from "@/components/animated-counter";
import { GlowingOrbs } from "@/components/glowing-orbs";
import { HolographicCard } from "@/components/holographic-card";

const Landing = () => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Animated grid background */}
      <div className="pointer-events-none fixed inset-0 grid-pattern opacity-50" />

      {/* Scan line effect */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-scan-line" />
      </div>

      {/* Mouse follow glow */}
      <div
        className="pointer-events-none fixed h-[600px] w-[600px] rounded-full bg-primary/10 blur-[120px] transition-transform duration-300 ease-out"
        style={{
          transform: `translate(${mousePosition.x - 300}px, ${mousePosition.y - 300}px)`,
        }}
      />

      {/* Floating particles */}
      <FloatingParticles />

      {/* Glowing orbs */}
      <GlowingOrbs />

      {/* Ambient glow layers */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-72 left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[150px] animate-pulse-glow" />
        <div className="absolute bottom-[-400px] right-[-300px] h-[700px] w-[700px] rounded-full bg-accent/15 blur-[120px] animate-morph" />
        <div className="absolute top-1/2 left-[-200px] h-[500px] w-[500px] rounded-full bg-primary/10 blur-[100px] animate-float" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-10">
        {/* Top nav */}
        <header className="relative z-50 flex items-center justify-between">
          <div className="flex items-center gap-3 group">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-primary/30 bg-card/50 backdrop-blur-xl transition-all duration-500 group-hover:border-primary/60 group-hover:shadow-[0_0_30px_rgba(63,243,135,0.3)]">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-[0.3em] text-foreground uppercase">
                Haven
              </span>
              <span className="text-[10px] text-muted-foreground tracking-wider">
                Saving & investing, simplified
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/sign-in">
              <Button
                variant="ghost"
                className="hidden sm:inline-flex rounded-full border border-border bg-card/30 px-5 py-2 text-sm font-medium text-foreground backdrop-blur-xl hover:bg-card/50 hover:border-primary/30 transition-all duration-300"
              >
                Sign in
              </Button>
            </Link>

            <Link href="/sign-in">
              <Button className="rounded-full bg-primary px-6 py-2 text-sm font-bold text-primary-foreground shadow-[0_0_30px_rgba(63,243,135,0.5)] hover:shadow-[0_0_50px_rgba(63,243,135,0.7)] hover:brightness-110 transition-all duration-300 group">
                Get started
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </header>

        {/* Hero section */}
        <section
          ref={heroRef}
          className="flex flex-1 flex-col items-center justify-center py-12 md:py-20"
        >
          {/* Announcement badge */}
          <div className="mb-8 animate-float">
            <div className="glass-card neon-border rounded-full px-5 py-2 flex items-center gap-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Non-custodial · You own your keys
              </span>
              <ArrowRight className="h-3 w-3 text-primary" />
            </div>
          </div>

          {/* Main headline - Updated to match Haven's actual value prop */}
          <div className="text-center max-w-4xl">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[0.95]">
              <span className="block text-foreground">A better way to</span>
              <span className="block holographic-text mt-2">
                save and invest
              </span>
            </h1>

            <p className="mt-8 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Haven makes it easy to put money to work with simple accounts,
              clear tracking, and powerful tools — without the usual setup,
              confusion, or hidden friction. Your funds, secured by Solana.
            </p>
          </div>

          {/* CTA buttons */}
          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
            <Link href="/sign-in">
              <button className="group relative overflow-hidden rounded-full bg-primary px-8 py-4 text-base font-bold text-primary-foreground shadow-[0_0_40px_rgba(63,243,135,0.4)] transition-all duration-500 hover:shadow-[0_0_60px_rgba(63,243,135,0.6)]">
                <span className="relative z-10 flex items-center gap-2">
                  Create account
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
            </Link>

            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Sign in → dashboard → start using tools
            </span>
          </div>

          {/* Stats row - Updated with real Haven stats */}
          <div className="mt-16 w-full max-w-4xl">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { value: 8, suffix: "%", label: "Up to APY", prefix: "" },
                { value: 50, suffix: "+", label: "Assets to buy", prefix: "" },
                { value: 1, suffix: "s", label: "Transactions", prefix: "<" },
                { value: 24, suffix: "/7", label: "Stock market", prefix: "" },
              ].map((stat, i) => (
                <HolographicCard key={i} delay={i * 0.1}>
                  <div className="text-center p-5">
                    <div className="text-2xl sm:text-3xl font-bold text-foreground">
                      <span className="text-primary">{stat.prefix}</span>
                      <AnimatedCounter target={stat.value} decimals={0} />
                      <span className="text-primary">{stat.suffix}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {stat.label}
                    </div>
                  </div>
                </HolographicCard>
              ))}
            </div>
          </div>
        </section>

        {/* Features grid */}
        <section id="features" className="py-16">
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-primary mb-4">
              <Sparkles className="h-4 w-4" />
              Why Haven
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Finance of the future
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Wallet,
                title: "True Ownership",
                description:
                  "Non-custodial means you own your keys. Your assets are secured by the Solana blockchain, not a centralized company.",
              },
              {
                icon: BarChart3,
                title: "Earn & Invest",
                description:
                  "Earn 3-8% APY on your savings. Access 50+ assets, stocks & crypto, and exclusive Pre-ICO opportunities.",
              },
              {
                icon: Zap,
                title: "Instant & Always On",
                description:
                  "1-second transactions, 24/7 markets. No bank hours, no waiting days for transfers. Finance that never sleeps.",
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="group relative overflow-hidden rounded-2xl glass-card p-6 hover:border-primary/30 transition-all duration-500"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative z-10">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 mb-5 group-hover:shadow-[0_0_20px_rgba(63,243,135,0.3)] transition-all duration-500">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Trust note - Accurate disclaimer */}
        <section className="py-8">
          <p className="text-center text-xs text-muted-foreground max-w-xl mx-auto">
            Haven is non-custodial — you remain in control of your assets at all
            times. Your funds are secured by the Solana blockchain, not Haven.
          </p>
        </section>

        {/* Footer */}
        <footer className="py-8 border-t border-border/50">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Haven Labs.
            </p>
            <div className="flex items-center gap-6">
              {["Privacy", "Terms", "Security"].map((link) => (
                <Link
                  key={link}
                  href="#"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link}
                </Link>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
};

export default Landing;
