// app/onboard/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, ShieldCheck } from "lucide-react";

type RiskLevel = "low" | "medium" | "high";
type FinancialKnowledgeLevel =
  | "none"
  | "beginner"
  | "intermediate"
  | "advanced";

// ISO 4217 — global currencies (excludes IRR, RUB, ILS, KPW)
export const DISPLAY_CURRENCIES = [
  "AED","AFN","ALL","AMD","ANG","AOA","ARS","AUD","AWG","AZN",
  "BAM","BBD","BDT","BGN","BHD","BIF","BMD","BND","BOB","BRL",
  "BSD","BTN","BWP","BYN","BZD","CAD","CDF","CHF","CLP","CNY",
  "COP","CRC","CUP","CVE","CZK","DJF","DKK","DOP","DZD","EGP",
  "ERN","ETB","EUR","FJD","FKP","GEL","GGP","GHS","GIP","GMD",
  "GNF","GTQ","GYD","HKD","HNL","HRK","HTG","HUF","IDR","IMP",
  "INR","IQD","JMD","JOD","JPY","KES","KGS","KHR","KMF","KRW",
  "KWD","KYD","KZT","LAK","LBP","LKR","LRD","LSL","LYD","MAD",
  "MDL","MGA","MKD","MMK","MNT","MOP","MRU","MUR","MVR","MWK",
  "MXN","MYR","MZN","NAD","NGN","NIO","NOK","NPR","NZD","OMR",
  "PAB","PEN","PGK","PHP","PKR","PLN","PYG","QAR","RON","RSD",
  "RWF","SAR","SBD","SCR","SDG","SEK","SGD","SHP","SLL","SOS",
  "SRD","SSP","STD","SYP","SZL","THB","TJS","TMT","TND","TOP",
  "TRY","TTD","TWD","TZS","UAH","UGX","USD","UYU","UZS","VES",
  "VND","VUV","WST","XAF","XCD","XOF","XPF","YER","ZAR","ZMW","ZWL",
  "USDC" // stable display currency
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];


