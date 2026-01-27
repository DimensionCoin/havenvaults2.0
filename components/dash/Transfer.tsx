"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  Plus,
  Shield,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { PublicKey } from "@solana/web3.js";

import { useSponsoredExternalTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalance } from "@/providers/BalanceProvider";

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */

type TransferDashProps = {
  walletAddress: string;
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

type RecipientType = "contact" | "wallet";
type ModalStep = "amount" | "confirm";

type ResolvedRecipient = {
  type: RecipientType;
  email?: string;
  name?: string;
  profileImageUrl?: string;
  inputValue: string; // IMPORTANT: for wallet tab this will be the .sol input OR raw address input
  resolvedAddress: string; // the resolved base58 address
  isDomain?: boolean;
};

/* ─────────────────────────────────────────────────────────────
   Constants & Helpers
───────────────────────────────────────────────────────────── */

const AVATAR_SIZE = 52;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const isSolDomain = (s: string) => /^[a-zA-Z0-9_-]+\.sol$/i.test(s.trim());

const isSolAddress = (s: string) => {
  try {
    const t = s.trim();
    if (!t) return false;
    // PublicKey throws if invalid
    // Also rejects many non-base58 strings.
    // NOTE: This will accept any valid Solana pubkey (32 bytes).
    // That’s what we want for "regular wallets".
    // eslint-disable-next-line no-new
    new PublicKey(t);
    return true;
  } catch {
    return false;
  }
};

const truncateAddress = (addr: string, chars = 4) => {
  if (!addr || addr.length < chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
};

const formatCurrency = (n: number, currency: string) => {
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

function safeSolscanTxUrl(sig?: string | null) {
  if (!sig) return null;
  return `https://solscan.io/tx/${encodeURIComponent(sig)}`;
}

function normalizeContactName(c: Contact) {
  const raw = (c.name || "").trim();
  if (raw) return raw;
  if (c.email) {
    const username = c.email.split("@")[0] || c.email;
    return username.charAt(0).toUpperCase() + username.slice(1);
  }
  return "Contact";
}

/* ─────────────────────────────────────────────────────────────
   Avatar Component
───────────────────────────────────────────────────────────── */

function Avatar({
  size = AVATAR_SIZE,
  label,
  profileImageUrl,
  className = "",
}: {
  size?: number;
  label: string;
  profileImageUrl?: string | null;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  const url = (profileImageUrl || "").trim();
  const showImage = !!url && !imgError;

  return (
    <div
      className={[
        "rounded-full overflow-hidden flex items-center justify-center border border-border",
        showImage ? "bg-secondary" : "bg-secondary text-foreground",
        className,
      ].join(" ")}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={label}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <User
          className="text-foreground opacity-80"
          style={{
            width: Math.max(16, Math.floor(size * 0.45)),
            height: Math.max(16, Math.floor(size * 0.45)),
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Contact Circle Component (with delete mode)
───────────────────────────────────────────────────────────── */

function ContactCircle({
  contact,
  onTap,
  onDelete,
  isDeleteMode,
  disabled,
}: {
  contact: Contact;
  onTap: () => void;
  onDelete: () => void;
  isDeleteMode: boolean;
  disabled: boolean;
}) {
  const label = normalizeContactName(contact);

  return (
    <button
      type="button"
      onClick={isDeleteMode ? onDelete : onTap}
      disabled={disabled && !isDeleteMode}
      className={[
        "flex flex-col items-center gap-2 min-w-[80px] transition-all duration-200 active:scale-95",
        disabled && !isDeleteMode ? "opacity-40" : "",
        isDeleteMode ? "animate-wiggle" : "",
      ].join(" ")}
    >
      <div className="relative">
        <Avatar
          size={AVATAR_SIZE}
          label={label}
          profileImageUrl={contact.profileImageUrl}
          className={[
            "border-2 transition-all duration-200",
            isDeleteMode ? "border-destructive/70" : "border-transparent",
          ].join(" ")}
        />

        {isDeleteMode && (
          <div className="absolute -top-1 -right-1 w-6 h-6 bg-destructive rounded-full flex items-center justify-center shadow-lg">
            <X className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          </div>
        )}

        {!contact.walletAddress && !isDeleteMode && (
          <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-amber-100 dark:bg-amber-900/50 rounded-full flex items-center justify-center border-2 border-white dark:border-card">
            <span className="text-[10px]">⏳</span>
          </div>
        )}
      </div>

      <span
        className={[
          "text-[9px] font-medium truncate max-w-[80px] transition-colors",
          isDeleteMode ? "text-destructive" : "text-foreground",
        ].join(" ")}
      >
        {label}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main Component
───────────────────────────────────────────────────────────── */

export default function TransferDash({
  walletAddress,
  balanceUsd,
  onSuccess,
}: TransferDashProps) {
  const { refresh: refreshBalances, displayCurrency, fxRate } = useBalance();

  const currency =
    displayCurrency === "USDC" || !displayCurrency
      ? "USD"
      : displayCurrency.toUpperCase();

  const effectiveFx = fxRate > 0 ? fxRate : 1;
  const laneBalanceDisplay = balanceUsd || 0;

  const {
    send,
    validateAndResolve,
    loading: sending,
    resolving: walletResolving,
    error: sendError,
    feeUsdc,
    clearError,
  } = useSponsoredExternalTransfer();

  const effectiveFeeUsdc = feeUsdc ?? 1.5;

  // State
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tab, setTab] = useState<"contacts" | "wallet">("contacts");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [walletInput, setWalletInput] = useState("");
  const [walletResolved, setWalletResolved] = useState<{
    address: string;
    isDomain: boolean;
    domain?: string;
  } | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Add contact modal
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Send modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>("amount");
  const [resolvedRecipient, setResolvedRecipient] =
    useState<ResolvedRecipient | null>(null);

  // Amount
  const [amountInput, setAmountInput] = useState("");
  const amountDisplay = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  const amountUsdc = useMemo(
    () => (amountDisplay <= 0 ? 0 : amountDisplay / effectiveFx),
    [amountDisplay, effectiveFx],
  );

  const totalDebitedUsdc = amountUsdc + effectiveFeeUsdc;
  const totalDebitedDisplay = totalDebitedUsdc * effectiveFx;
  const feeDisplay = effectiveFeeUsdc * effectiveFx;

  const hasEnoughBalance =
    amountDisplay > 0 && totalDebitedDisplay <= laneBalanceDisplay + 0.001;

  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState(false);

  const tabs: { key: "contacts" | "wallet"; label: string }[] = [
    { key: "contacts", label: "Contacts" },
    { key: "wallet", label: "Wallet" },
  ];

  useEffect(() => {
    if (tab === "wallet") setDeleteMode(false);
  }, [tab]);

  useEffect(() => {
    if (!mounted) return;
    const open = addOpen || modalOpen;
    if (!open) return;

    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [mounted, addOpen, modalOpen]);

  // Load contacts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setContactsLoading(true);
      try {
        const res = await fetch("/api/user/contacts", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setContacts(data.contacts || []);
      } catch (e) {
        console.error("[TransferDash] load contacts failed:", e);
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ─────────────────────────────────────────────
     Wallet resolution (Sol address OR .sol)
     - IMPORTANT: allow backspacing / edits (do not "lock" input)
     - Clear resolved/error immediately on typing (done in input onChange)
     - Debounce resolution for .sol
  ────────────────────────────────────────────── */
  useEffect(() => {
    if (tab !== "wallet") return;

    if (!walletInput.trim()) {
      setWalletResolved(null);
      setWalletError(null);
      return;
    }

    const inputRaw = walletInput.trim();
    const inputLower = inputRaw.toLowerCase();

    // If it's a valid Solana address, resolve instantly (no SNS call)
    if (isSolAddress(inputRaw)) {
      setWalletResolved({
        address: inputRaw,
        isDomain: false,
      });
      setWalletError(null);
      return;
    }

    // If it's not a .sol domain, show a gentle error (after a couple chars)
    if (!isSolDomain(inputLower)) {
      setWalletResolved(null);
      setWalletError(
        inputRaw.length > 2 ? "Enter a Solana address or .sol domain" : null,
      );
      return;
    }

    // .sol domain -> resolve with debounce
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const result = await validateAndResolve(inputLower);
        if (cancelled) return;

        if (result && result.isDomain) {
          setWalletResolved({
            address: result.address,
            isDomain: true,
            domain: result.domain,
          });
          setWalletError(null);
        } else {
          setWalletError("Could not resolve domain");
          setWalletResolved(null);
        }
      } catch {
        if (!cancelled) {
          setWalletError("Resolution failed");
          setWalletResolved(null);
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, walletInput, validateAndResolve]);

  // Handlers
  const openSendModal = useCallback(
    (recipient: ResolvedRecipient) => {
      clearError();
      setTxSignature(null);
      setTxSuccess(false);
      setAmountInput("");
      setModalStep("amount");
      setResolvedRecipient(recipient);
      setModalOpen(true);
    },
    [clearError],
  );

  const handleContactTap = useCallback(
    (c: Contact) => {
      if (!c.walletAddress) return;
      openSendModal({
        type: "contact",
        email: c.email,
        name: c.name,
        profileImageUrl: c.profileImageUrl,
        inputValue: c.email || normalizeContactName(c),
        resolvedAddress: c.walletAddress,
        isDomain: false,
      });
    },
    [openSendModal],
  );

  const handleDeleteContact = useCallback(async (c: Contact) => {
    if (!c.email && !c.walletAddress) return;

    const id = c.email || c.walletAddress || "";
    setDeleting(id);

    try {
      const res = await fetch("/api/user/contacts", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: c.email,
          walletAddress: c.walletAddress,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts || []);
      }
    } catch (e) {
      console.error("[TransferDash] delete contact failed:", e);
    } finally {
      setDeleting(null);
    }
  }, []);

  const handleAddContact = useCallback(async () => {
    const email = addEmail.trim().toLowerCase();
    if (!isEmail(email)) {
      setAddError("Enter a valid email");
      return;
    }

    setAdding(true);
    setAddError(null);

    try {
      const res = await fetch("/api/user/contacts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to add contact");

      if (Array.isArray(data?.contacts)) setContacts(data.contacts);
      setAddOpen(false);
      setAddEmail("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add contact");
    } finally {
      setAdding(false);
    }
  }, [addEmail]);

  const handleWalletSend = useCallback(() => {
    if (!walletResolved?.address) return;

    const raw = walletInput.trim();
    const lower = raw.toLowerCase();

    // IMPORTANT:
    // - if domain: inputValue stays the domain string
    // - if address: inputValue is the address string
    openSendModal({
      type: "wallet",
      inputValue: walletResolved.isDomain ? lower : raw,
      resolvedAddress: walletResolved.address,
      isDomain: walletResolved.isDomain,
    });
  }, [walletResolved, walletInput, openSendModal]);

  const pressKey = useCallback((k: string) => {
    setAmountInput((prev) => {
      if (k === "DEL") return prev.slice(0, -1);
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
  }, []);

  const handleSetMax = useCallback(() => {
    const maxDisplay = Math.max(0, laneBalanceDisplay - feeDisplay - 0.01);
    const safe = maxDisplay > 0 ? Math.floor(maxDisplay * 100) / 100 : 0;
    setAmountInput(safe > 0 ? String(safe) : "");
  }, [laneBalanceDisplay, feeDisplay]);

  const handleSend = useCallback(async () => {
    if (!resolvedRecipient || amountUsdc <= 0 || sending) return;

    setTxSignature(null);
    setTxSuccess(false);
    clearError();

    try {
      // IMPORTANT:
      // If recipient is a .sol domain, pass the DOMAIN STRING into the hook.
      // Otherwise pass the resolved base58 address.
      const destination = resolvedRecipient.isDomain
        ? resolvedRecipient.inputValue
        : resolvedRecipient.resolvedAddress;

      const result = await send({
        fromOwnerBase58: walletAddress,
        toAddressOrDomain: destination,
        amountUi: amountUsdc,
      });

      setTxSignature(result.signature);
      setTxSuccess(true);

      setTimeout(() => {
        refreshBalances().catch(console.error);
      }, 1200);

      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error("[TransferDash] send failed:", e);
    }
  }, [
    resolvedRecipient,
    amountUsdc,
    sending,
    send,
    walletAddress,
    clearError,
    refreshBalances,
    onSuccess,
  ]);

  const canCloseModal = !sending;

  const openAddModal = useCallback(() => {
    setDeleteMode(false);
    setAddError(null);
    setAddEmail("");
    setAddOpen(true);
  }, []);

  return (
    <div className="w-full">
      {/* Header with tabs - carousel style */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1.5">
          {tabs.map((t) => {
            const isActive = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={[
                  "rounded-full px-3 py-1 text-[11px] font-medium transition border",
                  "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary/30 shadow-[0_10px_26px_rgba(41,198,104,0.18)] dark:shadow-[0_12px_30px_rgba(63,243,135,0.14)]"
                    : "",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "contacts" && contacts.length > 0 && (
          <button
            type="button"
            onClick={() => setDeleteMode(!deleteMode)}
            className={[
              "rounded-full px-3 py-1 text-[11px] font-medium transition border",
              deleteMode
                ? "bg-destructive/10 text-destructive border-destructive/30"
                : "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            {deleteMode ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {/* Contacts Tab */}
      {tab === "contacts" && (
        <div className="mt-3">
          <div
            className={[
              "flex items-start gap-4 py-2",
              contactsLoading || contacts.length > 0
                ? "overflow-x-auto no-scrollbar"
                : "overflow-x-hidden",
            ].join(" ")}
          >
            {/* Add Button */}
            <button
              type="button"
              onClick={openAddModal}
              className="flex flex-col items-center gap-2 min-w-[80px] active:scale-95 transition-transform"
            >
              <div
                className="rounded-full bg-secondary border border-dashed border-border flex items-center justify-center"
                style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
              >
                <Plus className="w-6 h-6 text-muted-foreground" />
              </div>
              <span className="text-[9px] font-medium text-muted-foreground">
                Add
              </span>
            </button>

            {/* Empty-state hint (beside Add) */}
            {!contactsLoading && contacts.length === 0 && (
              <button
                type="button"
                onClick={openAddModal}
                className={[
                  "h-[64px] mt-[2px] rounded-2xl px-4",
                  "flex items-center gap-3",
                  "border border-border bg-secondary/40",
                  "text-left transition hover:bg-accent active:scale-[0.99]",
                  "min-w-[240px] sm:min-w-[300px]",
                ].join(" ")}
              >
                <div className="w-10 h-10 rounded-2xl bg-card border border-border flex items-center justify-center flex-shrink-0">
                  <Mail className="w-4 h-4 text-foreground/80" />
                </div>

                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground leading-tight">
                    Add a Haven user by email
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    Save contacts for quick access when transferring.
                  </p>
                </div>
              </button>
            )}

            {/* Loading State */}
            {contactsLoading && (
              <>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-2 min-w-[80px]"
                  >
                    <div
                      className="rounded-full bg-secondary animate-pulse border border-border"
                      style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
                    />
                    <div className="h-4 w-12 bg-secondary rounded animate-pulse" />
                  </div>
                ))}
              </>
            )}

            {/* Contacts */}
            {!contactsLoading &&
              contacts.map((c, idx) => (
                <ContactCircle
                  key={c.id || c.email || idx}
                  contact={c}
                  onTap={() => handleContactTap(c)}
                  onDelete={() => handleDeleteContact(c)}
                  isDeleteMode={deleteMode}
                  disabled={
                    !c.walletAddress ||
                    deleting === (c.email || c.walletAddress)
                  }
                />
              ))}
          </div>
        </div>
      )}

      {/* Wallet Tab (Sol address OR .sol) */}
      {tab === "wallet" && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={walletInput}
                onChange={(e) => {
                  // Allow free edits (backspace etc) without stale resolved state fighting you
                  const v = e.target.value;
                  setWalletInput(v);
                  setWalletResolved(null);
                  setWalletError(null);
                }}
                placeholder="wallet address or name.sol"
                className="haven-input pl-10 font-mono text-[13px] text-black dark:text-foreground"
              />
              {walletResolving && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleWalletSend}
              disabled={!walletResolved?.address}
              className={[
                // Keep button size stable even if haven-btn-primary sets width styles
                "px-4 h-[44px] rounded-2xl font-semibold text-[13px] transition-all shrink-0 whitespace-nowrap !w-auto",
                walletResolved?.address
                  ? "haven-btn-primary"
                  : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
              ].join(" ")}
            >
              Send
            </button>
          </div>

          {walletError && (
            <p className="mt-2 text-[11px] text-destructive">{walletError}</p>
          )}

          {walletResolved?.address && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {walletResolved.isDomain ? "Resolved:" : "Address:"}{" "}
              <span className="font-mono">
                {truncateAddress(walletResolved.address, 8)}
              </span>
            </p>
          )}
        </div>
      )}

      {/* ─────────────────────────────
          ADD CONTACT MODAL
         ───────────────────────────── */}
      {mounted &&
        addOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !adding) setAddOpen(false);
            }}
          >
            <div
              className="relative w-full sm:max-w-md haven-card overflow-hidden h-[60dvh] sm:h-auto sm:max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-secondary flex items-center justify-center">
                      <Users className="w-4 h-4 text-foreground" />
                    </div>
                    <div>
                      <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
                        Add Contact
                      </h2>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Save an email to your contacts
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => !adding && setAddOpen(false)}
                    disabled={adding}
                    className="haven-icon-btn !w-9 !h-9"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                <label className="block text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
                  <input
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="friend@example.com"
                    className="haven-input pl-10 text-black"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && isEmail(addEmail) && !adding) {
                        handleAddContact();
                      }
                    }}
                  />
                </div>

                {addError && (
                  <p className="mt-2 text-[11px] text-destructive">
                    {addError}
                  </p>
                )}

                <div className="mt-4 p-3 rounded-xl bg-primary/5 border border-primary/15">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    We&apos;ll try to match this email to a Haven user. If they
                    don&apos;t have a Haven account yet, you can still keep them
                    saved here.
                  </p>
                </div>
              </div>

              <div className="flex-shrink-0 p-5 border-t border-border bg-card/80 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={handleAddContact}
                  disabled={adding || !isEmail(addEmail)}
                  className={[
                    "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                    !adding && isEmail(addEmail)
                      ? "haven-btn-primary"
                      : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
                  ].join(" ")}
                >
                  {adding ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Save Contact
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* ─────────────────────────────
          SEND MODAL
         ───────────────────────────── */}
      {mounted &&
        modalOpen &&
        resolvedRecipient &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4"
            onClick={(e) => {
              if (canCloseModal && e.target === e.currentTarget) {
                setModalOpen(false);
              }
            }}
          >
            <div
              className="relative w-full sm:max-w-md haven-card overflow-hidden h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {!txSuccess && modalStep === "confirm" && (
                      <button
                        type="button"
                        onClick={() => setModalStep("amount")}
                        disabled={sending}
                        className="haven-icon-btn !w-9 !h-9"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                    )}

                    <div>
                      <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
                        {txSuccess ? "Transfer Sent" : "Send USDC"}
                      </h2>
                      {!txSuccess && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {modalStep === "amount"
                            ? "Enter amount to send"
                            : "Review and confirm"}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => canCloseModal && setModalOpen(false)}
                    disabled={!canCloseModal}
                    className="haven-icon-btn !w-9 !h-9"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* mini recipient row */}
                {!txSuccess && (
                  <div className="mt-4 flex items-center gap-3 haven-card-soft px-4 py-3">
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center overflow-hidden">
                      {resolvedRecipient.type === "contact" ? (
                        <Avatar
                          size={40}
                          label={
                            resolvedRecipient.name ||
                            resolvedRecipient.email ||
                            "Recipient"
                          }
                          profileImageUrl={resolvedRecipient.profileImageUrl}
                        />
                      ) : (
                        <Wallet className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        {resolvedRecipient.type === "contact"
                          ? resolvedRecipient.name || resolvedRecipient.email
                          : resolvedRecipient.isDomain
                            ? resolvedRecipient.inputValue
                            : truncateAddress(resolvedRecipient.inputValue, 4)}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        {truncateAddress(resolvedRecipient.resolvedAddress, 8)}
                      </p>
                    </div>
                    <Shield className="w-4 h-4 text-primary/60 flex-shrink-0" />
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {/* Amount */}
                {!txSuccess && modalStep === "amount" && (
                  <div className="p-5">
                    <div className="text-center py-4">
                      <div className="inline-flex items-baseline gap-2">
                        <span className="text-[40px] sm:text-[48px] font-bold text-foreground tracking-tight tabular-nums">
                          {amountInput || "0"}
                        </span>
                        <span className="text-[18px] font-medium text-muted-foreground">
                          {currency}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-col items-center gap-1 text-[11px]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>
                            Available:{" "}
                            {formatCurrency(laneBalanceDisplay, currency)}
                          </span>
                          <span>•</span>
                          <button
                            type="button"
                            onClick={handleSetMax}
                            className="text-primary hover:text-primary/80 font-medium"
                          >
                            Max
                          </button>
                        </div>

                        {amountDisplay > 0 && (
                          <div className="text-muted-foreground">
                            + {formatCurrency(feeDisplay, currency)} fee ={" "}
                            {formatCurrency(totalDebitedDisplay, currency)}{" "}
                            total
                          </div>
                        )}
                      </div>

                      {amountDisplay > 0 && !hasEnoughBalance && (
                        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border border-destructive/20 rounded-full text-[11px] text-destructive">
                          <span>Insufficient balance</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
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
                          className={[
                            "h-14 sm:h-16 rounded-2xl text-[20px] font-semibold transition-all bg-secondary hover:bg-accent active:scale-95 border border-border",
                            k === "DEL"
                              ? "text-muted-foreground"
                              : "text-foreground",
                          ].join(" ")}
                        >
                          {k === "DEL" ? "⌫" : k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Confirm */}
                {!txSuccess && modalStep === "confirm" && (
                  <div className="p-5">
                    <div className="text-center py-6">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
                        You&apos;re sending
                      </p>
                      <span className="text-[44px] font-bold text-foreground tracking-tight">
                        {formatCurrency(amountDisplay, currency)}
                      </span>
                    </div>

                    <div className="haven-card-soft overflow-hidden">
                      <div className="p-4 border-b border-border space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-muted-foreground">
                            Amount
                          </span>
                          <span className="text-[13px] text-foreground font-medium">
                            {formatCurrency(amountDisplay, currency)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-muted-foreground">
                            Haven fee
                          </span>
                          <span className="text-[13px] text-foreground font-medium">
                            {formatCurrency(feeDisplay, currency)}
                          </span>
                        </div>

                        <div className="pt-3 border-t border-border flex items-center justify-between">
                          <span className="text-[13px] text-foreground font-medium">
                            Total
                          </span>
                          <span className="text-[15px] text-primary font-semibold">
                            {formatCurrency(totalDebitedDisplay, currency)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {sendError && (
                      <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                        <p className="text-[12px] text-destructive">
                          {sendError}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Success */}
                {txSuccess && (
                  <div className="p-5">
                    <div className="text-center py-8">
                      <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-5">
                        <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center glow-mint">
                          <Check
                            className="w-8 h-8 text-primary-foreground"
                            strokeWidth={3}
                          />
                        </div>
                      </div>

                      <h3 className="text-[20px] font-bold text-foreground mb-1">
                        Transfer Sent!
                      </h3>

                      <p className="text-[13px] text-muted-foreground">
                        {formatCurrency(amountDisplay, currency)} sent to{" "}
                        {resolvedRecipient.type === "contact"
                          ? resolvedRecipient.name || resolvedRecipient.email
                          : resolvedRecipient.isDomain
                            ? resolvedRecipient.inputValue
                            : truncateAddress(
                                resolvedRecipient.resolvedAddress,
                                4,
                              )}
                      </p>
                    </div>

                    <div className="haven-card-soft p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                          Transaction
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (txSignature)
                                navigator.clipboard.writeText(txSignature);
                            }}
                            className="haven-icon-btn !w-7 !h-7"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>

                          {safeSolscanTxUrl(txSignature) && (
                            <a
                              href={safeSolscanTxUrl(txSignature)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="haven-icon-btn !w-7 !h-7"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>

                      <p className="text-[12px] text-muted-foreground font-mono break-all">
                        {txSignature}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 p-5 border-t border-border bg-card/80 backdrop-blur-sm">
                {!txSuccess && modalStep === "amount" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (amountDisplay <= 0 || !hasEnoughBalance) return;
                      setModalStep("confirm");
                    }}
                    disabled={amountDisplay <= 0 || !hasEnoughBalance}
                    className={[
                      "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                      amountDisplay > 0 && hasEnoughBalance
                        ? "haven-btn-primary"
                        : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
                    ].join(" ")}
                  >
                    Review Transfer
                  </button>
                )}

                {!txSuccess && modalStep === "confirm" && (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending}
                    className="haven-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-70"
                  >
                    {sending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Confirm &amp; Send
                      </>
                    )}
                  </button>
                )}

                {txSuccess && (
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="haven-btn-secondary w-full"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Wiggle animation for delete mode */}
      <style jsx global>{`
        @keyframes wiggle {
          0%,
          100% {
            transform: rotate(-1deg);
          }
          50% {
            transform: rotate(1deg);
          }
        }
        .animate-wiggle {
          animation: wiggle 0.15s ease-in-out infinite;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
