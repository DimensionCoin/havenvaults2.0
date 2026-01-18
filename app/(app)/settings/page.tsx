// app/(app)/settings/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Copy,
  Check,
  AlertCircle,
  Globe2,
  Info,
  KeyRound,
  ShieldAlert,
  UserRound,
  Wallet,
  MoonStar,
} from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import ThemeToggle from "@/components/shared/ThemeToggle";

// ---- Keep these aligned with your server types ----
type RiskLevel = "low" | "medium" | "high";
type FinancialKnowledgeLevel =
  | "none"
  | "beginner"
  | "intermediate"
  | "advanced";

// ISO 4217 — global currencies (excludes IRR, RUB, ILS, KPW)
export const DISPLAY_CURRENCIES = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GEL",
  "GGP",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HRK",
  "HTG",
  "HUF",
  "IDR",
  "IMP",
  "INR",
  "IQD",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLL",
  "SOS",
  "SRD",
  "SSP",
  "STD",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
  "ZWL",
  "USDC", // stable display currency
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

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

const RISK_OPTIONS: {
  value: RiskLevel;
  label: string;
  description: string;
}[] = [
  {
    value: "low",
    label: "Low",
    description: "Capital preservation first. Prefer savings & stable assets.",
  },
  {
    value: "medium",
    label: "Medium",
    description:
      "Comfortable with some volatility for higher potential return.",
  },
  {
    value: "high",
    label: "High",
    description:
      "Chasing growth. Comfortable with large swings in portfolio value.",
  },
];