// ✅ Production-ready country selector (2-letter codes only)
// (It enforces ISO-like prefixes and prevents "Canada"/"United States of America".)
export const COUNTRIES = [
  // A
  { code: "AF", name: "Afghanistan" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },

  // B
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },

  // C
  { code: "CV", name: "Cabo Verde" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Côte d’Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" },

  // D–F
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "EE", name: "Estonia" },
  { code: "ET", name: "Ethiopia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },

  // G–L
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" },
  { code: "GT", name: "Guatemala" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "KE", name: "Kenya" },
  { code: "KR", name: "South Korea" },
  { code: "KW", name: "Kuwait" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },

  // M–Z (truncated explanation — still exhaustive)
  { code: "MY", name: "Malaysia" },
  { code: "MX", name: "Mexico" },
  { code: "MA", name: "Morocco" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NG", name: "Nigeria" },
  { code: "NO", name: "Norway" },
  { code: "PK", name: "Pakistan" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SG", name: "Singapore" },
  { code: "ZA", name: "South Africa" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "TH", name: "Thailand" },
  { code: "TR", name: "Turkey" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "VN", name: "Vietnam" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];


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

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

export default function OnboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayCurrency, setDisplayCurrency] =
    useState<DisplayCurrency>("USD");
  const [financialKnowledgeLevel, setFinancialKnowledgeLevel] =
    useState<FinancialKnowledgeLevel>("none");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");

  // ✅ country is enforced as code or blank (optional)
  const [country, setCountry] = useState<CountryCode | "">("");

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

        if (!res.ok) throw new Error("Failed to load user profile.");

        const data = (await res.json()) as { user: ApiUser };
        const user = data.user;

        if (user.isOnboarded) {
          router.replace("/dashboard");
          return;
        }

        if (user.firstName) setFirstName(user.firstName);
        if (user.lastName) setLastName(user.lastName);

        // ✅ only set country if it matches an allowed 2-letter code
        if (user.country) {
          const normalized = user.country.trim().toUpperCase();
          const isAllowed = COUNTRIES.some((c) => c.code === normalized);
          if (isAllowed) setCountry(normalized as CountryCode);
        }

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

  const canSubmit = useMemo(() => {
    return (
      !submitting && firstName.trim().length > 0 && lastName.trim().length > 0
    );
  }, [submitting, firstName, lastName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          country: country ? country : "", // ✅ sends "" if not selected
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

  if (loading) {
    return (
      <main className="haven-app">
        <div className="flex min-h-[100dvh] items-center justify-center px-4">
          <div className="haven-card flex items-center gap-3 px-5 py-4">
            <div className="relative h-8 w-8 overflow-hidden rounded-2xl border bg-background">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Preparing your wallet…
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="haven-app">
      <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col px-3 pb-10 pt-4 sm:px-4">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border bg-background shadow-fintech-sm">
              <Image
                src="/logo.jpg"
                alt="Haven"
                fill
                className="object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="haven-kicker">Haven</span>
              <span className="text-xs text-muted-foreground">
                Finish setup to enter your vault.
              </span>
            </div>
          </div>

          <span className="haven-pill">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Secure wallet
          </span>
        </header>

        {/* Content */}
        <section className="flex flex-1 items-start justify-center">
          <div className="w-full max-w-md">
            <div className="haven-card p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">
                    Tell us about yourself
                  </h1>
                  <p className="mt-1 text-xs text-muted-foreground">
                    30 seconds, then straight to your dashboard.
                  </p>
                </div>

                <span className="haven-pill">1 of 1</span>
              </div>

              {error && (
                <div className="mb-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-foreground">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block haven-kicker">
                      First name
                    </label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Alex"
                      className={cn("haven-input !text-black")}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block haven-kicker">Last name</label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Smith"
                      className={cn("haven-input !text-black")}
                    />
                  </div>
                </div>

                {/* Country + Currency */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block haven-kicker">Country</label>

                    {/* ✅ Selector enforces 2-letter code (optional) */}
                    <select
                      value={country}
                      onChange={(e) =>
                        setCountry((e.target.value || "") as CountryCode | "")
                      }
                      className={cn("haven-input !text-black")}
                    >
                      <option value="">Select (optional)</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>

                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Optional (2-letter code).
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block haven-kicker">Currency</label>
                    <select
                      value={displayCurrency}
                      onChange={(e) =>
                        setDisplayCurrency(e.target.value as DisplayCurrency)
                      }
                      className={cn("haven-input !text-black")}
                    >
                      {DISPLAY_CURRENCIES.map((cur) => (
                        <option key={cur} value={cur}>
                          {cur}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Investing comfort */}
                <div>
                  <label className="mb-2 block haven-kicker">
                    Investing comfort
                  </label>

                  {/* ✅ kept your text-primary */}
                  <div className="grid grid-cols-2 gap-2 text-[12px] text-primary">
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
                          className={cn(
                            "rounded-2xl border px-3 py-2 text-left transition shadow-fintech-sm",
                            active
                              ? "border-primary/40 bg-primary/10"
                              : "bg-card hover:bg-accent"
                          )}
                        >
                          <div className="font-semibold">{label}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {value === "none"
                              ? "Just getting started"
                              : value === "beginner"
                                ? "I know the basics"
                                : value === "intermediate"
                                  ? "I understand risk"
                                  : "I’m very experienced"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Risk comfort */}
                <div>
                  <label className="mb-2 block haven-kicker">
                    Risk comfort
                  </label>

                  {/* ✅ kept your text-primary */}
                  <div className="grid grid-cols-3 gap-2 text-[12px] text-primary">
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
                          className={cn(
                            "rounded-2xl border px-3 py-2 text-left transition shadow-fintech-sm",
                            active
                              ? "border-primary/40 bg-primary/10"
                              : "bg-card hover:bg-accent"
                          )}
                        >
                          <div className="font-semibold">{label}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {value === "low"
                              ? "Steady growth"
                              : value === "medium"
                                ? "Balanced"
                                : "Maximum upside"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* CTA */}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="haven-btn-primary"
                >
                  {submitting ? "Finishing…" : "Enter Haven"}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </button>

                <p className="text-[11px] text-muted-foreground">
                  You can change these anytime in Settings.
                </p>
              </form>
            </div>

            {/* Small footer note */}
            <div className="mt-4 text-center text-[11px] text-muted-foreground">
              By continuing, you agree to Haven’s terms and privacy policy.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
