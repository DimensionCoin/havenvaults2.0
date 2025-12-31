// app/profile/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import { LogoutButton } from "@/components/shared/LogoutButton";
import {
  ArrowLeft,
  Calendar,
  Wallet,
  Globe2,
  Award,
  Users,
  Copy,
  Check,
  UserRound,
  Settings,
} from "lucide-react";

type ContactStatus = "invited" | "active" | "external";
type Contact = {
  name: string | null;
  email: string | null;
  walletAddress: string | null;
  status: ContactStatus;
  invitedAt: string | null;
  joinedAt: string | null;
};

type Referral = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  walletAddress: string | null;
  profileImageUrl: string | null;
  joinedAt: string | null;
};

type UserWithSocial = {
  contacts?: unknown;
  referrals?: unknown;
};


const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const formatDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatMembershipDuration = (iso?: string | null) => {
  if (!iso) return "—";
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return "—";

  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  if (diffMs <= 0) return "Just joined";

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 30) return diffDays === 1 ? "1 day" : `${diffDays} days`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12)
    return diffMonths === 1 ? "1 month" : `${diffMonths} months`;

  const diffYears = Math.floor(diffMonths / 12);
  const remainingMonths = diffMonths % 12;
  if (remainingMonths === 0)
    return diffYears === 1 ? "1 year" : `${diffYears} years`;
  return `${diffYears}y ${remainingMonths}m`;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type IOSNavigator = Navigator & { standalone?: boolean };

// ✅ tiny safe helper: normalize contacts/referrals to arrays
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

