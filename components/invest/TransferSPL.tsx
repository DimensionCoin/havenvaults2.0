// components/invest/TransferSPL.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { PublicKey } from "@solana/web3.js";

import { useBalance } from "@/providers/BalanceProvider";
import { useSponsoredCryptoTransfer } from "@/hooks/useSponsoredCryptoTransfer";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type TransferSPLProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Sender’s Solana address (Haven wallet) */
  walletAddress: string;

  /** Optional: pre-select this token mint from the user’s holdings */
  initialMint?: string;

  onSuccess?: () => void | Promise<void>;
};

type Contact = {
  id?: string;
  name?: string;
  email?: string;
  walletAddress?: string;
  status: "invited" | "active" | "external";
};

type ResolveState = "idle" | "checking" | "resolved" | "not_found" | "error";

type ResolvedRecipient = {
  walletAddress: string;
  email?: string;
  name?: string;
  status?: string;
};

type WalletAsset = {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  amountUi: number;
  logoURI?: string | null;
  usdValue: number;
};

type PickerSide = "asset" | null;

const ENV_USDC_MINT = (process.env.NEXT_PUBLIC_USDC_MINT || "").toLowerCase();

const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s.trim().toLowerCase());

const isValidSolanaAddress = (s: string) => {
  const trimmed = s.trim();
  if (!trimmed) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
};

const formatTokenAmount = (n: number | null | undefined, symbol: string) => {
  if (n == null || !Number.isFinite(n)) return `— ${symbol}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`;
};

const sanitizeAmountInput = (s: string) => s.replace(/[^\d.]/g, "");

