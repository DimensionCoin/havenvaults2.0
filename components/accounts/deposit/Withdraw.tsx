// components/accounts/deposit/Withdraw.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Shield,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useSponsoredExternalTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalance } from "@/providers/BalanceProvider";

type WithdrawProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
  balanceUsd: number;
  onSuccess?: () => void | Promise<void>;
};

type WithdrawTab = "crypto" | "offramp";
type Step = "destination" | "amount" | "confirm";

type ResolvedDestination = {
  inputValue: string;
  resolvedAddress: string;
  isDomain: boolean;
  domain?: string;
};

const isSolDomain = (s: string) => /^[a-zA-Z0-9_-]+\.sol$/i.test(s.trim());
const isValidAddress = (s: string) => {
  try {
    const t = s.trim();
    return (
      t.length >= 32 && t.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(t)
    );
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

export default function Withdraw({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}: WithdrawProps) {
  const { refresh: refreshBalances, displayCurrency, fxRate } = useBalance();

  const currency =
    displayCurrency === "USDC" || !displayCurrency
      ? "USD"
      : displayCurrency.toUpperCase();
  const effectiveFx = fxRate > 0 ? fxRate : 1;
  const laneBalanceDisplay = balanceUsd || 0;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tab, setTab] = useState<WithdrawTab>("crypto");
  const [step, setStep] = useState<Step>("destination");
  const [resolvedDestination, setResolvedDestination] =
    useState<ResolvedDestination | null>(null);
  const [amountInput, setAmountInput] = useState("");

  const [addressInput, setAddressInput] = useState("");
  const [addressResolved, setAddressResolved] = useState<{
    address: string;
    isDomain: boolean;
    domain?: string;
  } | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);

  const {
    send,
    validateAndResolve,
    loading: sending,
    resolving: addressResolving,
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

  // Address resolution
  useEffect(() => {
    if (!addressInput.trim()) {
      setAddressResolved(null);
      setAddressError(null);
      return;
    }
    const input = addressInput.trim();
    if (isValidAddress(input)) {
      setAddressResolved({ address: input, isDomain: false });
      setAddressError(null);
      return;
    }
    if (!isSolDomain(input)) {
      setAddressResolved(null);
      setAddressError(input.length > 5 ? "Invalid address or domain" : null);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const result = await validateAndResolve(input);
        if (cancelled) return;
        if (result) {
          setAddressResolved({
            address: result.address,
            isDomain: result.isDomain,
            domain: result.domain,
          });
          setAddressError(null);
        } else {
          setAddressError("Could not resolve this domain");
          setAddressResolved(null);
        }
      } catch {
        if (!cancelled) {
          setAddressError("Resolution failed");
          setAddressResolved(null);
        }
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [addressInput, validateAndResolve]);

  const goToStep = useCallback((newStep: Step) => setStep(newStep), []);
  const canProceedFromDestination = !!addressResolved?.address;

  const handleContinueToAmount = useCallback(() => {
    if (!canProceedFromDestination || !addressResolved) return;
    setResolvedDestination({
      inputValue: addressInput.trim(),
      resolvedAddress: addressResolved.address,
      isDomain: addressResolved.isDomain,
      domain: addressResolved.domain,
    });
    goToStep("amount");
  }, [canProceedFromDestination, addressResolved, addressInput, goToStep]);

  const handleContinueToConfirm = useCallback(() => {
    if (!resolvedDestination || amountDisplay <= 0 || !hasEnoughBalance) return;
    goToStep("confirm");
  }, [resolvedDestination, amountDisplay, hasEnoughBalance, goToStep]);

  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState(false);

  const handleSend = useCallback(async () => {
    if (!resolvedDestination || amountUsdc <= 0 || sending) return;
    clearError();
    setTxSignature(null);
    setTxSuccess(false);
    try {
      const result = await send({
        fromOwnerBase58: walletAddress,
        toAddressOrDomain: resolvedDestination.resolvedAddress,
        amountUi: amountUsdc,
      });
      setTxSignature(result.signature);
      setTxSuccess(true);
      setTimeout(() => {
        refreshBalances().catch(console.error);
      }, 1500);
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error("[Withdraw] Send failed:", e);
    }
  }, [
    resolvedDestination,
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
    setTab("crypto");
    setStep("destination");
    setResolvedDestination(null);
    setAmountInput("");
    setAddressInput("");
    setAddressResolved(null);
    setAddressError(null);
    setTxSignature(null);
    setTxSuccess(false);
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
              {step !== "destination" && !txSuccess && tab === "crypto" && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === "amount") goToStep("destination");
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
                  {txSuccess ? "Withdrawal Sent" : "Withdraw USDC"}
                </h2>
                {!txSuccess && tab === "crypto" && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {step === "destination" && "Enter destination wallet"}
                    {step === "amount" && "Enter withdrawal amount"}
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

          {/* Tab Switcher */}
          {!txSuccess && step === "destination" && (
            <div className="flex p-1 bg-secondary rounded-2xl mt-4">
              <button
                type="button"
                onClick={() => setTab("crypto")}
                className={[
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all",
                  tab === "crypto"
                    ? "bg-card text-foreground shadow-fintech-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Wallet className="w-4 h-4" />
                Crypto
              </button>
              <button
                type="button"
                onClick={() => setTab("offramp")}
                className={[
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all",
                  tab === "offramp"
                    ? "bg-card text-foreground shadow-fintech-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Banknote className="w-4 h-4" />
                Off-ramp
              </button>
            </div>
          )}

          {/* Progress indicator */}
          {!txSuccess && tab === "crypto" && (
            <div className="flex gap-1.5 mt-4">
              {["destination", "amount", "confirm"].map((s) => (
                <div
                  key={s}
                  className={[
                    "h-1 flex-1 rounded-full transition-all duration-300",
                    step === s
                      ? "bg-primary"
                      : (s === "amount" && step === "confirm") ||
                          (s === "destination" && step !== "destination")
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
          {/* OFF-RAMP TAB */}
          {tab === "offramp" && (
            <div className="p-5">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                  <Banknote className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-[15px] font-semibold text-foreground mb-2">
                  Off-ramp Coming Soon
                </h3>
                <p className="text-[13px] text-muted-foreground max-w-[280px] leading-relaxed">
                  You&apos;ll be able to withdraw directly to your bank account.
                  We&apos;re working hard to bring this feature to you.
                </p>
                <div className="mt-6 haven-pill haven-pill-positive">
                  <span className="text-[12px] font-medium">
                    Expected Q2 2025
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* CRYPTO TAB - Destination */}
          {tab === "crypto" && step === "destination" && (
            <div className="p-5 space-y-5">
              <div className="haven-card-soft px-4 py-4">
                <label className="block text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Destination wallet or .sol domain
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={addressInput}
                    onChange={(e) => setAddressInput(e.target.value)}
                    placeholder="Address or name.sol"
                    className={[
                      "haven-input pl-10 font-mono text-[13px] text-black dark:text-foreground",
                      addressError
                        ? "border-destructive/50"
                        : addressResolved
                          ? "border-primary/50"
                          : "",
                    ].join(" ")}
                  />
                  {addressResolving && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                    </div>
                  )}
                  {addressResolved && !addressResolving && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-3 h-3 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                </div>
                {addressError && (
                  <p className="mt-2 text-[11px] text-destructive">
                    {addressError}
                  </p>
                )}
              </div>

              {addressResolved && (
                <div className="haven-card-soft px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                      <ArrowUpRight className="w-5 h-5 text-accent-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {addressResolved.isDomain && (
                        <p className="text-[13px] font-medium text-foreground mb-0.5">
                          {addressInput}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground font-mono break-all">
                        {addressResolved.address}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-2 text-[11px] text-destructive/80">
                      <Shield className="w-3.5 h-3.5" />
                      <span>External wallet — verify address carefully</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="haven-card-soft px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Available to withdraw
                  </span>
                  <span className="text-[13px] text-foreground font-medium">
                    {formatCurrency(laneBalanceDisplay, currency)}
                  </span>
                </div>
              </div>

              <div className="haven-card-soft px-4 py-3 border-primary/20 bg-primary/5">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">
                    Network fees covered:
                  </strong>{" "}
                  Haven sponsors the Solana network fee. You only pay a small
                  processing fee in USDC.
                </p>
              </div>
            </div>
          )}

          {/* CRYPTO TAB - Amount */}
          {tab === "crypto" && step === "amount" && resolvedDestination && (
            <div className="p-5">
              <div className="haven-card-soft px-4 py-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <ArrowUpRight className="w-5 h-5 text-accent-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">
                      {resolvedDestination.isDomain
                        ? resolvedDestination.inputValue
                        : truncateAddress(
                            resolvedDestination.resolvedAddress,
                            6,
                          )}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {resolvedDestination.isDomain
                        ? truncateAddress(
                            resolvedDestination.resolvedAddress,
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

          {/* CRYPTO TAB - Confirm */}
          {tab === "crypto" &&
            step === "confirm" &&
            resolvedDestination &&
            !txSuccess && (
              <div className="p-5">
                <div className="text-center py-6">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
                    You&apos;re withdrawing
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
                      <div className="w-11 h-11 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                        <ArrowUpRight className="w-5 h-5 text-accent-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground">
                          {resolvedDestination.isDomain
                            ? resolvedDestination.inputValue
                            : "External Wallet"}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">
                          {truncateAddress(
                            resolvedDestination.resolvedAddress,
                            8,
                          )}
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
                        Processing fee
                      </span>
                      <span className="text-[13px] text-foreground font-medium">
                        {formatCurrency(feeDisplay, currency)}
                      </span>
                    </div>
                    <div className="pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-[13px] text-foreground font-medium">
                        Total debited
                      </span>
                      <span className="text-[15px] text-primary font-semibold">
                        {formatCurrency(totalDebitedDisplay, currency)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-destructive/5 border border-destructive/20 rounded-xl">
                  <div className="flex items-start gap-2">
                    <Shield className="w-4 h-4 text-destructive/80 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Please verify the destination address. Crypto transactions
                      cannot be reversed once confirmed.
                    </p>
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
          {txSuccess && resolvedDestination && (
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
                  Withdrawal Sent!
                </h3>
                <p className="text-[13px] text-muted-foreground">
                  {formatCurrency(amountDisplay, currency)} sent to{" "}
                  {resolvedDestination.isDomain
                    ? resolvedDestination.inputValue
                    : truncateAddress(resolvedDestination.resolvedAddress, 4)}
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
                    <a
                      href={`https://solscan.io/tx/${txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="haven-icon-btn !w-7 !h-7"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
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
          {tab === "offramp" && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="haven-btn-secondary w-full"
            >
              Close
            </button>
          )}
          {tab === "crypto" && step === "destination" && (
            <button
              type="button"
              onClick={handleContinueToAmount}
              disabled={!canProceedFromDestination}
              className={[
                "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                canProceedFromDestination
                  ? "haven-btn-primary"
                  : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
              ].join(" ")}
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {tab === "crypto" && step === "amount" && (
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
              Review Withdrawal
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {tab === "crypto" && step === "confirm" && !txSuccess && (
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
                  Confirm & Withdraw
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
