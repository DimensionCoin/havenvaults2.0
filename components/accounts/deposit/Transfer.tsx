"use client";

// components/accounts/deposit/Transfer.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  Plus,
  Search,
  Shield,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useSponsoredExternalTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalance } from "@/providers/BalanceProvider";

type TransferProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
type Step = "recipient" | "amount" | "confirm";

type ResolvedRecipient = {
  type: RecipientType;
  email?: string;
  name?: string;
  profileImageUrl?: string;
  inputValue: string;
  resolvedAddress: string;
  isDomain?: boolean;
};

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const isSolDomain = (s: string) => /^[a-zA-Z0-9_-]+\.sol$/i.test(s.trim());
const isValidAddress = (s: string) => {
  try {
    return (
      s.trim().length >= 32 &&
      s.trim().length <= 44 &&
      /^[1-9A-HJ-NP-Za-km-z]+$/.test(s.trim())
    );
  } catch {
    return false;
  }
};

const truncateAddress = (addr: string, chars = 4) => {
  if (!addr || addr.length < chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
};

const getInitials = (nameOrEmail?: string | null) => {
  if (!nameOrEmail) return "";
  const base = nameOrEmail.trim();
  if (!base) return "";
  const parts = base.includes("@")
    ? base.split("@")[0].split(/[.\s_-]+/)
    : base.split(/\s+/);
  return (
    ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() ||
    (parts[0]?.[0] ?? "").toUpperCase()
  );
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

export default function Transfer({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}: TransferProps) {
  const { refresh: refreshBalances, displayCurrency, fxRate } = useBalance();
  const inputRef = useRef<HTMLInputElement>(null);

  const currency =
    displayCurrency === "USDC" || !displayCurrency
      ? "USD"
      : displayCurrency.toUpperCase();

  const effectiveFx = fxRate > 0 ? fxRate : 1;

  // NOTE: keeping your original behavior as-is:
  // laneBalanceDisplay is whatever you pass in already (not FX converted here)
  const laneBalanceDisplay = balanceUsd || 0;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [step, setStep] = useState<Step>("recipient");
  const [recipientType, setRecipientType] = useState<RecipientType>("contact");
  const [resolvedRecipient, setResolvedRecipient] =
    useState<ResolvedRecipient | null>(null);
  const [amountInput, setAmountInput] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const [emailInput, setEmailInput] = useState("");
  const [emailResolving, setEmailResolving] = useState(false);
  const [emailResolved, setEmailResolved] = useState<{
    walletAddress: string;
    name?: string;
    profileImageUrl?: string;
  } | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [addingContact, setAddingContact] = useState(false);
  const [addContactError, setAddContactError] = useState<string | null>(null);
  const [addContactSuccess, setAddContactSuccess] = useState(false);

  const [walletInput, setWalletInput] = useState("");
  const [walletResolved, setWalletResolved] = useState<{
    address: string;
    isDomain: boolean;
    domain?: string;
  } | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

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

  // Load contacts
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setContactsLoading(true);
      try {
        const res = await fetch("/api/user/contacts", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setContacts(data.contacts || []);
        }
      } catch (e) {
        console.error("[Transfer] Failed to load contacts:", e);
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q),
    );
  }, [contacts, contactSearch]);

  // Add contact handler
  const handleAddContact = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!isEmail(email)) {
      setAddContactError("Enter a valid email first.");
      return;
    }
    setAddContactError(null);
    setAddContactSuccess(false);
    setAddingContact(true);
    try {
      const res = await fetch("/api/user/contacts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Failed to save contact (${res.status})`,
        );
      if (Array.isArray(data?.contacts)) setContacts(data.contacts);
      setAddContactSuccess(true);
      setTimeout(() => setAddContactSuccess(false), 2000);
    } catch (e) {
      console.error("[Transfer] Add contact failed:", e);
      setAddContactError(
        e instanceof Error ? e.message : "Could not save contact right now.",
      );
    } finally {
      setAddingContact(false);
    }
  };

  // Email resolution
  useEffect(() => {
    if (recipientType !== "contact" || !emailInput.trim()) {
      setEmailResolved(null);
      setEmailError(null);
      return;
    }
    if (!isEmail(emailInput)) {
      setEmailResolved(null);
      setEmailError(null);
      return;
    }
    const email = emailInput.trim().toLowerCase();
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setEmailResolving(true);
      setEmailError(null);
      try {
        const res = await fetch(
          `/api/user/contacts/resolve?email=${encodeURIComponent(email)}`,
          { method: "GET", credentials: "include", cache: "no-store" },
        );
        if (cancelled) return;
        if (res.status === 404) {
          setEmailError("No Haven account found for this email");
          setEmailResolved(null);
          return;
        }
        const data = await res.json();
        if (!res.ok || !data?.walletAddress) {
          setEmailError(data?.error || "Could not resolve recipient");
          setEmailResolved(null);
          return;
        }
        setEmailResolved({
          walletAddress: data.walletAddress,
          name: data.name,
          profileImageUrl: data.profileImageUrl,
        });
        setEmailError(null);
      } catch {
        if (!cancelled) {
          setEmailError("Lookup failed. Please try again.");
          setEmailResolved(null);
        }
      } finally {
        if (!cancelled) setEmailResolving(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [emailInput, recipientType]);

  // Wallet/domain resolution
  useEffect(() => {
    if (recipientType !== "wallet" || !walletInput.trim()) {
      setWalletResolved(null);
      setWalletError(null);
      return;
    }
    const input = walletInput.trim();
    if (isValidAddress(input)) {
      setWalletResolved({ address: input, isDomain: false });
      setWalletError(null);
      return;
    }
    if (!isSolDomain(input)) {
      setWalletResolved(null);
      setWalletError(input.length > 5 ? "Invalid address or domain" : null);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const result = await validateAndResolve(input);
        if (cancelled) return;
        if (result) {
          setWalletResolved({
            address: result.address,
            isDomain: result.isDomain,
            domain: result.domain,
          });
          setWalletError(null);
        } else {
          setWalletError("Could not resolve this domain");
          setWalletResolved(null);
        }
      } catch {
        if (!cancelled) {
          setWalletError("Resolution failed");
          setWalletResolved(null);
        }
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [walletInput, recipientType, validateAndResolve]);

  const goToStep = useCallback((newStep: Step) => setStep(newStep), []);

  const canProceedFromRecipient = useMemo(() => {
    if (recipientType === "contact") {
      return !!(selectedContact?.walletAddress || emailResolved?.walletAddress);
    }
    return !!walletResolved?.address;
  }, [recipientType, selectedContact, emailResolved, walletResolved]);

  const handleContinueToAmount = useCallback(() => {
    if (!canProceedFromRecipient) return;
    let recipient: ResolvedRecipient;

    if (recipientType === "contact") {
      if (selectedContact?.walletAddress) {
        recipient = {
          type: "contact",
          email: selectedContact.email,
          name: selectedContact.name,
          profileImageUrl: selectedContact.profileImageUrl,
          inputValue: selectedContact.email || "",
          resolvedAddress: selectedContact.walletAddress,
        };
      } else if (emailResolved) {
        recipient = {
          type: "contact",
          email: emailInput.trim().toLowerCase(),
          name: emailResolved.name,
          profileImageUrl: emailResolved.profileImageUrl,
          inputValue: emailInput.trim().toLowerCase(),
          resolvedAddress: emailResolved.walletAddress,
        };
      } else return;
    } else {
      if (!walletResolved) return;
      recipient = {
        type: "wallet",
        inputValue: walletInput.trim(),
        resolvedAddress: walletResolved.address,
        isDomain: walletResolved.isDomain,
      };
    }

    setResolvedRecipient(recipient);
    goToStep("amount");
  }, [
    canProceedFromRecipient,
    recipientType,
    selectedContact,
    emailResolved,
    emailInput,
    walletResolved,
    walletInput,
    goToStep,
  ]);

  const handleContinueToConfirm = useCallback(() => {
    if (!resolvedRecipient || amountDisplay <= 0 || !hasEnoughBalance) return;
    goToStep("confirm");
  }, [resolvedRecipient, amountDisplay, hasEnoughBalance, goToStep]);

  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState(false);

  const handleSend = useCallback(async () => {
    if (!resolvedRecipient || amountUsdc <= 0 || sending) return;
    clearError();
    setTxSignature(null);
    setTxSuccess(false);
    try {
      const result = await send({
        fromOwnerBase58: walletAddress,
        toAddressOrDomain: resolvedRecipient.resolvedAddress,
        amountUi: amountUsdc,
      });
      setTxSignature(result.signature);
      setTxSuccess(true);
      setTimeout(() => {
        refreshBalances().catch(console.error);
      }, 1500);
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error("[Transfer] Send failed:", e);
    }
  }, [
    resolvedRecipient,
    amountUsdc,
    sending,
    walletAddress,
    send,
    clearError,
    refreshBalances,
    onSuccess,
  ]);

  const pressKey = useCallback((k: string) => {
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
  }, []);

  const handleSetMax = useCallback(() => {
    const maxDisplay = Math.max(0, laneBalanceDisplay - feeDisplay - 0.01);
    const safe = maxDisplay > 0 ? Math.floor(maxDisplay * 100) / 100 : 0;
    setAmountInput(safe > 0 ? String(safe) : "");
  }, [laneBalanceDisplay, feeDisplay]);

  // Reset on close
  useEffect(() => {
    if (open) return;
    setStep("recipient");
    setRecipientType("contact");
    setResolvedRecipient(null);
    setAmountInput("");
    setContacts([]);
    setContactSearch("");
    setSelectedContact(null);
    setEmailInput("");
    setEmailResolved(null);
    setEmailError(null);
    setWalletInput("");
    setWalletResolved(null);
    setWalletError(null);
    setTxSignature(null);
    setTxSuccess(false);
    setAddContactError(null);
    setAddContactSuccess(false);
    clearError();
  }, [open, clearError]);

  // Lock scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;
  const canClose = !sending;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (canClose && e.target === e.currentTarget) onOpenChange(false);
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
              {step !== "recipient" && !txSuccess && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === "amount") goToStep("recipient");
                    else if (step === "confirm") goToStep("amount");
                  }}
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
                    {step === "recipient" && "Choose who to send to"}
                    {step === "amount" && "Enter amount to send"}
                    {step === "confirm" && "Review and confirm"}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => canClose && onOpenChange(false)}
              disabled={!canClose}
              className="haven-icon-btn !w-9 !h-9"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {!txSuccess && (
            <div className="flex gap-1.5 mt-4">
              {["recipient", "amount", "confirm"].map((s) => (
                <div
                  key={s}
                  className={[
                    "h-1 flex-1 rounded-full transition-all duration-300",
                    step === s
                      ? "bg-primary"
                      : (s === "amount" && step === "confirm") ||
                          (s === "recipient" && step !== "recipient")
                        ? "bg-primary/40"
                        : "bg-border",
                  ].join(" ")}
                />
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* STEP: Recipient */}
          {step === "recipient" && (
            <div className="p-5 space-y-5">
              {/* Type Toggle */}
              <div className="flex p-1 bg-secondary rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setRecipientType("contact");
                    setSelectedContact(null);
                  }}
                  className={[
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all",
                    recipientType === "contact"
                      ? "bg-card text-foreground shadow-fintech-sm"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <Users className="w-4 h-4" />
                  Contact
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecipientType("wallet");
                    setWalletInput("");
                  }}
                  className={[
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all",
                    recipientType === "wallet"
                      ? "bg-card text-foreground shadow-fintech-sm"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <Wallet className="w-4 h-4" />
                  Wallet
                </button>
              </div>

              {/* Contact Mode */}
              {recipientType === "contact" && (
                <div className="space-y-4">
                  <div className="haven-card-soft px-4 py-4">
                    <label className="block text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                      Send to email
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
                      <input
                        ref={inputRef}
                        type="email"
                        value={emailInput}
                        onChange={(e) => {
                          setEmailInput(e.target.value);
                          setSelectedContact(null);
                          setAddContactSuccess(false);
                        }}
                        placeholder="friend@example.com"
                        className={[
                          "haven-input pl-10 text-black",
                          emailError
                            ? "border-destructive/50"
                            : emailResolved
                              ? "border-primary/50"
                              : "",
                        ].join(" ")}
                      />
                      {emailResolving && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                        </div>
                      )}
                      {emailResolved && !emailResolving && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[10px] text-muted-foreground flex-1">
                        {emailResolving && "Looking up recipient…"}
                        {emailResolved &&
                          `Sending to ${emailResolved.name || emailInput}`}
                        {emailError && (
                          <span className="text-destructive">{emailError}</span>
                        )}
                        {!emailResolving &&
                          !emailResolved &&
                          !emailError &&
                          "Enter a Haven user’s email"}
                      </span>
                      <button
                        type="button"
                        onClick={handleAddContact}
                        disabled={addingContact || !isEmail(emailInput)}
                        className="haven-pill hover:bg-accent disabled:opacity-40 gap-1"
                      >
                        {addingContact ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : addContactSuccess ? (
                          <Check className="w-3 h-3 text-primary" />
                        ) : (
                          <Plus className="w-3 h-3" />
                        )}
                        {addContactSuccess ? "Saved" : "Save"}
                      </button>
                    </div>
                    {addContactError && (
                      <p className="mt-1 text-[10px] text-destructive">
                        {addContactError}
                      </p>
                    )}
                    {emailResolved && (
                      <div className="mt-3 p-3 bg-primary/10 border border-primary/20 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold">
                            {getInitials(emailResolved.name || emailInput)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-foreground truncate">
                              {emailResolved.name || emailInput}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              Haven User •{" "}
                              {truncateAddress(emailResolved.walletAddress, 6)}
                            </p>
                          </div>
                          <Shield className="w-4 h-4 text-primary/60 flex-shrink-0" />
                        </div>
                      </div>
                    )}
                  </div>

                  {contacts.length > 0 && (
                    <div className="haven-card-soft px-4 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                          Your contacts
                        </label>
                        {contacts.length > 4 && (
                          <div className="relative flex-1 max-w-[140px] ml-3">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                            <input
                              type="text"
                              value={contactSearch}
                              onChange={(e) => setContactSearch(e.target.value)}
                              placeholder="Search..."
                              className="w-full pl-7 pr-2 py-1.5 bg-background rounded-lg text-[11px] text-black dark:text-foreground placeholder:text-muted-foreground border border-border focus:border-primary/40 outline-none"
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                        {contactsLoading ? (
                          <div className="py-6 text-center">
                            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin mx-auto" />
                          </div>
                        ) : filteredContacts.length === 0 ? (
                          <div className="py-6 text-center text-[12px] text-muted-foreground">
                            {contactSearch
                              ? "No contacts found"
                              : "No contacts yet"}
                          </div>
                        ) : (
                          filteredContacts.map((contact, idx) => {
                            const isSelected =
                              selectedContact?.id === contact.id ||
                              (selectedContact?.email === contact.email &&
                                contact.email);
                            const hasWallet = !!contact.walletAddress;

                            return (
                              <button
                                key={contact.id || contact.email || idx}
                                type="button"
                                onClick={() => {
                                  if (!hasWallet) return;
                                  setSelectedContact(contact);
                                  setEmailInput(contact.email || "");
                                  setEmailResolved(null);
                                  setEmailError(null);
                                }}
                                disabled={!hasWallet}
                                className={[
                                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all",
                                  isSelected
                                    ? "bg-primary/10 border border-primary/30"
                                    : hasWallet
                                      ? "bg-background hover:bg-accent border border-transparent"
                                      : "bg-background border border-transparent opacity-50 cursor-not-allowed",
                                ].join(" ")}
                              >
                                <div
                                  className={[
                                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 overflow-hidden",
                                    isSelected
                                      ? "bg-primary/20 text-primary"
                                      : "bg-secondary text-muted-foreground",
                                  ].join(" ")}
                                >
                                  {contact.profileImageUrl ? (
                                    <Image
                                      src={contact.profileImageUrl}
                                      alt={`${contact.name || contact.email || "Contact"} avatar`}
                                      width={40}
                                      height={40}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    getInitials(contact.name || contact.email)
                                  )}
                                </div>

                                <div className="flex-1 min-w-0 text-left">
                                  <p className="text-[13px] font-medium text-foreground truncate">
                                    {contact.name || contact.email}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground truncate">
                                    {contact.name && contact.email
                                      ? contact.email
                                      : hasWallet
                                        ? truncateAddress(
                                            contact.walletAddress!,
                                            6,
                                          )
                                        : "No wallet yet"}
                                  </p>
                                </div>

                                {isSelected && (
                                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                    <Check className="w-3 h-3 text-primary-foreground" />
                                  </div>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Wallet Mode */}
              {recipientType === "wallet" && (
                <div className="space-y-4">
                  <div className="haven-card-soft px-4 py-4">
                    <label className="block text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                      Wallet address or .sol domain
                    </label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
                      <input
                        type="text"
                        value={walletInput}
                        onChange={(e) => setWalletInput(e.target.value)}
                        placeholder="Address or name.sol"
                        className={[
                          "haven-input pl-10 font-mono text-[13px] text-black dark:text-foreground",
                          walletError
                            ? "border-destructive/50"
                            : walletResolved
                              ? "border-primary/50"
                              : "",
                        ].join(" ")}
                      />
                      {walletResolving && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                        </div>
                      )}
                      {walletResolved && !walletResolving && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        </div>
                      )}
                    </div>
                    {walletError && (
                      <p className="mt-2 text-[11px] text-destructive">
                        {walletError}
                      </p>
                    )}
                  </div>

                  {walletResolved && (
                    <div className="haven-card-soft px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                          <Wallet className="w-5 h-5 text-accent-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {walletResolved.isDomain && (
                            <p className="text-[13px] font-medium text-foreground mb-0.5">
                              {walletInput}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground font-mono break-all">
                            {walletResolved.address}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="flex items-center gap-2 text-[11px] text-destructive/80">
                          <Shield className="w-3.5 h-3.5" />
                          <span>
                            External wallet — verify address carefully
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="haven-card-soft px-4 py-3 border-primary/20 bg-primary/5">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      <strong className="text-foreground">Tip:</strong> You can
                      send to any Solana wallet address or .sol domain. The
                      recipient doesn&apos;t need a Haven account.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP: Amount */}
          {step === "amount" && resolvedRecipient && (
            <div className="p-5">
              <div className="haven-card-soft px-4 py-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-semibold text-muted-foreground flex-shrink-0 overflow-hidden">
                    {resolvedRecipient.type === "contact" ? (
                      resolvedRecipient.profileImageUrl ? (
                        <Image
                          src={resolvedRecipient.profileImageUrl}
                          alt={`${resolvedRecipient.name || resolvedRecipient.email || "Recipient"} avatar`}
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        getInitials(
                          resolvedRecipient.name || resolvedRecipient.email,
                        )
                      )
                    ) : (
                      <Wallet className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {resolvedRecipient.type === "contact"
                        ? resolvedRecipient.name || resolvedRecipient.email
                        : resolvedRecipient.isDomain
                          ? resolvedRecipient.inputValue
                          : truncateAddress(
                              resolvedRecipient.resolvedAddress,
                              6,
                            )}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {resolvedRecipient.type === "contact"
                        ? "Haven User"
                        : resolvedRecipient.isDomain
                          ? truncateAddress(
                              resolvedRecipient.resolvedAddress,
                              6,
                            )
                          : "External Wallet"}
                    </p>
                  </div>
                </div>
              </div>

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
                      Available: {formatCurrency(laneBalanceDisplay, currency)}
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
                      {formatCurrency(totalDebitedDisplay, currency)} total
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
                      k === "DEL" ? "text-muted-foreground" : "text-foreground",
                    ].join(" ")}
                  >
                    {k === "DEL" ? "⌫" : k}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP: Confirm */}
          {step === "confirm" && resolvedRecipient && !txSuccess && (
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
                <div className="p-4 border-b border-border">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    To
                  </p>

                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold text-primary flex-shrink-0 overflow-hidden">
                      {resolvedRecipient.type === "contact" ? (
                        resolvedRecipient.profileImageUrl ? (
                          <Image
                            src={resolvedRecipient.profileImageUrl}
                            alt={`${resolvedRecipient.name || resolvedRecipient.email || "Recipient"} avatar`}
                            width={44}
                            height={44}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          getInitials(
                            resolvedRecipient.name || resolvedRecipient.email,
                          )
                        )
                      ) : (
                        <Wallet className="w-5 h-5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-foreground">
                        {resolvedRecipient.type === "contact"
                          ? resolvedRecipient.name || resolvedRecipient.email
                          : resolvedRecipient.isDomain
                            ? resolvedRecipient.inputValue
                            : "External Wallet"}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        {truncateAddress(resolvedRecipient.resolvedAddress, 8)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-3">
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
                      Network fee
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="haven-pill haven-pill-positive !py-0.5 !px-1.5 !text-[10px]">
                        FREE
                      </span>
                      <span className="text-[12px] text-muted-foreground line-through">
                        ~$0.01
                      </span>
                    </div>
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
                  <p className="text-[12px] text-destructive">{sendError}</p>
                </div>
              )}
            </div>
          )}

          {/* SUCCESS */}
          {txSuccess && resolvedRecipient && (
            <div className="p-5">
              <div className="text-center py-8">
                <div className="relative inline-flex mb-6">
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center glow-mint">
                      <Check
                        className="w-8 h-8 text-primary-foreground"
                        strokeWidth={3}
                      />
                    </div>
                  </div>
                  <Sparkles className="absolute -top-1 -right-1 w-6 h-6 text-primary animate-pulse" />
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
                      : truncateAddress(resolvedRecipient.resolvedAddress, 4)}
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
          {step === "recipient" && (
            <button
              type="button"
              onClick={handleContinueToAmount}
              disabled={!canProceedFromRecipient}
              className={[
                "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                canProceedFromRecipient
                  ? "haven-btn-primary"
                  : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
              ].join(" ")}
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {step === "amount" && (
            <button
              type="button"
              onClick={handleContinueToConfirm}
              disabled={amountDisplay <= 0 || !hasEnoughBalance}
              className={[
                "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                amountDisplay > 0 && hasEnoughBalance
                  ? "haven-btn-primary"
                  : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
              ].join(" ")}
            >
              Review Transfer
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {step === "confirm" && !txSuccess && (
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
              onClick={() => onOpenChange(false)}
              className="haven-btn-secondary w-full"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