const TransferSPL: React.FC<TransferSPLProps> = ({
  open,
  onOpenChange,
  walletAddress,
  initialMint,
  onSuccess,
}) => {
  const { tokens, refresh: refreshBalances } = useBalance();

  /* ───────────────── Assets: all SPL except USDC ───────────────── */

  const assets: WalletAsset[] = useMemo(() => {
    const list: WalletAsset[] = [];

    for (const t of tokens) {
      const mintLower = t.mint.toLowerCase();
      const isUsdcMint = ENV_USDC_MINT && mintLower === ENV_USDC_MINT;
      const isUsdcSymbol = (t.symbol ?? "").toUpperCase() === "USDC";
      if (isUsdcMint || isUsdcSymbol) continue;

      list.push({
        id: t.mint,
        mint: t.mint,
        symbol: t.symbol || t.name || t.mint.slice(0, 4),
        name: t.name || t.symbol || "Unknown token",
        decimals: t.decimals,
        amountUi: t.amount,
        logoURI: t.logoURI ?? null,
        usdValue: t.usdValue ?? 0,
      });
    }

    list.sort((a, b) => b.usdValue - a.usdValue);
    return list;
  }, [tokens]);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (!assets.length) {
      setSelectedAssetId(null);
      return;
    }

    if (initialMint) {
      const match = assets.find((a) => a.mint === initialMint);
      if (match) {
        setSelectedAssetId(match.id);
        return;
      }
    }

    setSelectedAssetId((prev) => {
      if (prev && assets.some((a) => a.id === prev)) return prev;
      return assets[0].id;
    });
  }, [assets, initialMint]);

  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null;

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
          console.error("[TransferSPL] failed to load contacts:", e);
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

  const handlePickContact = (c: Contact) => {
    if (c.email) setRecipientInput(c.email);
    else if (c.walletAddress) setRecipientInput(c.walletAddress);
  };

  /* ───────────────── Recipient state ───────────────── */

  const [recipientInput, setRecipientInput] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedRecipient, setResolvedRecipient] =
    useState<ResolvedRecipient | null>(null);

  useEffect(() => {
    if (!open) return;

    // whenever recipient changes, reset step 1
    setStep(1);
    setResolvedRecipient(null);
    setResolveError(null);
    setResolveState("idle");

    const raw = recipientInput.trim();
    if (!raw) return;

    const lower = raw.toLowerCase();

    // 1) Email resolve
    if (isEmail(lower)) {
      let cancelled = false;
      const timeout = setTimeout(async () => {
        setResolveState("checking");
        try {
          const url = `/api/user/contacts/resolve?email=${encodeURIComponent(
            lower
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
            walletAddress: data.walletAddress,
            email: lower,
            name: data.name,
            status: data.status,
          });
          setResolveState("resolved");
        } catch (e) {
          if (!cancelled) {
            console.error("[TransferSPL] resolve failed:", e);
            setResolveState("error");
            setResolveError("Lookup failed. Try again.");
          }
        }
      }, 450);

      return () => {
        cancelled = true;
        clearTimeout(timeout);
      };
    }

    // 2) Solana address
    if (isValidSolanaAddress(raw)) {
      setResolvedRecipient({ walletAddress: raw, status: "external" });
      setResolveState("resolved");
      return;
    }
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
      console.error("[TransferSPL] add contact failed:", e);
      setAddError(
        e instanceof Error ? e.message : "Could not save contact right now."
      );
    } finally {
      setAddingContact(false);
    }
  };

  /* ───────────────── Amount + fees ───────────────── */

  const [amountInput, setAmountInput] = useState(""); // ui units

  const amountUi = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  const {
    send,
    loading: sending,
    error: sendError,
    feePct,
    feePctDisplay,
  } = useSponsoredCryptoTransfer();

  const effectiveFeePct = feePct ?? 0;
  const totalDebited = amountUi * (1 + effectiveFeePct);

  const hasEnoughBalance =
    selectedAsset &&
    amountUi > 0 &&
    totalDebited <= (selectedAsset.amountUi || 0) + 1e-9;

  // keypad like before
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
      if (dec && selectedAsset && dec.length > selectedAsset.decimals)
        return prev;
      if (!prev && k === "0") return "0";
      return next.length > 18 ? prev : next;
    });
  };

  /* ───────────────── Step gating ───────────────── */

  const canContinueToAmount =
    !!walletAddress &&
    resolveState === "resolved" &&
    !!resolvedRecipient?.walletAddress &&
    !!selectedAsset;

  const handleContinueToAmount = () => {
    if (!canContinueToAmount) return;
    setStep(2);
  };

  const sendDisabled =
    step !== 2 ||
    sending ||
    !walletAddress ||
    !canContinueToAmount ||
    !selectedAsset ||
    amountUi <= 0 ||
    !hasEnoughBalance;

  /* ───────────────── Submit transfer ───────────────── */

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    if (sendDisabled || !resolvedRecipient?.walletAddress || !selectedAsset)
      return;

    setSuccessMsg(null);

    try {
      const sig = await send({
        fromOwnerBase58: walletAddress,
        toOwnerBase58: resolvedRecipient.walletAddress,
        mint: selectedAsset.mint,
        decimals: selectedAsset.decimals,
        amountUi,
        symbol: selectedAsset.symbol,
      });

      const shortSig =
        sig && sig.length > 12 ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : sig;

      setSuccessMsg(
        sig
          ? `${selectedAsset.symbol} sent. Tx: ${shortSig}`
          : `${selectedAsset.symbol} sent successfully.`
      );

      try {
        await new Promise((r) => setTimeout(r, 1200));
        await refreshBalances();
      } catch (e) {
        console.error("[TransferSPL] balance refresh failed:", e);
      }

      setAmountInput("");
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error("[TransferSPL] send failed:", e);
    }
  }, [
    sendDisabled,
    resolvedRecipient,
    selectedAsset,
    walletAddress,
    amountUi,
    send,
    refreshBalances,
    onSuccess,
  ]);

  /* ───────────────── Contacts slice ───────────────── */

  const visibleContacts = useMemo(() => {
    if (showAllContacts) return contacts;
    return contacts.slice(0, 3);
  }, [contacts, showAllContacts]);

  const hasMoreContacts = contacts.length > 3;

  /* ───────────────── Asset picker (Sell-style) ───────────────── */

  const [pickerSide, setPickerSide] = useState<PickerSide>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  const currentPickerAssets = useMemo(() => {
    if (!pickerSearch.trim()) return assets;
    const q = pickerSearch.trim().toLowerCase();
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [assets, pickerSearch]);

  const openPicker = () => {
    setPickerSide("asset");
    setPickerSearch("");
  };

  const closePicker = () => {
    setPickerSide(null);
    setPickerSearch("");
  };

  const pickAsset = (a: WalletAsset) => {
    setSelectedAssetId(a.id);
    // reset amount when switching token (prevents accidental over-send)
    setAmountInput("");
    setStep(1);
    closePicker();
  };

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
    setPickerSide(null);
    setPickerSearch("");
    // keep selectedAssetId as-is so reopening feels faster
  }, [open]);

  const symbol = selectedAsset?.symbol ?? "TOKEN";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          // ✅ Production layout: flex column + real height constraint (scroll works on all screens)
          "p-0 overflow-hidden border border-border bg-background",
          "flex flex-col",

          // Desktop sizing
          "sm:w-[min(92vw,420px)] sm:max-w-[420px]",
          "sm:max-h-[90vh] sm:rounded-[28px]",
          "sm:shadow-[0_18px_60px_rgba(0,0,0,0.85)]",

          // Mobile fullscreen
          "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
          "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
          "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",
        ].join(" ")}
      >
        {/* ✅ min-h-0 is REQUIRED so the scroll area can actually scroll */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Scrollable body */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar overscroll-contain px-2 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] sm:px-4 sm:pb-4 sm:pt-4">
            <DialogHeader className="pb-3">
              <div className="flex items-start justify-between gap-2 pr-10">
                <div>
                  <DialogTitle className="text-sm font-semibold text-foreground">
                    Transfer tokens
                  </DialogTitle>
                  <DialogDescription className="text-[11px] text-muted-foreground">
                    Send SPL tokens from your Haven wallet to a contact or
                    wallet.
                  </DialogDescription>
                </div>

                <div className="shrink-0 rounded-full border border-border bg-background/60 px-2 py-1 text-[10px] text-muted-foreground">
                  Step {step} of 2
                </div>
              </div>
            </DialogHeader>

            {assets.length === 0 ? (
              <div className="rounded-2xl border border-border bg-background/60 px-3 py-3 text-[11px] text-muted-foreground">
                No non-USDC tokens detected in your wallet yet.
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-xs text-foreground">
                {/* STEP 1 */}
                {step === 1 && (
                  <div className="rounded-2xl bg-background/60 px-3.5 py-3.5">
                    {/* Recipient */}
                    <div className="mb-2 text-[11px]">
                      <p className="text-foreground font-medium">
                        Who are you sending to?
                      </p>
                      <p className="text-muted-foreground">
                        Enter a Haven email or Solana wallet address.
                      </p>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">
                        Recipient
                      </label>
                      <input
                        value={recipientInput}
                        onChange={(e) => setRecipientInput(e.target.value)}
                        placeholder="friend@example.com or 8x2Z…"
                        className={[
                          "w-full rounded-xl border bg-background/60 px-3 py-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground",
                          resolveState === "error" ||
                          resolveState === "not_found"
                            ? "border-destructive/30 focus:border-destructive focus:ring-1 focus:ring-destructive/30"
                            : "border-border focus:border-primary focus:ring-1 focus:ring-primary/30",
                        ].join(" ")}
                      />

                      <div className="mt-1 flex items-center justify-between gap-3 text-[10px]">
                        <span className="text-muted-foreground">
                          {resolveState === "checking" &&
                            "Looking up recipient…"}
                          {resolveState === "resolved" &&
                            resolvedRecipient &&
                            (resolvedRecipient.email
                              ? `Sending to ${
                                  resolvedRecipient.name ||
                                  resolvedRecipient.email
                                }`
                              : "Sending to external wallet")}
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
                          className="shrink-0 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {addingContact ? "Saving…" : "Save"}
                        </button>
                      </div>

                      {addError && (
                        <p className="text-[10px] text-destructive">
                          {addError}
                        </p>
                      )}
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
                                key={c.id ?? c.email ?? c.walletAddress ?? idx}
                                type="button"
                                onClick={() => handlePickContact(c)}
                                className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] text-foreground hover:bg-accent"
                              >
                                {c.name ||
                                  c.email ||
                                  (c.walletAddress
                                    ? `${c.walletAddress.slice(
                                        0,
                                        4
                                      )}…${c.walletAddress.slice(-4)}`
                                    : "Contact")}
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

                    {/* Asset */}
                    <div className="mt-4">
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        Asset you&apos;ll send
                      </p>

                      <button
                        type="button"
                        onClick={openPicker}
                        className="flex w-full items-center justify-between rounded-2xl bg-background/60 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <AssetAvatar
                            logo={selectedAsset?.logoURI ?? null}
                            symbol={selectedAsset?.symbol ?? "?"}
                            name={selectedAsset?.name ?? ""}
                          />
                          <div className="flex flex-col text-left">
                            <span className="text-[11px] font-semibold">
                              {selectedAsset?.symbol}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {selectedAsset?.name}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">
                            {selectedAsset
                              ? `Avail: ${formatTokenAmount(
                                  selectedAsset.amountUi,
                                  selectedAsset.symbol
                                )}`
                              : "—"}
                          </span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 2 */}
                {step === 2 && selectedAsset && (
                  <div className="rounded-2xl bg-background/60 overflow-hidden">
                    {/* Summary header */}
                    <div className="px-3.5 py-3 border-b border-border">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground">
                            Sending to
                          </p>
                          <p className="text-[11px] font-semibold text-foreground">
                            {resolvedRecipient?.name ||
                              resolvedRecipient?.email ||
                              (resolvedRecipient?.walletAddress
                                ? `${resolvedRecipient.walletAddress.slice(
                                    0,
                                    4
                                  )}…${resolvedRecipient.walletAddress.slice(
                                    -4
                                  )}`
                                : "Recipient")}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {resolvedRecipient?.email
                              ? "Haven recipient"
                              : "External Solana wallet"}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] text-foreground hover:bg-accent"
                        >
                          Change
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AssetAvatar
                            logo={selectedAsset.logoURI ?? null}
                            symbol={selectedAsset.symbol}
                            name={selectedAsset.name}
                          />
                          <div className="flex flex-col">
                            <span className="text-[11px] font-semibold text-foreground">
                              {selectedAsset.symbol}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {selectedAsset.name}
                            </span>
                          </div>
                        </div>

                        <div className="text-right text-[10px] text-muted-foreground">
                          Available:{" "}
                          <span className="text-foreground">
                            {formatTokenAmount(
                              selectedAsset.amountUi,
                              selectedAsset.symbol
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Amount area */}
                    <div className="px-3.5 py-3.5">
                      <div className="mb-2 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Amount</span>
                        <button
                          type="button"
                          onClick={() => {
                            const max = Math.max(
                              0,
                              (selectedAsset.amountUi || 0) /
                                (1 + (effectiveFeePct || 0))
                            );
                            const safe =
                              max > 0
                                ? Math.floor(
                                    max * 10 ** selectedAsset.decimals
                                  ) /
                                  10 ** selectedAsset.decimals
                                : 0;
                            setAmountInput(safe > 0 ? String(safe) : "");
                          }}
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15 disabled:opacity-40"
                          disabled={!selectedAsset.amountUi}
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
                          if (dec.length > selectedAsset.decimals) return;
                          setAmountInput(next);
                        }}
                        placeholder="0.00"
                        className="w-full bg-transparent text-left text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground"
                      />

                      <p className="mt-2 text-[10px] text-muted-foreground">
                        You pay (incl.{" "}
                        {feePctDisplay
                          ? `${feePctDisplay.toFixed(2)}% fee`
                          : "fee"}
                        ):{" "}
                        <span className="text-foreground">
                          {formatTokenAmount(
                            amountUi > 0 ? totalDebited : 0,
                            symbol
                          )}
                        </span>
                      </p>

                      <p className="mt-1 text-[10px] text-muted-foreground">
                        They receive:{" "}
                        <span className="text-foreground">
                          {formatTokenAmount(amountUi || 0, symbol)}
                        </span>
                      </p>

                      {amountUi > 0 && !hasEnoughBalance && (
                        <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                          Not enough {symbol} to cover amount + fee.
                        </div>
                      )}

                      {(sendError ||
                        (resolveState === "error" && resolveError)) && (
                        <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                          {sendError || resolveError}
                        </div>
                      )}

                      {successMsg && (
                        <div className="mt-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                          {successMsg}
                        </div>
                      )}

                      {/* keypad */}
                      <div className="mt-3">
                        <div className="grid grid-cols-3 gap-2">
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
                                "rounded-2xl border py-3 text-base font-semibold transition",
                                k === "DEL"
                                  ? "border-border bg-background/60 text-foreground hover:bg-accent"
                                  : "border-border bg-background/60 text-foreground hover:bg-accent",
                              ].join(" ")}
                            >
                              {k === "DEL" ? "⌫" : k}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => pressKey("CLR")}
                          className="mt-2 w-full rounded-xl border border-border bg-background/60 py-2 text-[11px] text-muted-foreground hover:bg-accent"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pinned footer */}
          <DialogFooter className="shrink-0 border-t border-border bg-background/95 px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+12px)] sm:px-4 sm:py-3 sm:pb-3">
            {step === 1 ? (
              <Button
                className="w-full rounded-full bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary/90"
                disabled={!canContinueToAmount}
                onClick={handleContinueToAmount}
              >
                Continue
              </Button>
            ) : (
              <Button
                className="w-full rounded-full bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary/90"
                disabled={sendDisabled}
                onClick={handleSend}
              >
                {sending ? `Sending ${symbol}…` : `Send ${symbol}`}
              </Button>
            )}
          </DialogFooter>
        </div>

        {/* Asset picker modal */}
        {pickerSide && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-background px-3.5 py-3.5 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Choose asset to send
                </h2>
                <button
                  type="button"
                  onClick={closePicker}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>

              <div className="mb-2">
                <input
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search by name or symbol"
                  className="w-full rounded-xl border border-border bg-background/60 px-3 py-1.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/30"
                />
              </div>

              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {currentPickerAssets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => pickAsset(a)}
                    className={[
                      "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] hover:bg-accent",
                      a.id === selectedAssetId ? "bg-accent" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      <AssetAvatar
                        logo={a.logoURI ?? null}
                        symbol={a.symbol}
                        name={a.name}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {a.symbol}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {a.name}
                        </span>
                      </div>
                    </div>

                    <span className="text-[10px] text-muted-foreground">
                      {a.amountUi.toLocaleString("en-US", {
                        maximumFractionDigits: 6,
                      })}
                    </span>
                  </button>
                ))}

                {currentPickerAssets.length === 0 && (
                  <p className="pt-4 text-center text-[11px] text-muted-foreground">
                    No assets found.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* -------------------- avatar -------------------- */

const AssetAvatar: React.FC<{
  logo: string | null;
  symbol: string;
  name: string;
}> = ({ logo, symbol, name }) => {
  if (logo) {
    return (
      <div className="relative h-7 w-7 overflow-hidden rounded-full border border-border bg-background/60">
        <Image
          src={logo}
          alt={name}
          fill
          sizes="28px"
          className="object-cover"
        />
      </div>
    );
  }
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/60 text-[10px] font-semibold text-foreground">
      {symbol.slice(0, 3).toUpperCase()}
    </div>
  );
};

export default TransferSPL;
