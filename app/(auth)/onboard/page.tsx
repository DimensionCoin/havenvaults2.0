// app/onboard/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, ShieldCheck } from "lucide-react";

type RiskLevel = "low" | "medium" | "high";
type FinancialKnowledgeLevel =
  | "none"
  | "beginner"
  | "intermediate"
  | "advanced";

// Keep this in sync with the backend DISPLAY_CURRENCIES.
const DISPLAY_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "JPY",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "BRL",
  "MXN",
  "SGD",
  "HKD",
  "INR",
  "ZAR",
  "USDC",
] as const;

type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

type ApiUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  country?: string | null;
  displayCurrency: DisplayCurrency;
  financialKnowledgeLevel?: FinancialKnowledgeLevel;
  riskLevel?: RiskLevel;
  isOnboarded: boolean;
};

export default function OnboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState("");
  const [displayCurrency, setDisplayCurrency] =
    useState<DisplayCurrency>("USD");
  const [financialKnowledgeLevel, setFinancialKnowledgeLevel] =
    useState<FinancialKnowledgeLevel>("none");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");

  // Load current user to prefill defaults
  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/auth/user", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (res.status === 401 || res.status === 404) {
          router.replace("/sign-in");
          return;
        }

        if (!res.ok) {
          throw new Error("Failed to load user profile.");
        }

        const data = (await res.json()) as { user: ApiUser };
        const user = data.user;

        // If already onboarded, skip this page
        if (user.isOnboarded) {
          router.replace("/dashboard");
          return;
        }

        if (user.firstName) setFirstName(user.firstName);
        if (user.lastName) setLastName(user.lastName);
        if (user.country) setCountry(user.country);

        setDisplayCurrency(user.displayCurrency || "USD");
        setFinancialKnowledgeLevel(user.financialKnowledgeLevel || "none");
        setRiskLevel(user.riskLevel || "low");
      } catch (err) {
        console.error("Onboard load error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load your account."
        );
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          country: country.trim(),
          displayCurrency,
          financialKnowledgeLevel,
          riskLevel,
        }),
      });

      const data: { error?: string } = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to complete onboarding."
        );
      }

      router.replace("/dashboard");
    } catch (err) {
      console.error("Onboard submit error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong saving your details."
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* Loading state – minimal */
  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-50">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="flex items-center gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/90 px-6 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.85)]">
            <div className="relative h-8 w-8 overflow-hidden rounded-2xl border border-zinc-700 bg-black/70">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
              />
            </div>
            <p className="text-xs text-zinc-300">Preparing your wallet…</p>
          </div>
        </div>
      </main>
    );
  }

  /* Main onboarding UI – single centered card, super short copy */
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-3 pb-8 pt-4 sm:px-4">
        {/* Top bar */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-black/80">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-zinc-400">
                Haven
              </span>
              <span className="text-xs text-zinc-500">
                Tell us about yourself.
              </span>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-black/70 px-3 py-1 text-[11px] text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
            Secure wallet
          </span>
        </header>

        {/* Card */}
        <section className="flex flex-1 items-start justify-center">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.9)] sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-zinc-50">
                  Tell us about yourself
                </h1>
                <p className="mt-1 text-xs text-zinc-500">
                  30 seconds, then straight to your vault.
                </p>
              </div>
              <span className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] text-zinc-400">
                1 of 1
              </span>
            </div>

            {error && (
              <div className="mb-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-100">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
              {/* Name */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                    First name
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[rgb(182,255,62)] focus:ring-2 focus:ring-[rgb(182,255,62)]/30"
                    placeholder="Alex"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                    Last name
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[rgb(182,255,62)] focus:ring-2 focus:ring-[rgb(182,255,62)]/30"
                    placeholder="Smith"
                  />
                </div>
              </div>

              {/* Country + currency */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                    Country
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    value={country}
                    onChange={(e) => setCountry(e.target.value.toUpperCase())}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[rgb(182,255,62)] focus:ring-2 focus:ring-[rgb(182,255,62)]/30"
                    placeholder="US, CA…"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                    Currency
                  </label>
                  <select
                    value={displayCurrency}
                    onChange={(e) =>
                      setDisplayCurrency(e.target.value as DisplayCurrency)
                    }
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[rgb(182,255,62)] focus:ring-2 focus:ring-[rgb(182,255,62)]/30"
                  >
                    {DISPLAY_CURRENCIES.map((cur) => (
                      <option key={cur} value={cur}>
                        {cur}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Investing comfort – keep super compact */}
              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                  Investing comfort
                </label>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {(
                    [
                      ["none", "New"],
                      ["beginner", "Beginner"],
                      ["intermediate", "Comfortable"],
                      ["advanced", "Advanced"],
                    ] as [FinancialKnowledgeLevel, string][]
                  ).map(([value, label]) => {
                    const active = financialKnowledgeLevel === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFinancialKnowledgeLevel(value)}
                        className={[
                          "rounded-2xl border px-3 py-2 text-left transition",
                          active
                            ? "border-[rgb(182,255,62)] bg-[rgb(182,255,62)]/10 text-[rgb(229,255,196)] shadow-[0_0_18px_rgba(190,242,100,0.4)]"
                            : "border-zinc-800 bg-zinc-950 text-zinc-200 hover:border-[rgb(182,255,62)]/60",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Risk comfort – compact */}
              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                  Risk comfort
                </label>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {(
                    [
                      ["low", "Low"],
                      ["medium", "Med"],
                      ["high", "High"],
                    ] as [RiskLevel, string][]
                  ).map(([value, label]) => {
                    const active = riskLevel === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRiskLevel(value)}
                        className={[
                          "rounded-2xl border px-3 py-2 text-left transition",
                          active
                            ? "border-emerald-400 bg-emerald-500/12 text-emerald-100"
                            : "border-zinc-800 bg-zinc-950 text-zinc-200 hover:border-emerald-400/60",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !firstName.trim() || !lastName.trim()}
                className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[rgb(182,255,62)] px-4 py-2.5 text-sm font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-[rgb(182,255,62)]/50 disabled:shadow-none"
              >
                {submitting ? "Finishing…" : "Enter Haven"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>

              <p className="mt-2 text-[10px] text-zinc-500">
                One quick setup. You can edit this anytime in Settings.
              </p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
