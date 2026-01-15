// components/accounts/deposit/Transfer.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, User as UserIcon, X } from "lucide-react";

import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalance } from "@/providers/BalanceProvider";

type TransferProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Sender’s Haven wallet */
  walletAddress: string;

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
const sanitizeAmountInput = (s: string) => s.replace(/[^\d.]/g, "");

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

export default function Transfer({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}: TransferProps) {
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

  // Portal mount guard (prevents hydration mismatch)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* ───────────────── Step state ───────────────── */
  const [step, setStep] = useState<1 | 2>(1);

  /* ───────────────── Contacts ───────────────── */
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [showAllContacts, setShowAllContacts] = useState(false);

  useEffect(() => {
    if (!open) return;
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
          console.error("[Deposit Transfer] failed to load contacts:", e);
          setContactsError("Couldn’t load contacts");
        }
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const visibleContacts = useMemo(() => {
    if (showAllContacts) return contacts;
    return contacts.slice(0, 3);
  }, [contacts, showAllContacts]);

  const hasMoreContacts = contacts.length > 3;

  const handlePickContact = (c: Contact) => {
    if (c.email) setRecipientInput(c.email);
  };

  /* ───────────────── Recipient resolve ───────────────── */
  const [recipientInput, setRecipientInput] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedRecipient, setResolvedRecipient] =
    useState<ResolvedRecipient | null>(null);

  useEffect(() => {
    if (!open) return;

    // whenever recipient changes, reset to step 1
    setStep(1);
    setResolvedRecipient(null);
    setResolveError(null);
    setResolveState("idle");

    const email = recipientInput.trim().toLowerCase();
    if (!isEmail(email)) return;

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
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
              : "Could not resolve recipient"
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
          console.error("[Deposit Transfer] resolve failed:", e);
          setResolveState("error");
          setResolveError("Lookup failed. Try again.");
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, recipientInput]);

  /* ───────────────── Quick add contact ───────────────── */
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

      if (Array.isArray(data?.contacts)) setContacts(data.contacts);
    } catch (e) {
      console.error("[Deposit Transfer] add contact failed:", e);
      setAddError(
        e instanceof Error ? e.message : "Could not save contact right now."
      );
    } finally {
      setAddingContact(false);
    }
  };

  /* ───────────────── Amount + fee (UI in display, backend in USDC) ───────────────── */
  const [amountInput, setAmountInput] = useState(""); // display currency

  const amountDisplay = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  // display = USD * fx => USD = display / fx => USDC ≈ USD
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

  const hasEnoughBalance =
    amountDisplay > 0 && totalDebitedDisplay <= laneBalanceDisplay + 1e-9;

  // keypad behavior matches TransferSPL (2 decimals for fiat)
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

  /* ───────────────── Step gating ───────────────── */
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

  /* ───────────────── Submit transfer ───────────────── */
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

      const shortSig =
        sig && sig.length > 12 ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : sig;

      setSuccessMsg(
        sig ? `transfer sent. Tx: ${shortSig}` : "transfer failed."
      );

      try {
        await new Promise((r) => setTimeout(r, 1200));
        await refreshBalances();
      } catch (e) {
        console.error("[Deposit Transfer] balance refresh failed:", e);
      }

      setAmountInput("");
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error("[Deposit Transfer] send failed:", e);
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

  const recipientLabel =
    resolvedRecipient?.name || resolvedRecipient?.email || "";
  const recipientInitials = useMemo(
    () => getInitials(recipientLabel),
    [recipientLabel]
  );

  /* ───────────────── Reset on close ───────────────── */
  useEffect(() => {
    if (open) return;

    setStep(1);
    setRecipientInput("");
    setResolvedRecipient(null);
    setResolveState("idle");
    setResolveError(null);

    setAmountInput("");
    setSuccessMsg(null);

    setAddError(null);
    setContactsError(null);
    setShowAllContacts(false);
  }, [open]);

  /* ───────────────── Lock background scroll like Flex ───────────────── */
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  const canClose = !sending; // keep simple: don’t close while sending

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (!canClose) return;
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-md haven-card p-5 shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground/90">
              Transfer USDC
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Send USDC to a Haven user by email (gas covered).
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="haven-pill">Step {step} of 2</span>

            <button
              type="button"
              onClick={() => (canClose ? onOpenChange(false) : undefined)}
              disabled={!canClose}
              className="haven-pill hover:bg-accent disabled:opacity-50"
              aria-label="Close"
              title={!canClose ? "Please wait…" : "Close"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mt-4 space-y-3 max-h-[70vh] overflow-y-auto no-scrollbar overscroll-contain">
          {/* STEP 1 */}
          {step === 1 && (
            <div className="haven-card-soft px-3.5 py-3.5">
              <div className="mb-2 text-[11px]">
                <p className="font-medium text-foreground/90">
                  Who are you sending to?
                </p>
                <p className="text-muted-foreground">
                  Enter a Haven email (must be an existing Haven account).
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Recipient
                </label>

                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                  <input
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder="friend@example.com"
                    className={[
                      "haven-input pl-9 pr-3 py-2 text-[12px] text-foreground",
                      resolveState === "error" || resolveState === "not_found"
                        ? "border-destructive/40 focus-visible:ring-destructive/30"
                        : "",
                    ].join(" ")}
                  />
                </div>

                <div className="mt-1 flex items-center justify-between gap-3 text-[10px]">
                  <span className="text-muted-foreground">
                    {resolveState === "checking" && "Looking up recipient…"}
                    {resolveState === "resolved" &&
                      resolvedRecipient &&
                      `Sending to ${resolvedRecipient.name || resolvedRecipient.email}`}
                    {resolveState === "not_found" &&
                      "No Haven account found for this email yet."}
                    {resolveState === "idle" &&
                      "We’ll verify Haven accounts when you enter an email."}
                    {resolveState === "error" &&
                      (resolveError || "Lookup failed.")}
                  </span>

                  <button
                    type="button"
                    onClick={handleAddContact}
                    disabled={addingContact || !isEmail(recipientInput)}
                    className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] text-foreground/90 hover:bg-secondary disabled:opacity-40"
                  >
                    {addingContact ? "Saving…" : "Save"}
                  </button>
                </div>

                {addError && (
                  <p className="text-[10px] text-destructive">{addError}</p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">Available</p>
                <span className="haven-pill">
                  {formatDisplayAmount(laneBalanceDisplay)}
                </span>
              </div>

              {/* Contacts */}
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">
                    Your contacts
                  </p>
                  {contactsLoading && (
                    <span className="text-[10px] text-muted-foreground">
                      Loading…
                    </span>
                  )}
                </div>

                {contactsError && (
                  <p className="mt-1 text-[10px] text-destructive">
                    {contactsError}
                  </p>
                )}

                {contacts.length > 0 ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {visibleContacts.map((c, idx) => (
                        <button
                          key={c.id ?? c.email ?? idx}
                          type="button"
                          onClick={() => handlePickContact(c)}
                          className="haven-pill hover:bg-accent"
                        >
                          {c.name || c.email || "Contact"}
                        </button>
                      ))}
                    </div>

                    {hasMoreContacts && (
                      <button
                        type="button"
                        onClick={() => setShowAllContacts((v) => !v)}
                        className="mt-2 text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        {showAllContacts
                          ? "Show fewer"
                          : `Show all ${contacts.length} contacts`}
                      </button>
                    )}
                  </>
                ) : !contactsLoading ? (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    You don&apos;t have any contacts yet.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && resolvedRecipient && (
            <div className="haven-card-soft overflow-hidden">
              {/* Summary header */}
              <div className="px-3.5 py-3 border-b border-border">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-[10px] font-semibold">
                      {recipientInitials ? (
                        recipientInitials
                      ) : (
                        <UserIcon className="h-4 w-4 text-foreground/80" />
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        Sending to
                      </p>
                      <p className="text-[11px] font-semibold text-primary">
                        {recipientLabel}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Haven recipient • {resolvedRecipient.email}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="haven-pill hover:bg-accent"
                    disabled={sending}
                  >
                    Change
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-end">
                  <div className="text-right text-[10px] text-muted-foreground">
                    Available:{" "}
                    <span className="text-foreground/90">
                      {formatDisplayAmount(laneBalanceDisplay)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Amount area */}
              <div className="px-3.5 py-3.5">
                <div className="mb-2 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    Amount ({normalizedDisplayCurrency})
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      const maxDisplay = Math.max(
                        0,
                        laneBalanceDisplay - effectiveFeeUsdc * effectiveFx
                      );
                      const safe =
                        maxDisplay > 0 ? Math.floor(maxDisplay * 100) / 100 : 0;
                      setAmountInput(safe > 0 ? String(safe) : "");
                    }}
                    className="haven-pill haven-pill-positive hover:bg-primary/15 disabled:opacity-40 text-primary"
                    disabled={
                      laneBalanceDisplay <= effectiveFeeUsdc * effectiveFx
                    }
                  >
                    Max
                  </button>
                </div>

                <input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => {
                    const next = sanitizeAmountInput(e.target.value);
                    const [, dec = ""] = next.split(".");
                    if (dec.length > 2) return;
                    setAmountInput(next);
                  }}
                  placeholder="0.00"
                  className="w-full bg-transparent text-left text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
                />

                <p className="mt-2 text-[10px] text-muted-foreground">
                  You pay (incl. fee):{" "}
                  <span className="text-foreground/90">
                    {formatDisplayAmount(
                      amountDisplay > 0 ? totalDebitedDisplay : 0
                    )}
                  </span>
                </p>

                <p className="mt-1 text-[10px] text-muted-foreground">
                  They receive:{" "}
                  <span className="text-foreground/90">
                    {formatDisplayAmount(amountDisplay || 0)}
                  </span>
                </p>

                {amountDisplay > 0 && !hasEnoughBalance && (
                  <div className="mt-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    Not enough balance to cover amount + fee.
                  </div>
                )}

                {(sendError || (resolveState === "error" && resolveError)) && (
                  <div className="mt-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    {sendError || resolveError}
                  </div>
                )}

                {successMsg && (
                  <div className="mt-2 rounded-2xl border border-primary/25 bg-primary/10 px-3 py-2 text-[11px] text-foreground">
                    {successMsg}
                  </div>
                )}

                {/* Keypad */}
                <div className="mt-3">
                  <div className="grid grid-cols-3 gap-2 text-foreground">
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
                        disabled={sending}
                        className={[
                          "rounded-2xl border py-3 text-base font-semibold transition",
                          "border-border bg-background/40 hover:bg-secondary",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                        ].join(" ")}
                      >
                        {k === "DEL" ? "⌫" : k}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => pressKey("CLR")}
                    disabled={sending}
                    className="mt-2 w-full rounded-2xl border border-border bg-background/40 py-2 text-[11px] text-muted-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer (pinned like Flex style) */}
        <div className="mt-4">
          {step === 1 ? (
            <button
              type="button"
              className={[
                "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border",
                canContinueToAmount
                  ? "haven-btn-primary active:scale-[0.98] text-[#0b3204]"
                  : "border-border bg-background/40 text-muted-foreground cursor-not-allowed",
              ].join(" ")}
              disabled={!canContinueToAmount}
              onClick={handleContinueToAmount}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className={[
                "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border",
                !sendDisabled
                  ? "haven-btn-primary active:scale-[0.98] text-[#0b3204]"
                  : "border-border bg-background/40 text-muted-foreground cursor-not-allowed",
              ].join(" ")}
              disabled={sendDisabled}
              onClick={handleSend}
            >
              {sending ? "Sending..." : "Send"}
            </button>
          )}

          {/* Optional secondary close */}
          <button
            type="button"
            disabled={!canClose}
            onClick={() => onOpenChange(false)}
            className="mt-3 w-full rounded-2xl border border-border bg-background/50 px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-accent transition disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