const ProfilePage: React.FC = () => {
  const { user, refresh } = useUser();
  const { displayCurrency } = useBalance();

  const [copyWalletOk, setCopyWalletOk] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const avatarUrl = user?.profileImageUrl || null;
  const displayName = user?.fullName || user?.firstName || "Haven member";

  // PWA banner state
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [canPromptInstall, setCanPromptInstall] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    setIsMobile(mobile);

    const standaloneMatch =
      window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;

    const iosStandalone = (navigator as IOSNavigator).standalone === true;

    setIsStandalone(Boolean(standaloneMatch || iosStandalone));

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanPromptInstall(true);
    };

    const onAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setCanPromptInstall(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  // ✅ contacts pulling fix (no provider changes): tolerate non-array shapes
  const contacts: Contact[] = useMemo(() => {
    const social = user as unknown as UserWithSocial;
    return asArray<Contact>(social?.contacts);
  }, [user]);

  const referrals: Referral[] = useMemo(() => {
    const social = user as unknown as UserWithSocial;
    return asArray<Referral>(social?.referrals);
  }, [user]);


  const referralsCount = referrals.length;
  const contactsCount = contacts.length;

  const membershipSince = user?.createdAt || user?.lastLoginAt || null;
  const memberDuration = formatMembershipDuration(user?.createdAt || null);

  const handleCopyWallet = async () => {
    if (!user?.walletAddress) return;
    try {
      await navigator.clipboard.writeText(user.walletAddress);
      setCopyWalletOk(true);
      setTimeout(() => setCopyWalletOk(false), 1500);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  };

  const handleAvatarClick = () => {
    if (!uploadingAvatar && fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
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
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
    } finally {
      setDeferredPrompt(null);
      setCanPromptInstall(false);
    }
  };

  if (!user) return null;

  return (
    <main className="min-h-screen w-full overflow-x-hidden text-white">
      <div className="w-full px-3 pb-8 pt-4 sm:px-4">
        <div className="mx-auto w-full max-w-[420px] sm:max-w-[520px] md:max-w-[720px] xl:max-w-5xl">
          <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl sm:rounded-[26px]">
            {/* Top bar */}
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href="/dashboard"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 active:scale-[0.98]"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>

                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold sm:text-lg">
                    Profile
                  </h1>
                  <p className="truncate text-[11px] text-zinc-400">
                    Account and your Haven identity.
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-zinc-100 active:scale-[0.98]"
                >
                  <Settings className="h-4 w-4 text-zinc-300" />
                  <span className="hidden sm:inline">Settings</span>
                </Link>

                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5">
                  <LogoutButton />
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-3 sm:p-4">
              {/* PWA install banner */}
              {isMobile && !isStandalone && (
                <div className="mb-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 sm:px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-50">
                        Install Haven for the best experience
                      </p>
                      <p className="mt-1 text-[11px] text-emerald-100/80">
                        Faster, full screen, and it feels like a real app.
                      </p>

                      {!canPromptInstall && (
                        <p className="mt-2 text-[11px] text-emerald-100/80">
                          On iPhone/iPad: tap{" "}
                          <span className="font-semibold">Share</span> →{" "}
                          <span className="font-semibold">
                            Add to Home Screen
                          </span>
                          .
                        </p>
                      )}
                    </div>

                    {canPromptInstall ? (
                      <button
                        type="button"
                        onClick={handleInstallPwa}
                        className="shrink-0 rounded-full bg-emerald-400 px-4 py-2 text-[12px] font-semibold text-black active:scale-[0.98]"
                      >
                        Install
                      </button>
                    ) : (
                      <div className="shrink-0 rounded-full border border-emerald-400/30 bg-black/20 px-3 py-2 text-[11px] text-emerald-100/90">
                        Add to Home Screen
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
                {/* LEFT */}
                <section className="min-w-0 space-y-3">
                  {/* Identity */}
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

                        <div className="pointer-events-none absolute bottom-0 right-0 mb-0.5 mr-0.5 rounded-full border border-emerald-500/40 bg-black/60 px-1.5 py-[2px] text-[9px] text-emerald-300">
                          Tap
                        </div>

                        {uploadingAvatar && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px]">
                            Uploading…
                          </div>
                        )}
                      </button>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange}
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

                        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-zinc-400">
                          <Calendar className="h-3 w-3" />
                          <span className="text-zinc-300">Member since</span>
                          <span className="text-zinc-100">
                            {formatDate(membershipSince || undefined)}
                          </span>
                          <span className="text-zinc-600">•</span>
                          <span className="text-zinc-300">
                            {memberDuration}
                          </span>
                        </p>
                      </div>
                    </div>

                    {avatarError && (
                      <p className="mt-2 text-[11px] text-red-300">
                        {avatarError}
                      </p>
                    )}

                    {/* Small stats (unchanged) */}
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="flex min-w-0 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-400">
                            Currency
                          </p>
                          <p className="mt-1 truncate text-[13px] text-zinc-50">
                            {displayCurrency || user.displayCurrency || "USD"}
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
                        <Award className="h-4 w-4 text-zinc-400" />
                      </div>
                    </div>
                  </div>

                  {/* Wallet */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15">
                          <Wallet className="h-3.5 w-3.5 text-emerald-300" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                            Haven wallet
                          </p>
                          <p className="mt-1 truncate text-xs text-zinc-100">
                            {shortAddress(user.walletAddress)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-500">
                            Primary wallet address.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyWallet}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-zinc-100 active:scale-[0.98]"
                      >
                        {copyWalletOk ? (
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
                </section>

                {/* RIGHT */}
                <section className="min-w-0 space-y-3">
                  {/* Overview (NO invites now) */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                    <div>
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                        <Users className="h-4 w-4 text-emerald-300" />
                        Network overview
                      </h3>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        Your referrals and saved contacts.
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-400">
                          Referrals
                        </p>
                        <p className="mt-1 text-base font-semibold text-zinc-50">
                          {referralsCount}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2">
                        <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-400">
                          Contacts
                        </p>
                        <p className="mt-1 text-base font-semibold text-zinc-50">
                          {contactsCount}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* People (NO pending invites now) */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold">People</h3>
                      <p className="text-[11px] text-zinc-400">
                        Who joined from your referrals + your saved contacts.
                      </p>
                    </div>

                    {/* Joined referrals */}
                    <div>
                      <p className="mb-2 text-[11px] font-medium text-emerald-200">
                        Referred
                      </p>
                      {referrals.length === 0 ? (
                        <p className="text-[11px] text-zinc-500">
                          No one has joined yet.
                        </p>
                      ) : (
                        <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                          {referrals.map((r) => {
                            const label =
                              r.fullName ||
                              r.email ||
                              shortAddress(r.walletAddress) ||
                              "Referral";

                            return (
                              <div
                                key={r.id}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-emerald-50">
                                    {label}
                                  </span>
                                  <span className="block truncate text-[10px] text-emerald-100/80">
                                    {r.email && r.walletAddress
                                      ? `${shortAddress(r.walletAddress)} • ${
                                          r.email
                                        }`
                                      : r.email ||
                                        (r.walletAddress
                                          ? shortAddress(r.walletAddress)
                                          : "")}
                                  </span>
                                  <span className="mt-0.5 block text-[10px] text-emerald-100/70">
                                    Joined {formatDate(r.joinedAt)}
                                  </span>
                                </div>
                                <span className="shrink-0 rounded-full border border-emerald-400/60 bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-50">
                                  Active
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Contacts */}
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-medium text-zinc-300">
                          Saved contacts
                        </p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-300">
                          {contactsCount}
                        </span>
                      </div>

                      {contacts.length === 0 ? (
                        <p className="text-[11px] text-zinc-500">
                          No contacts saved yet.
                        </p>
                      ) : (
                        <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                          {contacts.map((c, idx) => {
                            const label =
                              c.name ||
                              c.email ||
                              (c.walletAddress
                                ? shortAddress(c.walletAddress)
                                : "Contact");

                            return (
                              <div
                                key={`${c.email ?? c.walletAddress ?? idx}`}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-zinc-50">
                                    {label}
                                  </span>
                                  <span className="block truncate text-[10px] text-zinc-400">
                                    {c.email && c.walletAddress
                                      ? `${shortAddress(c.walletAddress)} • ${
                                          c.email
                                        }`
                                      : c.email || c.walletAddress || ""}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[10px] text-zinc-400">
                                  {c.status === "active"
                                    ? "Haven user"
                                    : c.status === "invited"
                                    ? "Invited"
                                    : "External"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default ProfilePage;