const KNOWLEDGE_OPTIONS: {
  value: FinancialKnowledgeLevel;
  label: string;
  description: string;
}[] = [
  {
    value: "none",
    label: "New to this",
    description: "I’m just getting started. Please keep things simple.",
  },
  {
    value: "beginner",
    label: "Beginner",
    description: "I understand the basics but still learning.",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "Comfortable with most concepts and risk.",
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "I follow markets closely and understand complex strategies.",
  },
];

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const SettingsPage: React.FC = () => {
  const router = useRouter();
  const { user, refresh, loading: userLoading } = useUser();

  // ------ Privy hooks for wallet export ------
  const { ready: privyReady, authenticated, user: privyUser } = usePrivy();
  const { exportWallet } = useExportWallet();

  const privySolWallet = useMemo(() => {
    if (!privyUser?.linkedAccounts) return undefined;
    return privyUser.linkedAccounts.find(
      (account): account is WalletWithMetadata =>
        account.type === "wallet" &&
        account.walletClientType === "privy" &&
        account.chainType === "solana"
    );
  }, [privyUser]);

  const canExportWallet = privyReady && authenticated && !!privySolWallet;

  // ------ avatar state ------
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // ------ form state ------
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [country, setCountry] = useState<CountryCode | "">("");
  const [displayCurrency, setDisplayCurrency] =
    useState<DisplayCurrency>("USD");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");
  const [knowledgeLevel, setKnowledgeLevel] =
    useState<FinancialKnowledgeLevel>("none");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [copiedWallet, setCopiedWallet] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);

  // ------ wallet export modal state ------
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const resetExportModal = () => {
    setExportModalOpen(false);
    setExportAcknowledged(false);
    setExporting(false);
    setExportError(null);
  };

  // Close our modal when the Privy export pop-up closes and the user returns
  useEffect(() => {
    if (!exportModalOpen || !exporting) return;

    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      resetExportModal();
    };

    const onFocus = () => setTimeout(closeOnce, 150);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setTimeout(closeOnce, 150);
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [exportModalOpen, exporting]);

  // hydrate form from user
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName || "");
    setLastName(user.lastName || "");
    if (user.country) {
      const normalized = user.country.trim().toUpperCase();
      const isAllowed = COUNTRIES.some((c) => c.code === normalized);
      setCountry(isAllowed ? (normalized as CountryCode) : "");
    } else {
      setCountry("");
    }
    setDisplayCurrency((user.displayCurrency || "USD") as DisplayCurrency);
    setRiskLevel((user.riskLevel || "low") as RiskLevel);
    setKnowledgeLevel(
      (user.financialKnowledgeLevel || "none") as FinancialKnowledgeLevel
    );
  }, [user]);

  const initialState = useMemo(
    () => ({
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      country: (() => {
        const raw = (user?.country || "").trim().toUpperCase();
        return COUNTRIES.some((c) => c.code === raw) ? raw : "";
      })(),
      displayCurrency: (user?.displayCurrency || "USD") as DisplayCurrency,
      riskLevel: (user?.riskLevel || "low") as RiskLevel,
      knowledgeLevel: (user?.financialKnowledgeLevel ||
        "none") as FinancialKnowledgeLevel,
    }),
    [user]
  );

  const isDirty =
    firstName !== initialState.firstName ||
    lastName !== initialState.lastName ||
    country !== initialState.country ||
    displayCurrency !== initialState.displayCurrency ||
    riskLevel !== initialState.riskLevel ||
    knowledgeLevel !== initialState.knowledgeLevel;

  // avatar handlers
  const handleAvatarClick = () => {
    if (avatarInputRef.current && !uploadingAvatar) {
      avatarInputRef.current.click();
    }
  };

  const handleAvatarChange: React.ChangeEventHandler<HTMLInputElement> = async (
    e
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarError(null);
    setUploadingAvatar(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/user/avatar", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data: { error?: string } = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to upload avatar."
        );
      }

      await refresh();
    } catch (err) {
      console.error("Avatar upload error:", err);
      setAvatarError(
        err instanceof Error
          ? err.message
          : "Something went wrong uploading your photo."
      );
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  // save handler
  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    if (!user || !isDirty || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/user/update", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          country: country || null,
          displayCurrency,
          riskLevel,
          financialKnowledgeLevel: knowledgeLevel,
        }),
      });

      const data: { error?: string } = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to update profile."
        );
      }

      await refresh();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error("Profile save error:", err);
      setSaveError(
        err instanceof Error
          ? err.message
          : "Something went wrong saving your changes."
      );
    } finally {
      setSaving(false);
    }
  };

  // copy handlers
  const handleCopyWallet = async () => {
    if (!user?.walletAddress) return;
    try {
      await navigator.clipboard.writeText(user.walletAddress);
      setCopiedWallet(true);
      setTimeout(() => setCopiedWallet(false), 1500);
    } catch (err) {
      console.error("Failed to copy wallet:", err);
    }
  };

  const handleCopyReferral = async () => {
    if (!user?.referralCode) return;
    try {
      await navigator.clipboard.writeText(user.referralCode);
      setCopiedReferral(true);
      setTimeout(() => setCopiedReferral(false), 1500);
    } catch (err) {
      console.error("Failed to copy referral code:", err);
    }
  };

  // wallet export handlers
  const handleOpenExportModal = () => {
    setExportError(null);
    setExportAcknowledged(false);
    setExportModalOpen(true);
  };

  const handleConfirmExport = async () => {
    if (!canExportWallet || exporting || !privySolWallet) return;

    setExporting(true);
    setExportError(null);

    try {
      await exportWallet({ address: privySolWallet.address });
    } catch (err) {
      console.error("Error exporting wallet:", err);
      setExportError(
        err instanceof Error ? err.message : "Export was cancelled or failed."
      );
      resetExportModal();
    } finally {
      setExporting(false);
    }
  };

  /* ---------- LOADING STATE ---------- */
  if (!user && userLoading) {
    return (
      <main className="haven-app">
        <div className="mx-auto w-full max-w-[420px] px-3 pb-10 pt-4 sm:max-w-[520px] sm:px-4 md:max-w-[720px] xl:max-w-5xl">
          <div className="haven-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b bg-card/60 px-3 py-3 backdrop-blur-xl sm:px-4">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-full border bg-card/60" />
                <div>
                  <div className="h-4 w-36 rounded bg-muted/30" />
                  <div className="mt-2 h-3 w-56 rounded bg-muted/20" />
                </div>
              </div>
            </div>

            <div className="p-3 sm:p-4">
              <div className="space-y-3">
                <div className="h-28 rounded-3xl border bg-card/50" />
                <div className="h-48 rounded-3xl border bg-card/50" />
                <div className="h-40 rounded-3xl border bg-card/50" />
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ---------- SIGNED OUT STATE ---------- */
  if (!user && !userLoading) {
    return (
      <main className="haven-app">
        <div className="mx-auto w-full max-w-[420px] px-3 pb-10 pt-4 sm:max-w-[520px] sm:px-4 md:max-w-[720px] xl:max-w-5xl">
          <div className="haven-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b bg-card/60 px-3 py-3 backdrop-blur-xl sm:px-4">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-card/80 shadow-fintech-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4 text-foreground/70" />
              </button>

              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                  Settings
                </h1>
                <p className="truncate text-[11px] text-muted-foreground">
                  You need to be signed in.
                </p>
              </div>

              <div className="h-9 w-9" />
            </div>

            <div className="p-3 sm:p-4">
              <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-foreground">
                You need to be signed in to view settings.
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ---------- MAIN PAGE ---------- */
  if (!user) return null;

  const avatarUrl = user.profileImageUrl || null;
  const displayName =
    user.fullName || user.firstName || user.email || "Haven member";

  return (
    <main className="haven-app">
      <div className="mx-auto w-full max-w-[420px] px-3 pb-10 pt-4 sm:max-w-[520px] sm:px-4 md:max-w-[720px] xl:max-w-5xl">
        <div className="haven-card overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-2 border-b bg-card/60 px-3 py-3 backdrop-blur-xl sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card/80 shadow-fintech-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4 text-foreground/70" />
              </button>

              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                  Settings
                </h1>
                <p className="truncate text-[11px] text-muted-foreground">
                  Edit your profile, preferences, and account security.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/profile"
                className="inline-flex items-center gap-1.5 rounded-full border bg-card/80 px-3 py-2 text-[11px] text-foreground shadow-fintech-sm transition-colors hover:bg-secondary active:scale-[0.98]"
              >
                <UserRound className="h-4 w-4 text-foreground/70" />
                <span className="hidden sm:inline">Profile</span>
              </Link>
            </div>
          </div>

          {/* Content */}
          <div className="p-3 sm:p-4">
            <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
              {/* LEFT */}
              <section className="min-w-0 space-y-3">
                {/* Identity card */}
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={handleAvatarClick}
                      disabled={uploadingAvatar}
                      className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-card/80 shadow-fintech-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Change profile photo"
                    >
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarUrl}
                          alt={displayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <UserRound className="h-6 w-6 text-foreground/70" />
                      )}

                      <div className="pointer-events-none absolute bottom-0 right-0 mb-0.5 mr-0.5 flex items-center gap-1 rounded-full border bg-card/80 px-1.5 py-[2px] text-[9px] text-muted-foreground">
                        <Camera className="h-2.5 w-2.5" />
                        Edit
                      </div>

                      {uploadingAvatar && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-[10px] text-foreground">
                          Uploading…
                        </div>
                      )}
                    </button>

                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
                          {displayName}
                        </h2>
                        {user.country && (
                          <span className="haven-pill shrink-0">
                            {user.country}
                          </span>
                        )}
                      </div>

                      <p className="truncate text-[11px] text-muted-foreground">
                        {user.email}
                      </p>

                      {avatarError && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                          <AlertCircle className="h-3 w-3" />
                          {avatarError}
                        </p>
                      )}

                      {/* Currency + Theme */}
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="flex min-w-0 items-center justify-between rounded-2xl border bg-card/60 px-2.5 py-2 shadow-fintech-sm">
                          <div className="min-w-0">
                            <p className="haven-kicker">Currency</p>
                            <p className="mt-1 truncate text-[13px] font-semibold text-foreground">
                              {displayCurrency ||
                                (user.displayCurrency as DisplayCurrency) ||
                                "USD"}
                            </p>
                          </div>
                          <Globe2 className="h-4 w-4 text-muted-foreground" />
                        </div>

                        <div className="flex min-w-0 items-center justify-between rounded-2xl border bg-card/60 px-2.5 py-2 shadow-fintech-sm">
                          <div className="min-w-0">
                            <p className="haven-kicker">Theme</p>
                            <p className="mt-1 truncate text-[13px] font-semibold text-foreground">
                              Appearance
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <MoonStar className="h-4 w-4 text-muted-foreground" />
                            <div className="shrink-0">
                              <ThemeToggle />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Wallet address */}
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                        <Wallet className="h-3.5 w-3.5 text-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="haven-kicker">Wallet address</p>
                        <p className="mt-1 truncate text-xs font-medium text-foreground">
                          {shortAddress(user.walletAddress)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Read-only. Managed by Privy.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyWallet}
                      className="haven-btn-secondary w-auto rounded-full px-3 py-1.5 text-[11px]"
                    >
                      {copiedWallet ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Referral code */}
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                        <span className="text-[10px] font-semibold tracking-[0.2em] text-foreground">
                          RF
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="haven-kicker">Referral code</p>
                        <p className="mt-1 font-mono text-sm text-foreground">
                          {user.referralCode || "—"}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Share this code with friends.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyReferral}
                      className="haven-btn-secondary w-auto rounded-full px-3 py-1.5 text-[11px]"
                    >
                      {copiedReferral ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Wallet security & export */}
                <div className="rounded-3xl border border-destructive/25 bg-destructive/10 px-3 py-3 shadow-fintech-sm sm:px-4 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-destructive/40 bg-destructive/15">
                        <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                      </div>
                      <div className="min-w-0">
                        <p className="haven-kicker text-destructive/90">
                          Wallet security
                        </p>
                        <p className="mt-1 text-xs font-medium text-foreground">
                          Export private key
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Advanced: only do this if you understand the risk.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleOpenExportModal}
                      disabled={!canExportWallet}
                      className={[
                        "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold active:scale-[0.98]",
                        canExportWallet
                          ? "border-destructive/50 bg-destructive text-black hover:opacity-90"
                          : "cursor-not-allowed border-border bg-card/60 text-muted-foreground",
                      ].join(" ")}
                    >
                      <KeyRound className="h-3 w-3" />
                      Export
                    </button>
                  </div>

                  {!canExportWallet && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      To export, you must be signed in and have an embedded
                      Solana wallet.
                    </p>
                  )}
                </div>
              </section>

              {/* RIGHT */}
              <section className="min-w-0 space-y-3">
                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* Profile details */}
                  <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Profile details
                      </h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Update your name, country, and currency display.
                      </p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          First name
                        </label>
                        <input
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="First name"
                          className="haven-input px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          Last name
                        </label>
                        <input
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Last name"
                          className="haven-input px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-[1.2fr_1fr]">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          Country
                        </label>

                        <select
                          value={country}
                          onChange={(e) =>
                            setCountry(
                              (e.target.value || "") as CountryCode | ""
                            )
                          }
                          className="haven-input px-3 py-2 text-sm"
                        >
                          <option value="">Select (optional)</option>
                          {COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} — {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                          Display currency
                          <Globe2 className="h-3 w-3 text-muted-foreground" />
                        </label>
                        <select
                          value={displayCurrency}
                          onChange={(e) =>
                            setDisplayCurrency(
                              e.target.value as DisplayCurrency
                            )
                          }
                          className="haven-input px-3 py-2 text-sm"
                        >
                          {DISPLAY_CURRENCIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Investing profile */}
                  <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Investing profile
                      </h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Helps personalize default settings and future guidance.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* Risk */}
                      <div>
                        <p className="mb-2 text-[11px] font-medium text-foreground/80">
                          Risk level
                        </p>
                        <div className="space-y-1.5">
                          {RISK_OPTIONS.map((opt) => {
                            const active = riskLevel === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setRiskLevel(opt.value)}
                                className={[
                                  "flex w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition shadow-fintech-sm",
                                  active
                                    ? "border-primary/50 bg-primary/10 text-foreground"
                                    : "border-border bg-card/60 text-foreground/90 hover:bg-secondary",
                                ].join(" ")}
                              >
                                <div
                                  className={[
                                    "mt-0.5 h-2 w-2 rounded-full",
                                    active
                                      ? "bg-primary"
                                      : "bg-muted-foreground/40",
                                  ].join(" ")}
                                />
                                <div>
                                  <p className="font-semibold">{opt.label}</p>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    {opt.description}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Knowledge */}
                      <div>
                        <p className="mb-2 flex items-center gap-1 text-[11px] font-medium text-foreground/80">
                          Financial knowledge
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </p>
                        <div className="space-y-1.5">
                          {KNOWLEDGE_OPTIONS.map((opt) => {
                            const active = knowledgeLevel === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setKnowledgeLevel(opt.value)}
                                className={[
                                  "flex w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition shadow-fintech-sm",
                                  active
                                    ? "border-primary/50 bg-primary/10 text-foreground"
                                    : "border-border bg-card/60 text-foreground/90 hover:bg-secondary",
                                ].join(" ")}
                              >
                                <div
                                  className={[
                                    "mt-0.5 h-2 w-2 rounded-full",
                                    active
                                      ? "bg-primary"
                                      : "bg-muted-foreground/40",
                                  ].join(" ")}
                                />
                                <div>
                                  <p className="font-semibold">{opt.label}</p>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    {opt.description}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sticky save bar */}
                  <div className="sticky bottom-0 z-10 rounded-2xl border bg-card/80 px-3 py-2 shadow-fintech-sm backdrop-blur">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-[11px]">
                        {saveError ? (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-3 w-3" />
                            <span className="truncate">{saveError}</span>
                          </span>
                        ) : saveSuccess ? (
                          <span className="flex items-center gap-1 text-primary">
                            <Check className="h-3 w-3" />
                            Settings saved
                          </span>
                        ) : isDirty ? (
                          <span className="text-foreground/80">
                            Unsaved changes
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            All changes saved
                          </span>
                        )}

                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          Email and wallet are managed by Privy and can’t be
                          edited here.
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={!isDirty || saving}
                        className={[
                          "haven-btn-primary w-auto rounded-full px-4 py-2 text-xs",
                          !isDirty || saving
                            ? "opacity-60 pointer-events-none"
                            : "",
                        ].join(" ")}
                      >
                        {saving ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </div>
                </form>
              </section>
            </div>
          </div>
        </div>
      </div>

      {/* Export wallet confirmation modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4">
          <div className="w-full max-w-md rounded-3xl border bg-card p-4 shadow-fintech-lg sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/10">
                <KeyRound className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-destructive">
                  Export private key
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Read this carefully before you continue.
                </p>
              </div>
            </div>

            <div className="space-y-2 text-[11px] text-foreground">
              <p>
                You’re about to export the <strong>full private key</strong> for
                your embedded Haven wallet.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[10px] text-muted-foreground">
                <li>
                  Anyone with this key can{" "}
                  <span className="font-semibold text-destructive">
                    move all funds
                  </span>
                  .
                </li>
                <li>Haven can’t recover it if you lose it.</li>
                <li>Never paste it into chats or screenshots.</li>
              </ul>

              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10px] text-foreground">
                <input
                  type="checkbox"
                  checked={exportAcknowledged}
                  onChange={(e) => setExportAcknowledged(e.target.checked)}
                  className="mt-0.5 h-3 w-3 rounded border-border bg-card text-destructive focus:ring-destructive"
                />
                <span>
                  I understand: if someone gets my private key, they can access
                  my funds.
                </span>
              </label>

              {exportError && (
                <p className="mt-2 flex items-center gap-1 text-[10px] text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {exportError}
                </p>
              )}

              {exporting && (
                <div className="mt-2 rounded-2xl border bg-card/60 px-3 py-2 text-[10px] text-muted-foreground">
                  Waiting for Privy… close the Privy window to return here.
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                className="haven-btn-secondary w-auto rounded-full px-3 py-2 text-[11px]"
                disabled={exporting}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmExport}
                disabled={!exportAcknowledged || !canExportWallet || exporting}
                className={[
                  "inline-flex items-center justify-center rounded-full px-3 py-2 text-[11px] font-semibold transition",
                  !exportAcknowledged || !canExportWallet || exporting
                    ? "cursor-not-allowed border border-destructive/25 bg-destructive/10 text-destructive/60"
                    : "border border-destructive bg-destructive text-destructive-foreground hover:opacity-90",
                ].join(" ")}
              >
                {exporting ? "Opening export…" : "Continue & export"}
              </button>
            </div>

            <p className="mt-2 text-[9px] text-muted-foreground">
              A secure Privy window will open where only you can view/copy the
              key. Haven never sees it.
            </p>
          </div>
        </div>
      )}
    </main>
  );
};

export default SettingsPage;
