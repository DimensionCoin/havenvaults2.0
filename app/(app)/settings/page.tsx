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

  // ✅ Close our modal when the Privy export pop-up closes and the user returns
  // to the app (window focus / visibilitychange). This is more reliable than
  // relying on exportWallet() promise timing.
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
        headers: { "Content-Type": "application/json" },
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
      // Do not close our modal here based on promise timing.
      // The effect above closes when the user returns to the app.
      await exportWallet({ address: privySolWallet.address });
    } catch (err) {
      console.error("Error exporting wallet:", err);

      // Optional: show error, then close anyway (matches "close after popup closes")
      setExportError(
        err instanceof Error ? err.message : "Export was cancelled or failed."
      );
      resetExportModal();
    } finally {
      setExporting(false);
    }
  };

  // ------ loading / auth states ------
  if (!user && userLoading) {
    return (
      <main className="min-h-screen w-full overflow-x-hidden text-white">
        <div className="w-full px-3 pb-8 pt-4 sm:px-4">
          <div className="mx-auto w-full max-w-[420px] sm:max-w-[520px] md:max-w-[720px] xl:max-w-5xl">
            <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl sm:rounded-[26px]">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3 sm:px-4">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full border border-white/10 bg-white/5" />
                  <div>
                    <div className="h-4 w-36 rounded bg-white/10" />
                    <div className="mt-2 h-3 w-56 rounded bg-white/5" />
                  </div>
                </div>
              </div>
              <div className="p-3 sm:p-4">
                <div className="space-y-3">
                  <div className="h-28 rounded-3xl border border-white/10 bg-white/[0.04]" />
                  <div className="h-48 rounded-3xl border border-white/10 bg-white/[0.04]" />
                  <div className="h-40 rounded-3xl border border-white/10 bg-white/[0.04]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!user && !userLoading) {
    return (
      <main className="min-h-screen w-full overflow-x-hidden text-white">
        <div className="w-full px-3 pb-8 pt-4 sm:px-4">
          <div className="mx-auto w-full max-w-[420px] sm:max-w-[520px] md:max-w-[720px] xl:max-w-5xl">
            <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl sm:rounded-[26px]">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3 sm:px-4">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 active:scale-[0.98]"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold sm:text-lg">
                    Settings
                  </h1>
                  <p className="truncate text-[11px] text-zinc-400">
                    You need to be signed in.
                  </p>
                </div>
                <div className="h-9 w-9" />
              </div>

              <div className="p-3 sm:p-4">
                <div className="rounded-3xl border border-red-500/30 bg-red-500/10 px-4 py-4 text-sm text-red-50">
                  You need to be signed in to view settings.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!user) return null;

  const avatarUrl = user.profileImageUrl || null;
  const displayName =
    user.fullName || user.firstName || user.email || "Haven member";

  return (
    <main className="min-h-screen w-full overflow-x-hidden text-white">
      <div className="w-full px-3 pb-8 pt-4 sm:px-4">
        <div className="mx-auto w-full max-w-[420px] sm:max-w-[520px] md:max-w-[720px] xl:max-w-5xl">
          <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl sm:rounded-[26px]">
            {/* Top bar */}
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 active:scale-[0.98]"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>

                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold sm:text-lg">
                    Settings
                  </h1>
                  <p className="truncate text-[11px] text-zinc-400">
                    Edit your profile, preferences, and account security.
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href="/profile"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-zinc-100 active:scale-[0.98]"
                >
                  <UserRound className="h-4 w-4 text-zinc-300" />
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
                  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={handleAvatarClick}
                        disabled={uploadingAvatar}
                        className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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
                          <UserRound className="h-6 w-6 text-zinc-200" />
                        )}

                        <div className="pointer-events-none absolute bottom-0 right-0 mb-0.5 mr-0.5 flex items-center gap-1 rounded-full border border-emerald-500/40 bg-black/60 px-1.5 py-[2px] text-[9px] text-emerald-300">
                          <Camera className="h-2.5 w-2.5" />
                          Edit
                        </div>

                        {uploadingAvatar && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px]">
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
                          <h2 className="min-w-0 truncate text-base font-semibold">
                            {displayName}
                          </h2>
                          {user.country && (
                            <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-300">
                              {user.country}
                            </span>
                          )}
                        </div>

                        <p className="truncate text-[11px] text-zinc-400">
                          {user.email}
                        </p>

                        {avatarError && (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-red-300">
                            <AlertCircle className="h-3 w-3" />
                            {avatarError}
                          </p>
                        )}

                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="flex min-w-0 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2">
                            <div className="min-w-0">
                              <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-400">
                                Currency
                              </p>
                              <p className="mt-1 truncate text-[13px] text-zinc-50">
                                {displayCurrency ||
                                  (user.displayCurrency as DisplayCurrency) ||
                                  "USD"}
                              </p>
                            </div>
                            <Globe2 className="h-4 w-4 text-zinc-400" />
                          </div>

                          <div className="flex min-w-0 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2">
                            <div className="min-w-0">
                              <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-400">
                                Plan
                              </p>
                              <p className="mt-1 truncate text-[13px] text-zinc-50">
                                {user.isPro ? "Pro" : "Standard"}
                              </p>
                            </div>
                            <Info className="h-4 w-4 text-zinc-400" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Wallet address */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15">
                          <Wallet className="h-3.5 w-3.5 text-emerald-300" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                            Wallet address
                          </p>
                          <p className="mt-1 truncate text-xs text-zinc-100">
                            {shortAddress(user.walletAddress)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-500">
                            Read-only. Managed by Privy.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyWallet}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-zinc-100 active:scale-[0.98]"
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
                  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15">
                          <span className="text-[10px] font-semibold tracking-[0.2em] text-emerald-200">
                            RF
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                            Referral code
                          </p>
                          <p className="mt-1 font-mono text-sm text-zinc-100">
                            {user.referralCode || "—"}
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-500">
                            Share this code with friends.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyReferral}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-zinc-100 active:scale-[0.98]"
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
                  <div className="rounded-2xl border border-red-500/25 bg-red-500/5 px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10">
                          <ShieldAlert className="h-3.5 w-3.5 text-red-300" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-red-200/80">
                            Wallet security
                          </p>
                          <p className="mt-1 text-xs text-zinc-100">
                            Export private key
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-400">
                            Advanced: only do this if you understand the risk.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleOpenExportModal}
                        disabled={!canExportWallet}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] active:scale-[0.98] ${
                          canExportWallet
                            ? "border-red-400/40 bg-red-500/10 text-red-100"
                            : "cursor-not-allowed border-white/10 bg-white/5 text-zinc-500"
                        }`}
                      >
                        <KeyRound className="h-3 w-3" />
                        Export
                      </button>
                    </div>

                    {!canExportWallet && (
                      <p className="mt-2 text-[10px] text-zinc-400">
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
                    <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                      <div className="mb-3">
                        <h3 className="text-sm font-semibold">
                          Profile details
                        </h3>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          Update your name, country, and currency display.
                        </p>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            First name
                          </label>
                          <input
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="First name"
                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
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
                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </div>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-[1.2fr_1fr]">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">
                            Country
                          </label>
                          <input
                            value={country}
                            onChange={(e) => setCountry(e.target.value)}
                            placeholder="Country (e.g., Canada)"
                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                            Display currency
                            <Globe2 className="h-3 w-3 text-zinc-500" />
                          </label>
                          <select
                            value={displayCurrency}
                            onChange={(e) =>
                              setDisplayCurrency(
                                e.target.value as DisplayCurrency
                              )
                            }
                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
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
                    <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                      <div className="mb-3">
                        <h3 className="text-sm font-semibold">
                          Investing profile
                        </h3>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          Helps personalize default settings and future
                          guidance.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {/* Risk */}
                        <div>
                          <p className="mb-2 text-[11px] font-medium text-zinc-300">
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
                                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
                                      : "border-white/10 bg-black/20 text-zinc-200 hover:border-emerald-500/30"
                                  }`}
                                >
                                  <div
                                    className={`mt-0.5 h-2 w-2 rounded-full ${
                                      active ? "bg-emerald-400" : "bg-zinc-600"
                                    }`}
                                  />
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

                        {/* Knowledge */}
                        <div>
                          <p className="mb-2 flex items-center gap-1 text-[11px] font-medium text-zinc-300">
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
                                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
                                      : "border-white/10 bg-black/20 text-zinc-200 hover:border-emerald-500/30"
                                  }`}
                                >
                                  <div
                                    className={`mt-0.5 h-2 w-2 rounded-full ${
                                      active ? "bg-emerald-400" : "bg-zinc-600"
                                    }`}
                                  />
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
                    </div>

                    {/* Sticky save bar */}
                    <div className="sticky bottom-0 z-10 rounded-2xl border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 text-[11px]">
                          {saveError ? (
                            <span className="flex items-center gap-1 text-red-300">
                              <AlertCircle className="h-3 w-3" />
                              <span className="truncate">{saveError}</span>
                            </span>
                          ) : saveSuccess ? (
                            <span className="flex items-center gap-1 text-emerald-300">
                              <Check className="h-3 w-3" />
                              Settings saved
                            </span>
                          ) : isDirty ? (
                            <span className="text-zinc-300">
                              Unsaved changes
                            </span>
                          ) : (
                            <span className="text-zinc-400">
                              All changes saved
                            </span>
                          )}
                          <div className="mt-0.5 text-[10px] text-zinc-500">
                            Email and wallet are managed by Privy and can’t be
                            edited here.
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={!isDirty || saving}
                          className={`inline-flex shrink-0 items-center justify-center rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                            !isDirty || saving
                              ? "cursor-not-allowed border border-white/10 bg-white/5 text-zinc-500"
                              : "border border-emerald-500 bg-emerald-500 text-black shadow-[0_0_0_1px_rgba(63,243,135,0.85)] hover:bg-emerald-400"
                          }`}
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
                  </span>
                  .
                </li>
                <li>Haven can’t recover it if you lose it.</li>
                <li>Never paste it into chats or screenshots.</li>
              </ul>

              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={exportAcknowledged}
                  onChange={(e) => setExportAcknowledged(e.target.checked)}
                  className="mt-0.5 h-3 w-3 rounded border-zinc-600 bg-zinc-900 text-red-400 focus:ring-red-500"
                />
                <span>
                  I understand: if someone gets my private key, they can access
                  my funds.
                </span>
              </label>

              {exportError && (
                <p className="mt-2 flex items-center gap-1 text-[10px] text-red-300">
                  <AlertCircle className="h-3 w-3" />
                  {exportError}
                </p>
              )}

              {exporting && (
                <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-zinc-300">
                  Waiting for Privy… close the Privy window to return here.
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-white/10"
                disabled={exporting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmExport}
                disabled={!exportAcknowledged || !canExportWallet || exporting}
                className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  !exportAcknowledged || !canExportWallet || exporting
                    ? "cursor-not-allowed border border-red-500/25 bg-red-950/40 text-red-300/50"
                    : "border border-red-500 bg-red-500 text-black hover:bg-red-400"
                }`}
              >
                {exporting ? "Opening export…" : "Continue & export"}
              </button>
            </div>

            <p className="mt-2 text-[9px] text-zinc-500">
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
