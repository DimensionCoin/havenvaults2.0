// components/accounts/deposit/Transfer.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { X, User as UserIcon } from "lucide-react";
import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalance } from "@/providers/BalanceProvider";

type TransferProps = {
  walletAddress: string; // sender’s Haven wallet for this lane

  /**
   * Balance in the user's display currency for THIS account/lane
   * (e.g. 1500 CAD, 800 EUR, etc).
   */
  balanceUsd: number;

  onSuccess?: () => void | Promise<void>;
};

type Contact = {
  id?: string;
  name?: string;
  email?: string;
  walletAddress?: string;
  status: "invited" | "active" | "external";
  profileImageUrl?: string;
};

type ResolveState = "idle" | "checking" | "resolved" | "not_found" | "error";

type ResolvedRecipient = {
  email: string;
  walletAddress: string;
  name?: string;
  status?: string;
  profileImageUrl?: string;
};

const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s.trim().toLowerCase());

const getInitials = (nameOrEmail?: string | null) => {
  if (!nameOrEmail) return "";
  const base = nameOrEmail.trim();
  if (!base) return "";
  const parts = base.includes("@")
    ? base.split("@")[0].split(/[.\s_-]+/)
    : base.split(/\s+/);

  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase() || first.toUpperCase();
};

const Transfer: React.FC<TransferProps> = ({
  walletAddress,
  balanceUsd,
  onSuccess,
}) => {
  // We just need FX + display currency + refresh from BalanceProvider
  const { refresh: refreshBalances, displayCurrency, fxRate } = useBalance();

  const normalizedDisplayCurrency =
    displayCurrency === "USDC" || !displayCurrency
      ? "USD"
      : displayCurrency.toUpperCase();

  // USD → display currency rate (fallback 1)
  const effectiveFx = fxRate > 0 ? fxRate : 1;

  /**
   * laneBalanceDisplay:
   * - already in display currency for THIS account/lane
   * - drives UI + "has enough" checks
   */
  const laneBalanceDisplay = balanceUsd || 0;

  const formatDisplayAmount = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return "—";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: normalizedDisplayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${normalizedDisplayCurrency}`;
    }
  };

  // ── Step state ────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);

  // ── Contacts state ────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [deletingContactKey, setDeletingContactKey] = useState<string | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setContactsLoading(true);
      setContactsError(null);
      try {
        const res = await fetch("/api/user/contacts", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Failed to load contacts (${res.status})`);
        }
        const data = (await res.json()) as { contacts: Contact[] };
        if (!cancelled) setContacts(data.contacts || []);
      } catch (e) {
        if (!cancelled) {
          console.error("[Transfer] failed to load contacts:", e);
          setContactsError("Couldn’t load contacts.");
        }
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Recipient state (email + resolve) ─────────────────────────
  const [recipientInput, setRecipientInput] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedRecipient, setResolvedRecipient] =
    useState<ResolvedRecipient | null>(null);

  const handlePickContact = (c: Contact) => {
    if (c.email) {
      setRecipientInput(c.email);
      // step stays 1; user still has to confirm & continue
    }
  };

  useEffect(() => {
    // whenever email changes, we’re "back" to step 1 logically
    setStep(1);

    setResolvedRecipient(null);
    setResolveError(null);
    setResolveState("idle");

    const email = recipientInput.trim().toLowerCase();
    if (!isEmail(email)) return;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setResolveState("checking");
      try {
        const url = `/api/user/contacts/resolve?email=${encodeURIComponent(
          email
        )}`;
        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (cancelled) return;

        if (res.status === 404) {
          setResolveState("not_found");
          setResolvedRecipient(null);
          return;
        }

        const data: {
          walletAddress?: string;
          name?: string;
          status?: string;
          profileImageUrl?: string;
          error?: string;
        } | null = await res.json().catch(() => null);
        if (!res.ok || !data?.walletAddress) {
          setResolveState("error");
          setResolveError(
            typeof data?.error === "string"
              ? data.error
              : "Could not resolve recipient."
          );
          return;
        }

        setResolvedRecipient({
          email,
          walletAddress: data.walletAddress,
          name: data.name,
          status: data.status,
          profileImageUrl: data.profileImageUrl,
        });
        setResolveState("resolved");
      } catch (e) {
        if (!cancelled) {
          console.error("[Transfer] resolve failed:", e);
          setResolveState("error");
          setResolveError("Lookup failed. Try again.");
        }
      }
    }, 450); // debounce

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [recipientInput]);

  // ── Quick add contact ────────────────────────────────────────
  const [addingContact, setAddingContact] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddContact = async () => {
    const email = recipientInput.trim().toLowerCase();
    if (!isEmail(email)) {
      setAddError("Enter a valid email first.");
      return;
    }
    setAddError(null);
    setAddingContact(true);
    try {
      const res = await fetch("/api/user/contacts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data: { contacts?: Contact[]; error?: string } | null = await res
        .json()
        .catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Failed to save contact (${res.status})`
        );
      }
      if (Array.isArray(data?.contacts)) {
        setContacts(data.contacts);
      }
    } catch (e) {
      console.error("[Transfer] add contact failed:", e);
      setAddError(
        e instanceof Error ? e.message : "Could not save contact right now."
      );
    } finally {
      setAddingContact(false);
    }
  };
  const handleRemoveContact = async (contact: Contact) => {
    const key = contact.id ?? contact.email;
    if (!key) return;

    setContactsError(null);
    setDeletingContactKey(key);

    try {
      const res = await fetch("/api/user/contacts", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: contact.id, email: contact.email }),
      });

      const data: { error?: string } | null = await res
        .json()
        .catch(() => null);

      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Failed to remove contact (${res.status})`
        );
      }

      setContacts((prev) =>
        prev.filter(
          (c) =>
            c.id !== contact.id &&
            (contact.email ? c.email !== contact.email : true)
        )
      );
    } catch (e) {
      console.error("[Transfer] remove contact failed:", e);
      setContactsError(
        e instanceof Error
          ? e.message
          : "Could not remove this contact right now."
      );
    } finally {
      setDeletingContactKey(null);
    }
  };

  // ── Amount + fee state (UI in display currency, backend in USDC) ──
  const [amountInput, setAmountInput] = useState(""); // "100.00" in display currency

  // Parsed amount in *display currency*
  const amountDisplay = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  // Convert display → USDC (via USD).
  // display = USD * fx  =>  USD = display / fx  =>  USDC ≈ USD
  const amountUsdc = useMemo(() => {
    if (amountDisplay <= 0) return 0;
    const fx = effectiveFx || 1;
    return amountDisplay / fx;
  }, [amountDisplay, effectiveFx]);

  const {
    send,
    loading: sending,
    error: sendError,
    feeUsdc,
  } = useSponsoredUsdcTransfer();

  const effectiveFeeUsdc = feeUsdc ?? 0;
  const totalDebitedUsdc = amountUsdc + effectiveFeeUsdc;
  const totalDebitedDisplay = totalDebitedUsdc * effectiveFx;

  // ✅ Balance check in display currency, using the lane balance
  const hasEnoughBalance =
    amountDisplay > 0 && totalDebitedDisplay <= laneBalanceDisplay + 1e-9; // tiny epsilon

  // keypad (Haven 1.0 style) – still works in display currency
  const pressKey = (k: string) => {
    setAmountInput((prev) => {
      if (k === "DEL") return prev.slice(0, -1);
      if (k === "CLR") return "";
      if (k === ".") {
        if (!prev) return "0.";
        if (prev.includes(".")) return prev;
        return prev + ".";
      }
      const next = (prev || "") + k;
      const [, dec] = next.split(".");
      if (dec && dec.length > 2) return prev;
      if (!prev && k === "0") return "0";
      return next.length > 12 ? prev : next;
    });
  };

  // ── Step gating ──────────────────────────────────────────────
  const canContinueToAmount =
    !!walletAddress &&
    isEmail(recipientInput) &&
    resolveState === "resolved" &&
    !!resolvedRecipient?.walletAddress;

  const handleContinueToAmount = () => {
    if (!canContinueToAmount) return;
    setStep(2);
  };

  const sendDisabled =
    step !== 2 ||
    sending ||
    !walletAddress ||
    !canContinueToAmount ||
    amountDisplay <= 0 ||
    !hasEnoughBalance;

  // ── Submit transfer (amount in USDC behind the scenes) ────────
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    if (sendDisabled || !resolvedRecipient?.walletAddress) return;
    setSuccessMsg(null);

    try {
      const sig = await send({
        fromOwnerBase58: walletAddress,
        toOwnerBase58: resolvedRecipient.walletAddress,
        amountUi: amountUsdc, // backend gets USDC
        notify: {
          toOwnerBase58: resolvedRecipient.walletAddress,
          amountUi: amountUsdc,
          message: `Transfer to ${resolvedRecipient.email}`,
        },
      });

      const txId = sig ?? "";
      const shortSig =
        typeof txId === "string" && txId.length > 12
          ? `${txId.slice(0, 6)}…${txId.slice(-6)}`
          : txId;

      setSuccessMsg(
        txId
          ? `Transfer sent. Reference: ${shortSig}`
          : "Transfer sent successfully."
      );

      try {
        await new Promise((r) => setTimeout(r, 1200));
        await refreshBalances();
      } catch (e) {
        console.error("[Transfer] balance refresh failed:", e);
      }

      setAmountInput("");
      if (onSuccess) {
        await onSuccess();
      }
    } catch (e) {
      console.error("[Transfer] send failed:", e);
      // sendError surfaced below
    }
  }, [
    sendDisabled,
    resolvedRecipient,
    walletAddress,
    amountUsdc,
    send,
    refreshBalances,
    onSuccess,
  ]);

  // ── Contacts slice ────────────────────────────────────────────
  const visibleContacts = useMemo(() => {
    if (showAllContacts) return contacts;
    return contacts.slice(0, 3);
  }, [contacts, showAllContacts]);

  const hasMoreContacts = contacts.length > 3;

  // ── Recipient avatar state ────────────────────────────────────
  const recipientInitials = useMemo(
    () =>
      getInitials(
        resolvedRecipient?.name || resolvedRecipient?.email || undefined
      ),
    [resolvedRecipient]
  );

  // ── Render ────────────────────────────────────────────────────

  return (
    <DrawerContent
      className="
        border-t border-zinc-800 bg-[#03180051] backdrop-blur-xl text-zinc-50
        flex flex-col max-h-[90vh]
      "
    >
      <DrawerHeader className="shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <DrawerTitle className="text-base font-semibold">
              Transfer funds
            </DrawerTitle>
            <DrawerDescription className="text-[10px] text-zinc-400">
              Send money from your Haven account to another Haven user by email.
            </DrawerDescription>
          </div>
          <div className="text-[10px] px-2 py-1 rounded-full bg-black/40 border border-white/10 text-white/60">
            Step {step} of 2
          </div>
        </div>
      </DrawerHeader>

      {/* Scrollable body */}
      <div className="px-4 pb-4 flex-1 overflow-y-auto space-y-5">
        {/* STEP 1: Recipient */}
        {step === 1 && (
          <div className="rounded-3xl bg-black/60 border border-white/10 px-4 py-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-white/80">
                  Choose recipient
                </p>
                <p className="text-[11px] text-white/50">
                  Pick a contact or enter an email.
                </p>
              </div>
              <span className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/60">
                Balance: {formatDisplayAmount(laneBalanceDisplay)}
              </span>
            </div>

            {/* Email input */}
            <div className="space-y-1 mt-3">
              <label className="text-[11px] font-medium text-zinc-300">
                Recipient email
              </label>
              <input
                type="email"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                placeholder="friend@example.com"
                className={`
                  w-full rounded-xl bg-white/5 border px-3 py-2.5 text-sm
                  text-white placeholder-white/40 outline-none transition
                  ${
                    resolveState === "error" || resolveState === "not_found"
                      ? "border-red-500/50 focus:ring-2 focus:ring-red-500/30"
                      : "border-white/10 focus:ring-2 focus:ring-white/15 hover:border-white/20"
                  }
                `}
              />
              <div className="flex items-center justify-between text-[10px] mt-0.5">
                <span className="text-zinc-500">
                  {resolveState === "checking" && "Looking up recipient…"}
                  {resolveState === "resolved" &&
                    resolvedRecipient &&
                    `Sending to ${
                      resolvedRecipient.name || resolvedRecipient.email
                    }`}
                  {resolveState === "not_found" &&
                    "No Haven account found for this email (for now, transfers require a Haven account)."}
                  {resolveState === "idle" &&
                    "We’ll verify this email is on Haven."}
                  {resolveState === "error" &&
                    (resolveError || "Lookup failed.")}
                </span>

                <button
                  type="button"
                  onClick={handleAddContact}
                  disabled={addingContact || !isEmail(recipientInput)}
                  className="
                    rounded-full border border-white/15 bg-white/5
                    px-2.5 py-1 text-[10px] text-white/80
                    hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed
                    transition
                  "
                >
                  {addingContact ? "Saving…" : "Save contact"}
                </button>
              </div>
              {addError && (
                <p className="text-[10px] text-red-400 mt-0.5">{addError}</p>
              )}
            </div>

            {/* Contacts row UNDER the email input */}
            <div className="space-y-1 mt-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-400">Your contacts</p>
                {contactsLoading && (
                  <span className="text-[10px] text-zinc-500">Loading…</span>
                )}
              </div>
              {contactsError && (
                <p className="text-[10px] text-red-400">{contactsError}</p>
              )}
              {contacts.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleContacts.map((c, idx) => {
                      const key = c.id ?? c.email ?? String(idx);
                      const removing = deletingContactKey === key;
                      const label = c.name || c.email || "Contact";
                      const initials = getInitials(label);

                      return (
                        <div
                          key={key}
                          className="
                            inline-flex items-center gap-1 rounded-full
                            border border-white/10 bg-white/5 pr-1
                          "
                        >
                          <button
                            type="button"
                            onClick={() => handlePickContact(c)}
                            className="
                              inline-flex items-center gap-1 pl-2 pr-1 py-1
                              text-[10px] text-white/80 hover:bg-white/10 rounded-full
                            "
                          >
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[9px] font-semibold">
                              {initials || <UserIcon className="h-3 w-3" />}
                            </span>
                            <span className="truncate max-w-[110px]">
                              {label}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveContact(c);
                            }}
                            disabled={removing}
                            className="
                              inline-flex h-5 w-5 items-center justify-center
                              rounded-full hover:bg-red-500/30 text-[10px]
                              text-zinc-300 hover:text-red-50 disabled:opacity-50
                            "
                            aria-label="Remove contact"
                          >
                            {removing ? (
                              <span className="text-[9px]">…</span>
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {hasMoreContacts && (
                    <button
                      type="button"
                      onClick={() => setShowAllContacts((v) => !v)}
                      className="
                        mt-1 text-[10px] text-zinc-400 hover:text-zinc-200
                        underline underline-offset-2
                      "
                    >
                      {showAllContacts
                        ? "Show fewer"
                        : `Show all ${contacts.length} contacts`}
                    </button>
                  )}
                </>
              ) : !contactsLoading ? (
                <p className="text-[10px] text-zinc-500">
                  You don&apos;t have any contacts yet.
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* STEP 2: Amount */}
        {step === 2 && resolvedRecipient && (
          <div className="rounded-3xl bg-black/60 border border-white/10 overflow-hidden">
            {/* Recipient summary */}
            <div className="px-5 pt-4 pb-2 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-[11px] font-semibold">
                  {resolvedRecipient.profileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolvedRecipient.profileImageUrl}
                      alt={
                        resolvedRecipient.name || resolvedRecipient.email || ""
                      }
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : recipientInitials ? (
                    <span>{recipientInitials}</span>
                  ) : (
                    <UserIcon className="h-4 w-4 text-white" />
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-zinc-400">Sending to</p>
                  <p className="text-xs text-white/90 font-medium">
                    {resolvedRecipient.name || resolvedRecipient.email}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    Haven recipient • {resolvedRecipient.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="
                  text-[10px] px-2 py-1 rounded-full border border-white/10
                  bg-white/5 text-white/70 hover:bg-white/10 transition
                "
              >
                Change
              </button>
            </div>

            {/* Amount display (in display currency) */}
            <div className="px-6 pt-6 pb-2">
              <div className="text-center">
                <input
                  readOnly
                  value={amountInput}
                  placeholder="0"
                  className="
                    w-full text-center bg-transparent outline-none border-0
                    text-5xl font-semibold tracking-tight text-white
                    placeholder-white/20
                  "
                />
                <div className="mt-1 text-[11px] text-zinc-400">
                  Amount in {normalizedDisplayCurrency}
                </div>
              </div>
            </div>

            {/* Available + Max (in display currency) */}
            <div className="px-6 pb-3 flex items-center justify-between text-[11px]">
              <div className="text-white/60">
                Available:{" "}
                <span className="text-white/80">
                  {formatDisplayAmount(laneBalanceDisplay)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const maxDisplay = Math.max(
                    0,
                    laneBalanceDisplay - effectiveFeeUsdc * effectiveFx
                  );
                  const safe =
                    maxDisplay > 0 ? Math.floor(maxDisplay * 100) / 100 : 0;
                  setAmountInput(safe > 0 ? safe.toString() : "");
                }}
                className="text-white/80 hover:text-white underline underline-offset-2 disabled:opacity-40"
                disabled={laneBalanceDisplay <= effectiveFeeUsdc * effectiveFx}
              >
                Use max
              </button>
            </div>

            {/* Keypad */}
            <div className="px-4 pb-5">
              <div className="grid grid-cols-3 gap-3">
                {[
                  "1",
                  "2",
                  "3",
                  "4",
                  "5",
                  "6",
                  "7",
                  "8",
                  "9",
                  ".",
                  "0",
                  "DEL",
                ].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pressKey(k)}
                    className={`
                      rounded-2xl py-4 text-lg font-semibold border transition
                      ${
                        k === "DEL"
                          ? "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                          : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                      }
                    `}
                  >
                    {k === "DEL" ? "⌫" : k}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => pressKey("CLR")}
                  className="
                    w-full rounded-xl py-2 text-[11px] text-white/60
                    hover:text-white/80 hover:bg-white/5 border border-white/10
                  "
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Summary + errors */}
            <div className="px-6 pb-4 space-y-2">
              <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">They receive</span>
                  <span className="font-semibold text-white">
                    {formatDisplayAmount(amountDisplay || 0)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-white/60">You pay (incl. fee)</span>
                  <span className="font-semibold text-white">
                    {formatDisplayAmount(
                      amountDisplay > 0 ? totalDebitedDisplay : 0
                    )}
                  </span>
                </div>
              </div>

              {amountDisplay > 0 && !hasEnoughBalance && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                  Not enough balance to cover this amount and fee.
                </div>
              )}

              {(sendError || (resolveState === "error" && resolveError)) && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                  {sendError || resolveError}
                </div>
              )}

              {successMsg && (
                <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
                  {successMsg}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <DrawerFooter className="flex justify-between px-4 pb-4 pt-0 shrink-0 gap-2">
        {step === 1 ? (
          <button
            type="button"
            disabled={!canContinueToAmount}
            onClick={handleContinueToAmount}
            className="
              rounded-xl bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90
              text-black text-xs font-semibold px-4 py-2
              shadow-[0_0_18px_rgba(190,242,100,0.6)]
              transition disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            disabled={sendDisabled}
            onClick={handleSend}
            className="
              rounded-xl bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90
              text-black text-xs font-semibold px-4 py-2
              shadow-[0_0_18px_rgba(190,242,100,0.6)]
              transition disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {sending ? "Sending…" : "Send"}
          </button>
        )}
      </DrawerFooter>
    </DrawerContent>
  );
};

export default Transfer;
