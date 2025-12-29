// components/invest/TransferSPL.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { useBalance } from "@/providers/BalanceProvider";
import { useSponsoredCryptoTransfer } from "@/hooks/useSponsoredCryptoTransfer";
import { PublicKey } from "@solana/web3.js";

type TransferSPLProps = {
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
  return `${n.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  })} ${symbol}`;
};

const TransferSPL: React.FC<TransferSPLProps> = ({
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
      if (isUsdcMint || isUsdcSymbol) continue; // skip USDC here

      list.push({
        id: t.mint,
        mint: t.mint, // SPL only (includes wSOL)
        symbol: t.symbol || t.name || t.mint.slice(0, 4),
        name: t.name || t.symbol || "Unknown token",
        decimals: t.decimals,
        amountUi: t.amount,
        logoURI: t.logoURI ?? null,
        usdValue: t.usdValue ?? 0,
      });
    }

    // Sort by portfolio weight (USD value, desc)
    list.sort((a, b) => b.usdValue - a.usdValue);

    return list;
  }, [tokens]);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  // ensure we have a valid selected asset (optionally seed from initialMint)
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
  }, []);

  const handlePickContact = (c: Contact) => {
    if (c.email) {
      setRecipientInput(c.email);
    } else if (c.walletAddress) {
      setRecipientInput(c.walletAddress);
    }
  };

  /* ───────────────── Recipient state ───────────────── */

  const [recipientInput, setRecipientInput] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedRecipient, setResolvedRecipient] =
    useState<ResolvedRecipient | null>(null);

  useEffect(() => {
    // whenever the recipient input changes, we logically reset to step 1
    setStep(1);
    setResolvedRecipient(null);
    setResolveError(null);
    setResolveState("idle");

    const raw = recipientInput.trim();
    if (!raw) return;

    const lower = raw.toLowerCase();

    // 1) Email → resolve through contacts API (Haven recipient)
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

    // 2) Raw Solana address → treat as external wallet
    if (isValidSolanaAddress(raw)) {
      setResolvedRecipient({
        walletAddress: raw,
        status: "external",
      });
      setResolveState("resolved");
      return;
    }

    // Otherwise: invalid → stay idle (with hint text)
  }, [recipientInput]);

  /* ───────────────── Quick add contact (email only) ──────────── */

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
      console.error("[TransferSPL] add contact failed:", e);
      setAddError(
        e instanceof Error ? e.message : "Could not save contact right now."
      );
    } finally {
      setAddingContact(false);
    }
  };

  /* ───────────────── Amount + fees ───────────────── */

  const [amountInput, setAmountInput] = useState(""); // token units, e.g. "1.23"

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

  // keypad like USDC transfer
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
      if (dec && selectedAsset && dec.length > selectedAsset.decimals) {
        return prev;
      }
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
    if (sendDisabled || !resolvedRecipient?.walletAddress || !selectedAsset) {
      return;
    }
    setSuccessMsg(null);

    try {
      if (!selectedAsset.mint) {
        throw new Error("Missing token mint for SPL transfer");
      }

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
          ? `${selectedAsset.symbol} transfer sent. Tx: ${shortSig}`
          : `${selectedAsset.symbol} transfer sent successfully.`
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
      // errors shown below
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

  const [showAssetList, setShowAssetList] = useState(false);

  /* ───────────────── Render ───────────────── */

  const symbol = selectedAsset?.symbol ?? "TOKEN";

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
              Transfer tokens
            </DrawerTitle>
            <DrawerDescription className="text-[10px] text-zinc-400">
              Send SPL tokens (including wrapped SOL) from your Haven wallet to
              a contact or wallet address.
            </DrawerDescription>
          </div>
          <div className="text-[10px] px-2 py-1 rounded-full bg-black/40 border border-white/10 text-white/60">
            Step {step} of 2
          </div>
        </div>
      </DrawerHeader>

      {/* Scrollable body */}
      <div className="px-4 pb-4 flex-1 overflow-y-auto space-y-5">
        {/* STEP 1: Recipient + asset choice */}
        {step === 1 && (
          <div className="rounded-3xl bg-black/60 border border-white/10 px-4 py-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-white/80">
                  Who are you sending to?
                </p>
                <p className="text-[11px] text-white/50">
                  Enter a Haven email or Solana wallet address.
                </p>
              </div>
            </div>

            {/* Recipient input */}
            <div className="space-y-1 mt-1">
              <label className="text-[11px] font-medium text-zinc-300">
                Recipient
              </label>
              <input
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                placeholder="friend@example.com or 8x2Z… wallet address"
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
                    (resolvedRecipient.email
                      ? `Sending to ${
                          resolvedRecipient.name || resolvedRecipient.email
                        }`
                      : "Sending to external wallet")}
                  {resolveState === "not_found" &&
                    "No Haven account found for this email yet."}
                  {resolveState === "idle" &&
                    "We’ll verify Haven accounts automatically when you use an email."}
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

            {/* Contacts list */}
            <div className="space-y-1 mt-3">
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
                    {visibleContacts.map((c, idx) => (
                      <button
                        key={c.id ?? c.email ?? c.walletAddress ?? idx}
                        type="button"
                        onClick={() => handlePickContact(c)}
                        className="
                          rounded-full border border-white/10 bg-white/5
                          px-2.5 py-1 text-[10px] text-white/80
                          hover:bg-white/10 transition
                        "
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

            {/* Asset selector */}
            <div className="mt-4 space-y-1">
              <p className="text-[11px] font-medium text-zinc-300">
                Asset you&apos;ll send
              </p>
              {assets.length === 0 ? (
                <p className="text-[10px] text-zinc-500">
                  No non-USDC tokens detected in your wallet yet.
                </p>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAssetList((v) => !v)}
                    className="
                      flex w-full items-center justify-between
                      rounded-xl border border-white/10 bg-white/5
                      px-3 py-2 text-sm
                    "
                  >
                    <span className="flex flex-col text-left">
                      <span className="text-xs font-semibold">
                        {selectedAsset?.symbol}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        {selectedAsset?.name}
                      </span>
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      Available:{" "}
                      {selectedAsset
                        ? formatTokenAmount(
                            selectedAsset.amountUi,
                            selectedAsset.symbol
                          )
                        : "—"}
                    </span>
                  </button>

                  {showAssetList && (
                    <div className="absolute z-30 mt-2 w-full max-h-60 overflow-y-auto rounded-2xl border border-white/10 bg-black/95 p-1 text-[11px] shadow-xl">
                      {assets.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setSelectedAssetId(a.id);
                            setShowAssetList(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left hover:bg-white/5 ${
                            a.id === selectedAssetId ? "bg-white/10" : ""
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{a.symbol}</span>
                            <span className="text-[10px] text-zinc-500">
                              {a.name}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            {formatTokenAmount(a.amountUi, a.symbol)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: Amount */}
        {step === 2 && selectedAsset && (
          <div className="rounded-3xl bg-black/60 border border-white/10 overflow-hidden">
            {/* Recipient summary */}
            <div className="px-5 pt-4 pb-2 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-zinc-400">Sending to</p>
                <p className="text-xs text-white/90 font-medium">
                  {resolvedRecipient?.name ||
                    resolvedRecipient?.email ||
                    (resolvedRecipient?.walletAddress
                      ? `${resolvedRecipient.walletAddress.slice(
                          0,
                          4
                        )}…${resolvedRecipient.walletAddress.slice(-4)}`
                      : "Recipient")}
                </p>
                <p className="text-[10px] text-zinc-500">
                  {resolvedRecipient?.email
                    ? `Haven recipient • ${resolvedRecipient.email}`
                    : "External Solana wallet"}
                </p>
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

            {/* Asset summary */}
            <div className="px-5 pt-3 pb-1 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-zinc-400">Asset</p>
                <p className="text-xs font-medium text-white">
                  {selectedAsset.symbol}
                </p>
                <p className="text-[10px] text-zinc-500">
                  {selectedAsset.name}
                </p>
              </div>
              <div className="text-[10px] text-zinc-500 text-right">
                Available:{" "}
                <span className="text-white/80">
                  {formatTokenAmount(
                    selectedAsset.amountUi,
                    selectedAsset.symbol
                  )}
                </span>
              </div>
            </div>

            {/* Amount display */}
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
                <p className="mt-2 text-[11px] text-zinc-500">
                  Amount in {symbol}
                </p>
              </div>
            </div>

            {/* Available + Max */}
            <div className="px-6 pb-3 flex items-center justify-between text-[11px]">
              <div className="text-white/60">
                Available:{" "}
                <span className="text-white/80">
                  {formatTokenAmount(
                    selectedAsset.amountUi,
                    selectedAsset.symbol
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const max = Math.max(
                    0,
                    (selectedAsset.amountUi || 0) / (1 + (effectiveFeePct || 0))
                  );
                  const safe =
                    max > 0
                      ? Math.floor(max * 10 ** selectedAsset.decimals) /
                        10 ** selectedAsset.decimals
                      : 0;
                  setAmountInput(safe > 0 ? safe.toString() : "");
                }}
                className="text-white/80 hover:text-white underline underline-offset-2 disabled:opacity-40"
                disabled={!selectedAsset.amountUi}
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
                    {formatTokenAmount(amountUi || 0, symbol)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-white/60">
                    You pay (incl.{" "}
                    {feePctDisplay ? `${feePctDisplay.toFixed(2)}%` : "fee"})
                  </span>
                  <span className="font-semibold text-white">
                    {formatTokenAmount(amountUi > 0 ? totalDebited : 0, symbol)}
                  </span>
                </div>
              </div>

              {amountUi > 0 && !hasEnoughBalance && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                  Not enough {symbol} to cover amount + fee.
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
      <DrawerFooter className="flex justify-end px-4 pb-4 pt-0 shrink-0 gap-2">
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
            {sending ? `Sending ${symbol}…` : `Send ${symbol}`}
          </button>
        )}
      </DrawerFooter>
    </DrawerContent>
  );
};

export default TransferSPL;
