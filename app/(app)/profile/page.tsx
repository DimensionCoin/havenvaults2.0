// app/profile/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import ThemeToggle from "@/components/shared/ThemeToggle"; // ✅ add your existing ThemeToggle
import {
  ArrowLeft,
  Calendar,
  Wallet,
  Globe2,
  Users,
  Copy,
  Check,
  UserRound,
  Link2,
  MailPlus,
 
} from "lucide-react";
import HistoryChart from "@/components/dash/Chart";

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

// what we need from user object without using `any`
type UserWithSocial = {
  contacts?: unknown;
  referrals?: unknown;
};

type InviteDTO = {
  email: string | null;
  status: "sent" | "clicked" | "signed_up";
  sentAt: string | null;
  clickedAt: string | null;
  redeemedAt: string | null;
};

type PersonalInviteCreateResponse =
  | {
      ok: true;
      reused: boolean;
      invite: {
        email: string;
        inviteToken: string;
        status: "sent" | "clicked" | "signed_up";
        sentAt: string | null;
      };
      link: string;
      path?: string;
    }
  | {
      ok: false;
      reason?: string;
      message?: string;
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

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const ProfilePage: React.FC = () => {
  const { user, refresh } = useUser();
  const { displayCurrency } = useBalance();

  const [copyWalletOk, setCopyWalletOk] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Invite UI state ──────────────────────────────────────────────
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invites, setInvites] = useState<InviteDTO[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [copiedGeneric, setCopiedGeneric] = useState(false);
  const [copiedPersonalToken, setCopiedPersonalToken] = useState<string | null>(
    null
  );

  // PWA banner state
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [canPromptInstall, setCanPromptInstall] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  const avatarUrl = user?.profileImageUrl || null;
  const displayName = user?.fullName || user?.firstName || "Haven member";

  // a “generic referral link” (doesn't require server)
  const genericInviteLink = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const ref = user?.walletAddress || user?.email || "";
    const url = `${base}/sign-in?ref=${encodeURIComponent(ref)}`;
    return url;
  }, [user?.walletAddress, user?.email]);

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

  // ✅ contacts/referrals without `any`
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

  // ── Load personal invites ────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const loadInvites = async () => {
      try {
        setInvitesLoading(true);
        const res = await fetch("/api/user/invites", {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          if (mounted) setInvites([]);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          invites?: InviteDTO[];
        };
        if (mounted)
          setInvites(Array.isArray(data.invites) ? data.invites : []);
      } catch {
        if (mounted) setInvites([]);
      } finally {
        if (mounted) setInvitesLoading(false);
      }
    };

    if (user) loadInvites();
    return () => {
      mounted = false;
    };
  }, [user]);

  const handleCopyGenericInvite = async () => {
    try {
      await navigator.clipboard.writeText(genericInviteLink);
      setCopiedGeneric(true);
      setTimeout(() => setCopiedGeneric(false), 1400);
    } catch (err) {
      console.error("Copy generic invite failed:", err);
    }
  };

  const handleCreatePersonalInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      setInviteError("Enter a valid email.");
      return;
    }

    setInviteError(null);
    setCreatingInvite(true);

    try {
      const res = await fetch("/api/user/invite/personal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = (await res
        .json()
        .catch(() => ({}))) as PersonalInviteCreateResponse;

      if (!res.ok) {
        const msg =
          "message" in data && typeof data.message === "string"
            ? data.message
            : "Failed to create invite.";
        setInviteError(msg);
        return;
      }

      setInviteEmail("");
      const reload = await fetch("/api/user/invites", {
        method: "GET",
        credentials: "include",
      });
      const re = (await reload.json().catch(() => ({}))) as {
        invites?: InviteDTO[];
      };
      setInvites(Array.isArray(re.invites) ? re.invites : []);

      if ("link" in data && typeof data.link === "string" && data.link) {
        try {
          await navigator.clipboard.writeText(data.link);
          setCopiedPersonalToken(data.invite.inviteToken);
          setTimeout(() => setCopiedPersonalToken(null), 1500);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error("Create personal invite failed:", err);
      setInviteError("Failed to create invite. Try again.");
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyPersonalLink = async (inviteToken: string) => {
    try {
      const base =
        process.env.NEXT_PUBLIC_APP_URL ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const link = `${base}/sign-in?invite=${encodeURIComponent(inviteToken)}`;
      await navigator.clipboard.writeText(link);
      setCopiedPersonalToken(inviteToken);
      setTimeout(() => setCopiedPersonalToken(null), 1400);
    } catch (err) {
      console.error("Copy personal invite failed:", err);
    }
  };

  if (!user) return null;

  return (
    <main className="haven-app">
      <div className="mx-auto w-full max-w-[420px] px-3 pb-10 pt-4 sm:max-w-[520px] sm:px-4 md:max-w-[720px] xl:max-w-5xl">
        {/* Shell */}
        <div className="haven-card overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-2 border-b bg-card/60 px-3 py-3 backdrop-blur-xl sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href="/dashboard"
                className={[
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  "border bg-card/80 backdrop-blur-xl shadow-fintech-sm",
                  "transition-colors hover:bg-secondary active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ].join(" ")}
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4 text-foreground/70" />
              </Link>

              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                  Profile
                </h1>
                <p className="truncate text-[11px] text-muted-foreground">
                  Account and your Haven identity.
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-3 sm:p-4">
            {/* PWA install banner */}
            {isMobile && !isStandalone && (
              <div className="mb-3 haven-card-soft px-3 py-3 sm:px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Install Haven for the best experience
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Faster, full screen, and it feels like a real app.
                    </p>

                    {!canPromptInstall && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        On iPhone/iPad: tap{" "}
                        <span className="font-semibold text-foreground">
                          Share
                        </span>{" "}
                        →{" "}
                        <span className="font-semibold text-foreground">
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
                      className="haven-btn-primary w-auto px-4 py-2 text-xs"
                    >
                      Install
                    </button>
                  ) : (
                    <div className="shrink-0 haven-pill">
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
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={handleAvatarClick}
                      disabled={uploadingAvatar}
                      className={[
                        "relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full",
                        "border bg-card/80 backdrop-blur-xl shadow-fintech-sm",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      ].join(" ")}
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

                      <div className="pointer-events-none absolute bottom-0 right-0 mb-0.5 mr-0.5 rounded-full border border-border bg-card/80 px-1.5 py-[2px] text-[9px] text-muted-foreground">
                        Tap
                      </div>

                      {uploadingAvatar && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-[10px] text-foreground">
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

                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>Member since</span>
                        <span className="font-medium text-foreground">
                          {formatDate(membershipSince || undefined)}
                        </span>
                        <span className="text-muted-foreground/70">•</span>
                        <span className="font-medium text-foreground">
                          {memberDuration}
                        </span>
                      </p>
                    </div>
                  </div>

                  {avatarError && (
                    <p className="mt-2 text-[11px] text-destructive">
                      {avatarError}
                    </p>
                  )}

                  {/* ✅ Replace PLAN with THEME */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="flex min-w-0 items-center justify-between rounded-2xl border bg-card/60 px-2.5 py-2 shadow-fintech-sm">
                      <div className="min-w-0">
                        <p className="haven-kicker">Currency</p>
                        <p className="mt-1 truncate text-[13px] font-semibold text-foreground">
                          {displayCurrency || user.displayCurrency || "USD"}
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
                        <div className="shrink-0">
                          <ThemeToggle />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-1">
                  <HistoryChart />
                </div>

                {/* Wallet */}
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                        <Wallet className="h-3.5 w-3.5 text-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="haven-kicker">Haven wallet</p>
                        <p className="mt-1 truncate text-xs font-medium text-foreground">
                          {shortAddress(user.walletAddress)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Primary wallet address.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyWallet}
                      className="haven-btn-secondary w-auto rounded-full px-3 py-1.5 text-[11px]"
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
                {/* ✅ INVITES: generic link + personal invites */}
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        <Link2 className="h-4 w-4 text-primary" />
                        Invite friends
                      </h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Share your link or create a personal invite.
                      </p>
                    </div>
                  </div>

                  {/* Generic link */}
                  <div className="mt-3 rounded-2xl border bg-card/60 p-3 shadow-fintech-sm">
                    <p className="haven-kicker">Your invite link</p>
                    <p className="mt-1 truncate text-[11px] text-foreground">
                      {genericInviteLink}
                    </p>

                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={handleCopyGenericInvite}
                        className="haven-btn-secondary flex-1 rounded-full px-3 py-2 text-[11px]"
                      >
                        {copiedGeneric ? (
                          <>
                            <Check className="h-3.5 w-3.5" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" /> Copy link
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (navigator.share) {
                            navigator
                              .share({
                                title: "Haven",
                                text: "Join me on Haven",
                                url: genericInviteLink,
                              })
                              .catch(() => null);
                          } else {
                            handleCopyGenericInvite();
                          }
                        }}
                        className="haven-btn-primary w-auto rounded-full px-3 py-2 text-[11px]"
                      >
                        Share
                      </button>
                    </div>
                  </div>

                  {/* Personal invite creation */}
                  <div className="mt-3">
                    <p className="mb-2 haven-kicker">Personal invite</p>

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <MailPlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="friend@email.com"
                          className="haven-input h-10 pl-9 text-[13px]"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleCreatePersonalInvite}
                        disabled={creatingInvite}
                        className={[
                          "haven-btn-primary w-auto px-4 py-2 text-xs",
                          creatingInvite ? "opacity-70" : "",
                        ].join(" ")}
                      >
                        {creatingInvite ? "Creating…" : "Create"}
                      </button>
                    </div>

                    {inviteError && (
                      <p className="mt-2 text-[11px] text-destructive">
                        {inviteError}
                      </p>
                    )}
                  </div>

                  {/* Personal invites list */}
                  <div className="mt-4 border-t pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-medium text-foreground/80">
                        Recent personal invites
                      </p>
                      <span className="haven-pill">
                        {invitesLoading ? "…" : invites.length}
                      </span>
                    </div>

                    {invitesLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 2 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-12 animate-pulse rounded-2xl border bg-card/60"
                          />
                        ))}
                      </div>
                    ) : invites.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        No personal invites yet.
                      </p>
                    ) : (
                      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                        {invites.map((inv) => {
                          const statusLabel =
                            inv.status === "signed_up"
                              ? "Signed up"
                              : inv.status === "clicked"
                                ? "Opened"
                                : "Sent";

                          const badgeClass =
                            inv.status === "signed_up"
                              ? "haven-pill haven-pill-positive"
                              : inv.status === "clicked"
                                ? "haven-pill"
                                : "haven-pill";

                          return (
                            <div
                              key={`${inv.email ?? "unknown"}-${inv.sentAt ?? "na"}`}
                              className="flex items-center justify-between gap-3 rounded-2xl border bg-card/60 px-3 py-2 shadow-fintech-sm"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[12px] font-medium text-foreground">
                                  {inv.email ?? "Unknown"}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {statusLabel} • {formatDate(inv.sentAt)}
                                </p>
                              </div>

                              <span className={badgeClass}>{statusLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Tip: creating a personal invite for the same email will
                      reuse the existing link (until they sign up).
                    </p>
                  </div>
                </div>

                {/* Overview */}
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <Users className="h-4 w-4 text-primary" />
                      Network overview
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Your referrals and saved contacts.
                    </p>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-2xl border bg-card/60 px-2.5 py-2 shadow-fintech-sm">
                      <p className="haven-kicker">Referrals</p>
                      <p className="mt-1 text-base font-semibold text-foreground tabular-nums">
                        {referralsCount}
                      </p>
                    </div>

                    <div className="rounded-2xl border bg-card/60 px-2.5 py-2 shadow-fintech-sm">
                      <p className="haven-kicker">Contacts</p>
                      <p className="mt-1 text-base font-semibold text-foreground tabular-nums">
                        {contactsCount}
                      </p>
                    </div>
                  </div>
                </div>

                {/* People */}
                <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      People
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Who joined from your referrals + your saved contacts.
                    </p>
                  </div>

                  {/* Joined referrals */}
                  <div>
                    <p className="mb-2 text-[11px] font-medium text-foreground/80">
                      Referred
                    </p>
                    {referrals.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
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
                              className="flex items-center justify-between gap-3 rounded-2xl border bg-card/60 px-3 py-2 shadow-fintech-sm"
                            >
                              <div className="min-w-0">
                                <span className="block truncate text-xs font-medium text-foreground">
                                  {label}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {r.email && r.walletAddress
                                    ? `${shortAddress(r.walletAddress)} • ${r.email}`
                                    : r.email ||
                                      (r.walletAddress
                                        ? shortAddress(r.walletAddress)
                                        : "")}
                                </span>
                                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                  Joined {formatDate(r.joinedAt)}
                                </span>
                              </div>
                              <span className="haven-pill haven-pill-positive">
                                Active
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Contacts */}
                  <div className="mt-4 border-t pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-medium text-foreground/80">
                        Saved contacts
                      </p>
                      <span className="haven-pill">{contactsCount}</span>
                    </div>

                    {contacts.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
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
                              className="flex items-center justify-between gap-3 rounded-2xl border bg-card/60 px-3 py-2 shadow-fintech-sm"
                            >
                              <div className="min-w-0">
                                <span className="block truncate text-xs font-medium text-foreground">
                                  {label}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {c.email && c.walletAddress
                                    ? `${shortAddress(c.walletAddress)} • ${c.email}`
                                    : c.email || c.walletAddress || ""}
                                </span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">
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

                  {/* (kept) copiedPersonalToken state unused in UI here; not changing functionality */}
                  {copiedPersonalToken ? (
                    <span className="sr-only">Copied personal link</span>
                  ) : null}
                  {/* You can wire this later if GET /invites returns inviteToken */}
                  {typeof handleCopyPersonalLink === "function" ? null : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default ProfilePage;
