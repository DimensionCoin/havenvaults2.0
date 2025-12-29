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
  Globe,
  Info,
  Link2,
  Share2,
  KeyRound,
  ShieldAlert,
} from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { usePrivy, type WalletWithMetadata } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";

// ---- Keep these aligned with your server types ----
type RiskLevel = "low" | "medium" | "high";
type FinancialKnowledgeLevel =
  | "none"
  | "beginner"
  | "intermediate"
  | "advanced";

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
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "HRK",
  "BRL",
  "MXN",
  "CLP",
  "COP",
  "PEN",
  "ARS",
  "CNY",
  "HKD",
  "SGD",
  "KRW",
  "INR",
  "IDR",
  "THB",
  "MYR",
  "PHP",
  "VND",
  "TWD",
  "PKR",
  "ILS",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "ZAR",
  "NGN",
  "GHS",
  "KES",
  "MAD",
  "USDC",
] as const;

type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

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
        (account.chainType === "solana")
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
  const [country, setCountry] = useState<string>("");
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

  // ------ referral link state ------
  const [referralLink, setReferralLink] = useState("");
  const [copiedReferralLink, setCopiedReferralLink] = useState(false);

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

  // ------ hydrate form from user ------
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName || "");
    setLastName(user.lastName || "");
    setCountry(user.country || "");
    setDisplayCurrency((user.displayCurrency || "USD") as DisplayCurrency);
    setRiskLevel((user.riskLevel || "low") as RiskLevel);
    setKnowledgeLevel(
      (user.financialKnowledgeLevel || "none") as FinancialKnowledgeLevel
    );
  }, [user]);

  // build referral link when user/referralCode are ready
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user?.referralCode) return;

    const origin = window.location.origin;
    const link = `${origin}/sign-in?ref=${encodeURIComponent(
      user.referralCode
    )}`;

    setReferralLink(link);
  }, [user?.referralCode]);

  const initialState = useMemo(
    () => ({
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      country: user?.country || "",
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

  // ------ avatar handlers (use /api/user/avatar) ------
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

  // ------ save handler (uses /api/user/update) ------
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          country: country.trim() || null,
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

  // ------ copy handlers ------
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

  // 🔗 Share handler: prefers native share sheet, falls back to copy
  const handleShareReferralLink = async () => {
    if (!referralLink) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Join me on Haven",
          text: "I’ve been using Haven to manage my crypto on Haven. Use my link to sign up:",
          url: referralLink,
        });
      } else if (navigator.clipboard && window.isSecureContext) {
        // Fallback: copy link if share sheet not available
        await navigator.clipboard.writeText(referralLink);
        setCopiedReferralLink(true);
        setTimeout(() => setCopiedReferralLink(false), 1500);
      } else {
        // Last-resort fallback: prompt
        window.prompt("Copy this referral link:", referralLink);
      }
    } catch (err) {
      // User cancelled share -> ignore
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to share referral link:", err);
    }
  };

  // ------ wallet export handlers ------
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
      // This opens Privy's secure export modal where the *user* sees the key.
      await exportWallet({ address: privySolWallet.address });
      // After invoking, we can close our warning modal.
      resetExportModal();
    } catch (err) {
      console.error("Error exporting wallet:", err);
      setExportError(
        err instanceof Error
          ? err.message
          : "Something went wrong while starting the export. Please try again."
      );
    } finally {
      setExporting(false);
    }
  };

  // ------ loading / auth states ------
  if (!user && userLoading) {
    return (
      <div className="min-h-screen  text-zinc-50">
        <div className="mx-auto w-full max-w-3xl px-3 pb-10 pt-4 sm:px-4">
          <div className="mb-4 flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-zinc-900" />
            <div className="h-4 w-40 rounded bg-zinc-900" />
          </div>
          <div className="space-y-3">
            <div className="h-24 rounded-3xl bg-zinc-950/80" />
            <div className="h-40 rounded-3xl bg-zinc-950/80" />
          </div>
        </div>
      </div>
    );
  }

  if (!user && !userLoading) {
    return (
      <div className="min-h-screen bg-black text-zinc-50">
        <div className="mx-auto w-full max-w-3xl px-3 pb-10 pt-4 sm:px-4">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-emerald-300"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <div className="mt-6 rounded-3xl border border-red-500/40 bg-red-500/10 px-4 py-5 text-sm text-red-50">
            You need to be signed in to view settings.
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const avatarUrl = user.profileImageUrl || null;
  const initials =
    !avatarUrl && user
      ? `${user.firstName?.[0] ?? ""}${
          user.lastName?.[0] ?? ""
        }`.toUpperCase() || "HV"
      : "HV";

  const displayName =
    user.firstName || user.fullName || user.email || "Haven investor";

  return (
    <div className="min-h-screen text-zinc-50">
      <div className="mx-auto w-full max-w-3xl px-3 pb-10 pt-4 sm:px-4">
        {/* Header */}
        <header className="mb-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-emerald-500/60 hover:text-emerald-200"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                Settings
              </h1>
              <p className="text-[11px] text-zinc-500 sm:text-xs">
                Manage your Haven profile, preferences, and account details.
              </p>
            </div>
          </div>

          <Link
            href="/"
            className="hidden text-xs text-zinc-400 hover:text-emerald-300 sm:inline-flex"
          >
            Back to dashboard
          </Link>
        </header>

        {/* Avatar + basic identity card */}
        <section className="mb-4 rounded-3xl border border-zinc-900 bg-zinc-950/80 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={uploadingAvatar}
                className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
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
                  <span className="text-sm font-semibold text-white">
                    {initials}
                  </span>
                )}

                {/* Tiny camera badge */}
                <div className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/90">
                  <Camera className="h-2.5 w-2.5 text-emerald-300" />
                </div>

                {uploadingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-emerald-100">
                    Uploading…
                  </div>
                )}
              </button>

              {/* Hidden file input */}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Profile
                </p>
                <p className="text-base font-semibold text-zinc-50">
                  {displayName}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Update your name, country, and display currency below.
                </p>
              </div>
            </div>

            <div className="mt-2 text-right text-[11px] text-zinc-500 sm:mt-0">
              <p>
                Haven account created{" "}
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString()
                  : "recently"}
              </p>
              {user.isPro && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Haven Pro
                </p>
              )}
            </div>
          </div>

          {avatarError && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-red-300">
              <AlertCircle className="h-3 w-3" />
              {avatarError}
            </p>
          )}
        </section>

        {/* Main settings form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Profile details */}
          <section className="rounded-3xl border border-zinc-900 bg-zinc-950/80 px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Profile details
                </p>
                <p className="text-[11px] text-zinc-500">
                  This is how Haven personalizes your experience.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">
                  First name
                </label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className="w-full rounded-2xl border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-600 focus:border-emerald-500 focus:ring-2"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">
                  Last name
                </label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className="w-full rounded-2xl border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-600 focus:border-emerald-500 focus:ring-2"
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1.5fr]">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">
                  Country
                </label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Country (e.g., Canada)"
                  className="w-full rounded-2xl border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/40 placeholder:text-zinc-600 focus:border-emerald-500 focus:ring-2"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  We use this to tune content and future regional features.
                </p>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                  Display currency
                  <Globe className="h-3 w-3 text-zinc-500" />
                </label>
                <select
                  value={displayCurrency}
                  onChange={(e) =>
                    setDisplayCurrency(e.target.value as DisplayCurrency)
                  }
                  className="w-full rounded-2xl border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/40 focus:border-emerald-500 focus:ring-2"
                >
                  {DISPLAY_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-zinc-500">
                  All balances and charts in Haven will be shown in this
                  currency. Quotes still run in USD under the hood.
                </p>
              </div>
            </div>
          </section>

          {/* Risk & knowledge */}
          <section className="rounded-3xl border border-zinc-900 bg-zinc-950/80 px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Investing profile
                </p>
                <p className="text-[11px] text-zinc-500">
                  We use this to shape default settings and future guidance.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Risk level */}
              <div>
                <p className="mb-2 text-[11px] font-medium text-zinc-400">
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
                        className={`flex w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition ${
                          active
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-100"
                            : "border-zinc-800 bg-black/70 text-zinc-200 hover:border-emerald-500/40"
                        }`}
                      >
                        <div className="mt-0.5 h-2 w-2 rounded-full bg-emerald-400/80" />
                        <div>
                          <p className="font-medium">{opt.label}</p>
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            {opt.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Knowledge level */}
              <div>
                <p className="mb-2 flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                  Financial knowledge
                  <Info className="h-3 w-3 text-zinc-500" />
                </p>
                <div className="space-y-1.5">
                  {KNOWLEDGE_OPTIONS.map((opt) => {
                    const active = knowledgeLevel === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setKnowledgeLevel(opt.value)}
                        className={`flex w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition ${
                          active
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-100"
                            : "border-zinc-800 bg-black/70 text-zinc-200 hover:border-emerald-500/40"
                        }`}
                      >
                        <div className="mt-0.5 h-2 w-2 rounded-full bg-zinc-500/80" />
                        <div>
                          <p className="font-medium">{opt.label}</p>
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            {opt.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* 🔐 Wallet security & export */}
          <section className="rounded-3xl border border-red-900/60 bg-zinc-950 px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-red-400" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">
                    Wallet security
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Export the private key for your embedded Haven wallet.
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-100">
                Advanced
              </span>
            </div>

            <div className="space-y-2 text-[11px] text-zinc-300">
              <p>
                Exporting your private key lets you load this wallet into
                another app (like Phantom or Backpack) and control your Haven
                address from there.
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-zinc-400">
                <li>Anyone with your private key can move your funds.</li>
                <li>Never paste it into chats, screenshots, or email.</li>
                <li>
                  Store it somewhere offline and secure (password manager or
                  paper backup).
                </li>
              </ul>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-[10px] text-zinc-500">
                Haven never sees your full private key. Export is handled by
                Privy in a secure modal.
              </div>
              <button
                type="button"
                onClick={handleOpenExportModal}
                disabled={!canExportWallet}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                  canExportWallet
                    ? "border-red-500/70 bg-red-500/10 text-red-100 hover:border-red-400 hover:bg-red-500/20"
                    : "cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-500"
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Export wallet key
              </button>
            </div>

            {!canExportWallet && (
              <p className="mt-1 text-[10px] text-zinc-500">
                To export, make sure you’re signed in and have an embedded
                Solana wallet created with Haven.
              </p>
            )}
          </section>

          {/* 🔗 Referrals section */}
          <section className="rounded-3xl border border-zinc-900 bg-zinc-950/80 px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Referrals
                </p>
                <p className="text-[11px] text-zinc-500">
                  Share Haven with friends. Anyone who signs up from your link
                  will be linked to your account.
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
                <p className="font-semibold">
                  Your code:{" "}
                  <span className="font-mono text-emerald-50">
                    {user.referralCode}
                  </span>
                </p>
                <p className="mt-1 text-[10px] text-emerald-50/80">
                  Later, you can earn rewards based on your referrals’ activity.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Referral link
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-zinc-900 bg-black/70 px-2 py-1.5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/80">
                  <Link2 className="h-3.5 w-3.5 text-slate-300" />
                </span>
                <input
                  readOnly
                  value={referralLink}
                  className="flex-1 bg-transparent text-[11px] text-slate-200 outline-none"
                />
                <button
                  type="button"
                  onClick={handleShareReferralLink}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-200"
                >
                  {copiedReferralLink ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Share2 className="h-3 w-3" />
                      Share
                    </>
                  )}
                </button>
              </div>
              <p className="text-[10px] text-zinc-500">
                On supported devices, this opens your share sheet (Messages,
                Mail, AirDrop, etc). Otherwise, the link is copied to your
                clipboard.
              </p>
            </div>
          </section>

          {/* Account info (read-only) */}
          <section className="rounded-3xl border border-zinc-900 bg-zinc-950/80 px-4 py-4 sm:px-5 sm:py-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Account
                </p>
                <p className="text-[11px] text-zinc-500">
                  Core identifiers can’t be changed from settings.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              {/* Email */}
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-medium text-zinc-400">Email</p>
                  <p className="break-all text-[13px] text-zinc-100">
                    {user.email}
                  </p>
                </div>
                <span className="mt-1 inline-flex w-max rounded-full border border-zinc-800 bg-black/70 px-2 py-0.5 text-[10px] text-zinc-500 sm:mt-0">
                  Managed via Privy
                </span>
              </div>

              {/* Wallet */}
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-zinc-400">
                    Wallet address
                  </p>
                  <p className="max-w-[260px] truncate font-mono text-[11px] text-zinc-100 sm:max-w-[320px]">
                    {user.walletAddress}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyWallet}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-black/70 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-200 sm:mt-0"
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

              {/* Referral code (raw) */}
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-zinc-400">
                    Referral code
                  </p>
                  <p className="font-mono text-[11px] text-zinc-100">
                    {user.referralCode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyReferral}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-black/70 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-200 sm:mt-0"
                >
                  {copiedReferral ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy code
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Save bar */}
          <div className="sticky bottom-0 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-zinc-900 bg-black/90 px-3 py-2 text-[11px] backdrop-blur">
            <div className="flex flex-col gap-1 text-zinc-400">
              {saveError ? (
                <span className="flex items-center gap-1 text-red-300">
                  <AlertCircle className="h-3 w-3" />
                  {saveError}
                </span>
              ) : saveSuccess ? (
                <span className="flex items-center gap-1 text-emerald-300">
                  <Check className="h-3 w-3" />
                  Settings saved
                </span>
              ) : isDirty ? (
                <span>Unsaved changes</span>
              ) : (
                <span>All changes saved</span>
              )}
              <span className="text-[10px] text-zinc-500">
                Wallet, email, and Privy ID can’t be edited from here.
              </span>
            </div>

            <button
              type="submit"
              disabled={!isDirty || saving}
              className={`inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs font-medium transition ${
                !isDirty || saving
                  ? "cursor-not-allowed border border-zinc-800 bg-zinc-900 text-zinc-500"
                  : "border border-emerald-500 bg-emerald-500 text-black shadow-[0_0_0_1px_rgba(63,243,135,0.85)] hover:bg-emerald-400"
              }`}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>

      {/* 🔐 Export wallet confirmation modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-3xl border border-red-500/40 bg-zinc-950 p-4 shadow-xl sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl border border-red-500/60 bg-red-500/10">
                <KeyRound className="h-4 w-4 text-red-300" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-300">
                  Export private key
                </p>
                <p className="text-[11px] text-zinc-400">
                  Read this carefully before you continue.
                </p>
              </div>
            </div>

            <div className="space-y-2 text-[11px] text-zinc-200">
              <p>
                You’re about to export the <strong>full private key</strong> for
                your embedded Haven wallet.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[10px] text-zinc-400">
                <li>
                  Anyone with this key can{" "}
                  <span className="font-semibold text-red-300">
                    move all funds
                  </span>{" "}
                  from your wallet.
                </li>
                <li>
                  Haven <span className="font-semibold">cannot</span> help you
                  recover this key if you lose it.
                </li>
                <li>
                  Only paste it into wallets you trust (e.g. Phantom, Backpack),
                  never into chats or screenshots.
                </li>
                <li>
                  Store it somewhere offline and secure (password manager or
                  paper backup).
                </li>
              </ul>

              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={exportAcknowledged}
                  onChange={(e) => setExportAcknowledged(e.target.checked)}
                  className="mt-0.5 h-3 w-3 rounded border-zinc-600 bg-zinc-900 text-red-400 focus:ring-red-500"
                />
                <span>
                  I understand that if someone gets my private key, they can
                  access my funds and Haven can’t undo it.
                </span>
              </label>

              {exportError && (
                <p className="mt-2 flex items-center gap-1 text-[10px] text-red-300">
                  <AlertCircle className="h-3 w-3" />
                  {exportError}
                </p>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                disabled={exporting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmExport}
                disabled={!exportAcknowledged || !canExportWallet || exporting}
                className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                  !exportAcknowledged || !canExportWallet || exporting
                    ? "cursor-not-allowed border border-red-500/40 bg-red-950 text-red-500/70"
                    : "border border-red-500 bg-red-500 text-black shadow-[0_0_0_1px_rgba(248,113,113,0.6)] hover:bg-red-400"
                }`}
              >
                {exporting ? "Opening export…" : "Continue & export key"}
              </button>
            </div>

            <p className="mt-2 text-[9px] text-zinc-500">
              When you continue, a secure Privy window will open where{" "}
              <span className="font-medium text-zinc-300">only you</span> can
              view and copy your private key. Haven never sees or stores it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
