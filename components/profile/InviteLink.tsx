// components/profile/InviteLink.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link2,
  Share2,
  Copy,
  Check,
  Mail,
  XCircle,
  RefreshCcw,
} from "lucide-react";
import { useUser } from "@/providers/UserProvider";

type InviteLinkProps = { className?: string };

type InviteRow = {
  email: string | null;
  status: "sent" | "clicked" | "signed_up";
  sentAt: string | null;
  clickedAt: string | null;
  redeemedAt: string | null;
};

const DEFAULT_GENERIC_TEXT =
  "ive been using Haven to help manage my savings and investments, use my code to join";

const DEFAULT_PERSONAL_TEXT =
  "ive been using Haven to help manage my savings and investments, join Haven with this link";

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());

const formatWhen = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const pill = (status: InviteRow["status"]) => {
  if (status === "signed_up")
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
  if (status === "clicked")
    return "border-sky-500/40 bg-sky-500/10 text-sky-100";
  return "border-white/15 bg-white/5 text-zinc-200";
};

const statusLabel = (status: InviteRow["status"]) => {
  if (status === "signed_up") return "Signed up";
  if (status === "clicked") return "Opened";
  return "Sent";
};

const InviteLink: React.FC<InviteLinkProps> = ({ className }) => {
  const { user } = useUser();

  // ── generic
  const [genericLink, setGenericLink] = useState("");
  const [copiedGeneric, setCopiedGeneric] = useState(false);
  const [sharedGeneric, setSharedGeneric] = useState(false);

  // ── personal
  const [recipientEmail, setRecipientEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOk, setCreateOk] = useState<string | null>(null);

  const [inviteUrl, setInviteUrl] = useState<string>("");
  const [copiedPersonal, setCopiedPersonal] = useState(false);
  const [sharedPersonal, setSharedPersonal] = useState(false);

  // ── recent
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

  const toAbsoluteUrl = useCallback((value: string | undefined | null): string => {
    if (!value) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin || "" : "";
    if (!origin) return value;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/")) return `${origin}${value}`;
    return `${origin}/${value}`;
  }, []);

  const referralCode = user?.referralCode ?? "";

  useEffect(() => {
    if (!referralCode) return;
    const path = `/sign-in?ref=${encodeURIComponent(referralCode)}`;
    setGenericLink(toAbsoluteUrl(path));
  }, [referralCode, toAbsoluteUrl]);

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const res = await fetch("/api/user/invites", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        setInvites([]);
        return;
      }
      const data: { invites?: InviteRow[] } | null = await res
        .json()
        .catch(() => null);
      const rows: InviteRow[] = Array.isArray(data?.invites)
        ? data.invites
        : [];
      setInvites(rows);
    } catch {
      setInvites([]);
    } finally {
      setLoadingInvites(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadInvites();
  }, [loadInvites, user]);

  const topInvites = useMemo(() => invites.slice(0, 5), [invites]);

  const copyToClipboard = async (text: string, onOk: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      onOk();
    } catch (err) {
      console.error("[InviteLink] clipboard error:", err);
    }
  };

  const shareOrCopy = async (
    payload: { title: string; text: string; url: string },
    fallbackCopy: () => void,
    onShared: () => void
  ) => {
    try {
      if (navigator.share) {
        await navigator.share(payload);
        onShared();
      } else {
        await fallbackCopy();
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown share error");
      if (error.name === "AbortError") return;
      console.error("[InviteLink] share error:", error);
    }
  };

  const handleCopyGeneric = async () => {
    if (!genericLink) return;
    await copyToClipboard(genericLink, () => {
      setCopiedGeneric(true);
      setTimeout(() => setCopiedGeneric(false), 1500);
    });
  };

  const handleShareGeneric = async () => {
    if (!genericLink) return;
    await shareOrCopy(
      {
        title: "Join me on Haven",
        text: DEFAULT_GENERIC_TEXT,
        url: genericLink,
      },
      handleCopyGeneric,
      () => {
        setSharedGeneric(true);
        setTimeout(() => setSharedGeneric(false), 1500);
      }
    );
  };

  const handleCopyPersonal = async () => {
    if (!inviteUrl) return;
    await copyToClipboard(inviteUrl, () => {
      setCopiedPersonal(true);
      setTimeout(() => setCopiedPersonal(false), 1500);
    });
  };

  const handleSharePersonal = async () => {
    if (!inviteUrl) return;
    await shareOrCopy(
      {
        title: "Join me on Haven",
        text: DEFAULT_PERSONAL_TEXT,
        url: inviteUrl,
      },
      handleCopyPersonal,
      () => {
        setSharedPersonal(true);
        setTimeout(() => setSharedPersonal(false), 1500);
      }
    );
  };

  const handleCreateInvite = async () => {
    setCreateError(null);
    setCreateOk(null);
    setInviteUrl("");
    setCopiedPersonal(false);
    setSharedPersonal(false);

    const email = recipientEmail.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      setCreateError("Enter a valid email address.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/user/invite/personal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }), // ✅ no message
      });

      const data: {
        reason?: string;
        error?: string;
        message?: string;
        link?: string;
        path?: string;
      } | null = await res.json().catch(() => null);

      if (res.status === 409 && data?.reason === "already_on_haven") {
        setCreateError(
          "That person is already on Haven — added to your contacts as active."
        );
        await loadInvites();
        return;
      }

      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : typeof data?.message === "string"
            ? data.message
            : `Failed to create invite (status ${res.status})`;
        throw new Error(msg);
      }

      const link = typeof data?.link === "string" ? data.link : "";
      const path = typeof data?.path === "string" ? data.path : "";
      const finalUrl = toAbsoluteUrl(path || link);

      if (!finalUrl)
        throw new Error("Invite link missing from server response.");

      setInviteUrl(finalUrl);
      setCreateOk("Invite link created.");
      await loadInvites();
    } catch (err) {
      console.error("[InviteLink] create invite error:", err);
      setCreateError(
        err instanceof Error
          ? err.message
          : "Something went wrong creating your invite."
      );
    } finally {
      setCreating(false);
    }
  };

  const handleUseRecent = (email: string | null) => {
    if (!email) return;
    setRecipientEmail(email);
  };

  if (!user) return null;

  return (
    <section
      className={`w-full max-w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 sm:rounded-3xl sm:px-4 sm:py-4 ${
        className ?? ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-50">Invite friends</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Share a general link or create a one-time personal invite.
          </p>
        </div>
      </div>

      {/* Quick share */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
              <Link2 className="h-3.5 w-3.5 text-emerald-300" />
              Your referral link
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              Works for anyone. Best for socials.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleShareGeneric}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-zinc-100 active:scale-[0.98]"
            >
              {sharedGeneric ? (
                <Check className="h-3 w-3" />
              ) : (
                <Share2 className="h-3 w-3" />
              )}
              {sharedGeneric ? "Sent" : "Share"}
            </button>

            <button
              type="button"
              onClick={handleCopyGeneric}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-zinc-100 active:scale-[0.98]"
            >
              {copiedGeneric ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copiedGeneric ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
          <span className="text-[10px] text-zinc-500">Link</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-100">
            {genericLink}
          </span>
        </div>
      </div>

      <div className="my-3 h-px w-full bg-white/10" />

      {/* Personal invite */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
              <Mail className="h-3.5 w-3.5 text-emerald-300" />
              Personal invite
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              Email-bound & one-time use.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100">
            One-time
          </span>
        </div>

        <div className="mt-3 space-y-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">
              Recipient email
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="friend@example.com"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          {createError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">{createError}</div>
            </div>
          )}

          {createOk && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">{createOk}</div>
            </div>
          )}

          <button
            type="button"
            onClick={handleCreateInvite}
            disabled={creating}
            className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-emerald-500 bg-emerald-500 px-4 py-2 text-[12px] font-semibold text-black active:scale-[0.99] disabled:cursor-not-allowed disabled:border-emerald-500/30 disabled:bg-emerald-500/30"
          >
            {creating ? "Creating…" : "Create personal invite"}
          </button>

          {inviteUrl && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-black/30 p-3">
              <p className="text-[10px] font-medium text-zinc-300">
                Invite link
              </p>

              <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                <span className="text-[10px] text-zinc-500">Link</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-100">
                  {inviteUrl}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopyPersonal}
                  className="inline-flex items-center justify-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-zinc-100 active:scale-[0.98]"
                >
                  {copiedPersonal ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedPersonal ? "Copied" : "Copy"}
                </button>

                <button
                  type="button"
                  onClick={handleSharePersonal}
                  className="inline-flex items-center justify-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-zinc-100 active:scale-[0.98]"
                >
                  {sharedPersonal ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                  {sharedPersonal ? "Sent" : "Share"}
                </button>
              </div>

              <p className="mt-2 text-[10px] text-zinc-500">
                This link only works for that email and can’t be redeemed twice.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Recent invites */}
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-zinc-200">
              Recent personal invites
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              Updates when opened (track) and redeemed (claim).
            </p>
          </div>

          <button
            type="button"
            onClick={loadInvites}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-zinc-100 active:scale-[0.98]"
          >
            <RefreshCcw className="h-3 w-3" />
            {loadingInvites ? "…" : "Refresh"}
          </button>
        </div>

        <div className="mt-2">
          {loadingInvites ? (
            <p className="text-[10px] text-zinc-500">Loading invites…</p>
          ) : topInvites.length ? (
            <div className="space-y-2">
              {topInvites.map((inv, idx) => (
                <div
                  key={`${inv.email ?? "unknown"}-${inv.sentAt ?? idx}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-zinc-100">
                      {inv.email ?? "unknown"}
                    </p>
                    <p className="truncate text-[10px] text-zinc-500">
                      {inv.status === "signed_up"
                        ? `Signed up ${formatWhen(inv.redeemedAt) ?? ""}`.trim()
                        : inv.status === "clicked"
                        ? `Opened ${formatWhen(inv.clickedAt) ?? ""}`.trim()
                        : `Sent ${formatWhen(inv.sentAt) ?? ""}`.trim()}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${pill(
                        inv.status
                      )}`}
                    >
                      {statusLabel(inv.status)}
                    </span>

                    {inv.email && (
                      <button
                        type="button"
                        onClick={() => handleUseRecent(inv.email)}
                        className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-100 active:scale-[0.98]"
                        title="Use this email"
                      >
                        Use
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-zinc-500">
              No personal invites yet.
            </p>
          )}
        </div>
      </div>

      <p className="mt-3 text-[10px] text-zinc-500">
        Tip: use the referral link for public sharing; use personal invites for
        1:1 onboarding.
      </p>
    </section>
  );
};

export default InviteLink;
