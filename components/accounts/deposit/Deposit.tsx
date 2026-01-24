"use client";

// components/accounts/deposit/Deposit.tsx
import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Shield,
  ShieldCheck,
  Wallet,
  X,
  Globe,
} from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

type DepositProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
  balanceUsd: number;
  onSuccess?: () => void | Promise<void>;
};

type DepositTab = "bank" | "crypto";
type BankStep = "amount" | "confirm";
type FlowType = "guest" | "coinbase_login";
type PostCheckoutState = "checking" | "success" | "no_change" | null;

type FeeInfo = {
  coinbaseFee?: { currency: string; value: string };
  networkFee?: { currency: string; value: string };
  paymentTotal?: { currency: string; value: string };
  purchaseAmount?: { currency: string; value: string };
};

type OnrampSessionResponse = {
  onrampUrl?: string;
  url?: string;
  one_click_buy_url?: string;
  redirectUrl?: string;
  error?: string;
  code?: string;
  flowType?: FlowType;
  country?: string;
  method?: "quote" | "session";
  quoteId?: string;
  fees?: FeeInfo;
};

type OnrampSessionRequest = {
  destinationAddress: string;
  purchaseCurrency: "USDC";
  destinationNetwork: "solana";
  paymentCurrency: string;
  sandbox: boolean;
  paymentAmount?: string;
  country?: string;
};

const SUPPORTED_FIAT_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "SGD",
  "BRL",
  "MXN",
] as const;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "C$",
  AUD: "A$",
  JPY: "¥",
  CHF: "CHF",
  SGD: "S$",
  BRL: "R$",
  MXN: "MX$",
};

// Countries that support Guest Checkout (US only)
const GUEST_CHECKOUT_COUNTRIES = new Set(["US"]);

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
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

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

type WindowWithDualScreen = Window & {
  screenLeft?: number;
  screenTop?: number;
};

function openCoinbasePopup(
  url: string,
  opts?: { onClosed?: () => void },
): { type: "popup" | "redirect"; cleanup?: () => void } {
  if (isMobileDevice()) {
    window.location.assign(url);
    return { type: "redirect" };
  }

  const width = 460;
  const height = 720;

  const w = window as WindowWithDualScreen;

  const dualScreenLeft =
    typeof w.screenLeft === "number" ? w.screenLeft : window.screenX;
  const dualScreenTop =
    typeof w.screenTop === "number" ? w.screenTop : window.screenY;

  const screenWidth = window.innerWidth || document.documentElement.clientWidth;
  const screenHeight =
    window.innerHeight || document.documentElement.clientHeight;

  const left = Math.max(0, dualScreenLeft + (screenWidth - width) / 2);
  const top = Math.max(0, dualScreenTop + (screenHeight - height) / 2);

  const popup = window.open(
    url,
    "coinbase_onramp",
    [
      `width=${width}`,
      `height=${height}`,
      `left=${Math.floor(left)}`,
      `top=${Math.floor(top)}`,
      "toolbar=no",
      "menubar=no",
      "location=no",
      "status=no",
      "scrollbars=yes",
      "resizable=yes",
    ].join(","),
  );

  if (!popup) {
    window.location.assign(url);
    return { type: "redirect" };
  }

  popup.focus();

  const poll = window.setInterval(() => {
    if (popup.closed) {
      window.clearInterval(poll);
      opts?.onClosed?.();
    }
  }, 500);

  return {
    type: "popup",
    cleanup: () => {
      window.clearInterval(poll);
      try {
        if (!popup.closed) popup.close();
      } catch {}
    },
  };
}

const Deposit: React.FC<DepositProps> = ({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}) => {
  const { user } = useUser();
  const {
    displayCurrency: balanceDisplayCurrency,
    usdcUsd,
    refresh,
    refreshNow,
  } = useBalance();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Tab state
  const [tab, setTab] = useState<DepositTab>("bank");

  // Bank deposit flow state
  const [bankStep, setBankStep] = useState<BankStep>("amount");
  const [amountInput, setAmountInput] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [coinbaseLaunching, setCoinbaseLaunching] = useState(false);
  const [coinbaseError, setCoinbaseError] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [flowType, setFlowType] = useState<FlowType | null>(null);
  const [quoteMethod, setQuoteMethod] = useState<"quote" | "session" | null>(
    null,
  );
  const [feeInfo, setFeeInfo] = useState<FeeInfo | null>(null);

  // Post-checkout state for balance checking
  const [postCheckoutState, setPostCheckoutState] =
    useState<PostCheckoutState>(null);

  const [balanceBeforeCheckout, setBalanceBeforeCheckout] = useState<
    number | null
  >(null);

  const [newBalance, setNewBalance] = useState<number | null>(null);

  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Crypto deposit state
  const [copied, setCopied] = useState(false);

  const popupRef = useRef<{ cleanup?: () => void } | null>(null);

  // Currency handling
  const currency = useMemo(() => {
    const c = (balanceDisplayCurrency || user?.displayCurrency || "USD")
      .toUpperCase()
      .trim();

    if (c === "USDC") return "USD";
    return (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(c)
      ? c
      : "USD";
  }, [balanceDisplayCurrency, user?.displayCurrency]);

  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const laneBalanceDisplay = Number.isFinite(balanceUsd) ? balanceUsd : 0;

  // Determine if user is in a Guest Checkout eligible country
  const userCountry = useMemo(() => {
    return (user?.country || "").toUpperCase().trim();
  }, [user?.country]);

  const isGuestCheckoutEligible = useMemo(() => {
    return GUEST_CHECKOUT_COUNTRIES.has(userCountry);
  }, [userCountry]);

  // Amount parsing - only relevant for US users
  const amountDisplay = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  const MIN_AMOUNT = 5;
  const MAX_AMOUNT = 10000;

  const amountWithinBounds =
    amountDisplay === 0 ||
    (amountDisplay >= MIN_AMOUNT && amountDisplay <= MAX_AMOUNT);
  const amountTooLow = amountDisplay > 0 && amountDisplay < MIN_AMOUNT;
  const amountTooHigh = amountDisplay > MAX_AMOUNT;

  const canProceedToConfirm =
    amountWithinBounds && !amountTooLow && !amountTooHigh;

  // For non-US users, they just need to acknowledge (no amount required)
  const canLaunchCoinbase = isGuestCheckoutEligible
    ? canProceedToConfirm && acknowledged
    : acknowledged;

  // Cleanup polling on unmount
  const cleanupPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      popupRef.current?.cleanup?.();
      popupRef.current = null;
      cleanupPolling();
    };
  }, [cleanupPolling]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (open) return;
    setTab("bank");
    setBankStep("amount");
    setAmountInput("");
    setAcknowledged(false);
    setCoinbaseLaunching(false);
    setCoinbaseError(null);
    setCheckoutOpen(false);
    setCopied(false);
    setFlowType(null);
    setQuoteMethod(null);
    setFeeInfo(null);
    setPostCheckoutState(null);
    setBalanceBeforeCheckout(null);
    setNewBalance(null);
    cleanupPolling();
    popupRef.current?.cleanup?.();
    popupRef.current = null;
  }, [open, cleanupPolling]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("[Deposit] Failed to copy address:", e);
    }
  };

  // Smart balance polling after checkout
  const startBalancePolling = useCallback(
    (balanceBefore: number) => {
      cleanupPolling();
      setPostCheckoutState("checking");
      pollCountRef.current = 0;

      const checkBalance = async () => {
        pollCountRef.current += 1;

        try {
          await refreshNow();

          // Small delay to let state update
          await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
          console.error("[Deposit] Balance refresh failed:", e);
        }
      };

      // Initial check after 2 seconds (give Solana time to confirm)
      setTimeout(async () => {
        await checkBalance();
      }, 2000);

      // Then poll every 3 seconds for up to 30 seconds (10 attempts)
      pollIntervalRef.current = setInterval(async () => {
        if (pollCountRef.current >= 10) {
          cleanupPolling();
          // After 30 seconds of polling, show "no change detected" but still let them close
          setPostCheckoutState("no_change");
          return;
        }

        await checkBalance();
      }, 3000);
    },
    [refreshNow, cleanupPolling],
  );

  // Watch for balance changes during polling
  useEffect(() => {
    if (postCheckoutState !== "checking" || balanceBeforeCheckout === null)
      return;

    // Check if balance increased
    const currentBalance = usdcUsd;
    if (currentBalance > balanceBeforeCheckout + 0.01) {
      // At least 1 cent increase
      cleanupPolling();
      setNewBalance(currentBalance);
      setPostCheckoutState("success");

      // Call parent onSuccess
      if (onSuccess) {
        Promise.resolve(onSuccess()).catch(console.error);
      }
    }
  }, [
    usdcUsd,
    postCheckoutState,
    balanceBeforeCheckout,
    cleanupPolling,
    onSuccess,
  ]);

  const handleOnrampComplete = useCallback(async () => {
    // Store current balance before we start checking
    setBalanceBeforeCheckout(usdcUsd);

    setCheckoutOpen(false);
    setCoinbaseLaunching(false);
    setFlowType(null);
    setQuoteMethod(null);
    setFeeInfo(null);

    // Start polling for balance changes
    startBalancePolling(usdcUsd);
  }, [usdcUsd, startBalancePolling]);

  const handleCloseAfterCheckout = useCallback(() => {
    cleanupPolling();
    setPostCheckoutState(null);
    setBalanceBeforeCheckout(null);
    setNewBalance(null);
    onOpenChange(false);
  }, [cleanupPolling, onOpenChange]);

  const launchCoinbase = useCallback(async () => {
    if (!canLaunchCoinbase) {
      setCoinbaseError("Please acknowledge the terms to continue.");
      return;
    }

    setCoinbaseError(null);
    setCoinbaseLaunching(true);

    // Store balance before checkout
    setBalanceBeforeCheckout(usdcUsd);

    try {
      const requestBody: OnrampSessionRequest = {
        destinationAddress: walletAddress,
        purchaseCurrency: "USDC",
        destinationNetwork: "solana",
        paymentCurrency: currency,
        sandbox: false,
      };

      // Only include paymentAmount for US users who entered one
      if (isGuestCheckoutEligible && amountDisplay > 0) {
        requestBody.paymentAmount = amountDisplay.toFixed(2);
      }

      // Include country if available
      if (user?.country) {
        requestBody.country = String(user.country).toUpperCase();
      }

      const res = await fetch("/api/onramp/session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data: OnrampSessionResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data?.error || `Failed to create session (HTTP ${res.status})`,
        );
      }

      const url =
        data.onrampUrl ||
        data.url ||
        data.one_click_buy_url ||
        data.redirectUrl;

      if (!url) {
        console.error("[Deposit] No URL in response:", data);
        throw new Error("Missing Coinbase checkout URL");
      }

      // Store the flow type and method for UI messaging
      if (data.flowType) {
        setFlowType(data.flowType);
      }
      if (data.method) {
        setQuoteMethod(data.method);
      }
      if (data.fees) {
        setFeeInfo(data.fees);
      }

      popupRef.current?.cleanup?.();
      popupRef.current = null;

      const result = openCoinbasePopup(url, { onClosed: handleOnrampComplete });
      popupRef.current = result;

      if (result.type === "popup") {
        setCheckoutOpen(true);
      } else {
        setCoinbaseLaunching(false);
      }
    } catch (e) {
      console.error("[Deposit] Coinbase launch failed:", e);
      setCoinbaseError(
        e instanceof Error ? e.message : "Couldn't open Coinbase right now.",
      );
      setCoinbaseLaunching(false);
    }
  }, [
    canLaunchCoinbase,
    walletAddress,
    currency,
    amountDisplay,
    isGuestCheckoutEligible,
    user?.country,
    usdcUsd,
    handleOnrampComplete,
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

  const goToStep = useCallback((newStep: BankStep) => setBankStep(newStep), []);

  const solanaAddressUri = `solana:${walletAddress}`;

  const close = () => {
    if (coinbaseLaunching || postCheckoutState === "checking") return;
    onOpenChange(false);
  };

  if (!open || !mounted) return null;

  const canClose = !coinbaseLaunching && postCheckoutState !== "checking";

  // Post-checkout state - show checking/success/no_change screen
  if (postCheckoutState) {
    return createPortal(
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4">
        <div className="relative w-full sm:max-w-md haven-card overflow-hidden h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
            {postCheckoutState === "checking" && (
              <>
                <div className="relative">
                  <RefreshCw className="h-10 w-10 text-primary animate-spin" />
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-foreground">
                    Checking for your deposit...
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    We&apos;re watching for your funds to arrive. This usually
                    takes 10-30 seconds.
                  </div>
                  <div className="mt-4 haven-card-soft px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Balance before
                      </span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(balanceBeforeCheckout ?? 0, currency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-2">
                      <span className="text-muted-foreground">Current</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(usdcUsd, currency)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    cleanupPolling();
                    setPostCheckoutState(null);
                    setCheckoutOpen(false);
                  }}
                  className="mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel and return to deposit
                </button>
              </>
            )}

            {postCheckoutState === "success" && (
              <>
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                  <CheckCircle2 className="h-10 w-10 text-primary" />
                </div>
                <div className="text-center">
                  <div className="text-xl font-semibold text-foreground">
                    Deposit received!
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Your funds have arrived in your account.
                  </div>
                  <div className="mt-4 haven-card-soft px-4 py-3 border-primary/20 bg-primary/5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">New balance</span>
                      <span className="font-semibold text-primary text-lg">
                        {formatCurrency(newBalance ?? usdcUsd, currency)}
                      </span>
                    </div>
                    {balanceBeforeCheckout !== null && newBalance !== null && (
                      <div className="flex items-center justify-between text-sm mt-2">
                        <span className="text-muted-foreground">Deposited</span>
                        <span className="font-medium text-foreground">
                          +
                          {formatCurrency(
                            newBalance - balanceBeforeCheckout,
                            currency,
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleCloseAfterCheckout}
                  className="mt-4 haven-btn-primary w-full"
                >
                  <Check className="w-4 h-4" />
                  Done
                </button>
              </>
            )}

            {postCheckoutState === "no_change" && (
              <>
                <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <Info className="h-8 w-8 text-amber-500" />
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-foreground">
                    No deposit detected yet
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    If you completed the purchase, your funds may still be
                    processing. Coinbase deposits can take a few minutes to
                    appear.
                  </div>
                  <div className="mt-4 haven-card-soft px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Current balance
                      </span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(usdcUsd, currency)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Don&apos;t worry - if you completed the purchase, your funds
                    will appear soon. You can safely close this and check back
                    later.
                  </p>
                </div>
                <div className="mt-4 flex gap-2 w-full">
                  <button
                    onClick={() => {
                      setPostCheckoutState("checking");
                      startBalancePolling(balanceBeforeCheckout ?? usdcUsd);
                    }}
                    className="haven-btn-secondary flex-1"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Check again
                  </button>
                  <button
                    onClick={handleCloseAfterCheckout}
                    className="haven-btn-primary flex-1"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // Checkout open state - show waiting screen
  if (checkoutOpen) {
    return createPortal(
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4">
        <div className="relative w-full sm:max-w-md haven-card overflow-hidden h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center p-5 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <div className="text-base font-semibold text-foreground">
                {flowType === "coinbase_login"
                  ? "Sign in to Coinbase"
                  : "Complete your checkout"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {flowType === "coinbase_login" ? (
                  <>
                    Sign in with your Coinbase account to complete the purchase.
                    <br />
                    <span className="text-[11px] text-muted-foreground/70">
                      First time? Create a free account in the popup.
                    </span>
                  </>
                ) : (
                  "Finish in the secure Coinbase window. We'll check for your deposit when you're done."
                )}
              </div>
              {quoteMethod === "quote" && (
                <div className="mt-2 text-[12px] text-primary">
                  ✓ Your amount has been pre-filled
                </div>
              )}
              <div className="mt-3 haven-card-soft px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Current balance</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(usdcUsd, currency)}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground/70">
                Close the Coinbase window when done and we&apos;ll check for
                your deposit.
              </div>
            </div>
            <button
              onClick={() => {
                popupRef.current?.cleanup?.();
                popupRef.current = null;
                setCheckoutOpen(false);
                setCoinbaseLaunching(false);
                setFlowType(null);
                setQuoteMethod(null);
                setFeeInfo(null);
              }}
              className="mt-2 haven-btn-secondary"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (canClose && e.target === e.currentTarget) close();
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
              {/* Back button only for US users in confirm step */}
              {tab === "bank" &&
                bankStep === "confirm" &&
                isGuestCheckoutEligible && (
                  <button
                    type="button"
                    onClick={() => goToStep("amount")}
                    disabled={coinbaseLaunching}
                    className="haven-icon-btn !w-9 !h-9"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
              <div>
                <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
                  Deposit Funds
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {tab === "bank" &&
                    isGuestCheckoutEligible &&
                    bankStep === "amount" &&
                    "Enter deposit amount"}
                  {tab === "bank" &&
                    isGuestCheckoutEligible &&
                    bankStep === "confirm" &&
                    "Review and confirm"}
                  {tab === "bank" &&
                    !isGuestCheckoutEligible &&
                    "Deposit via Coinbase"}
                  {tab === "crypto" && "Deposit USDC from another wallet"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs text-muted-foreground">
                Balance
                <div className="mt-0.5 font-semibold text-foreground">
                  {formatCurrency(laneBalanceDisplay, currency)}
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={!canClose}
                className="haven-icon-btn !w-9 !h-9"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tab Switcher - show for crypto tab or for US users on amount step */}
          {(tab === "crypto" ||
            (tab === "bank" &&
              (isGuestCheckoutEligible ? bankStep === "amount" : true))) && (
            <div className="flex p-1 bg-secondary rounded-2xl mt-4">
              <button
                type="button"
                onClick={() => {
                  setTab("bank");
                  setBankStep("amount");
                }}
                className={[
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all",
                  tab === "bank"
                    ? "bg-card text-foreground shadow-fintech-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <CreditCard className="w-4 h-4" />
                Bank
              </button>
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
            </div>
          )}

          {/* Progress indicator for bank flow - only for US users */}
          {tab === "bank" && isGuestCheckoutEligible && (
            <div className="flex gap-1.5 mt-4">
              {["amount", "confirm"].map((s) => (
                <div
                  key={s}
                  className={[
                    "h-1 flex-1 rounded-full transition-all duration-300",
                    bankStep === s
                      ? "bg-primary"
                      : s === "amount" && bankStep === "confirm"
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
          {/* BANK TAB - Amount Step (US users only) */}
          {tab === "bank" &&
            bankStep === "amount" &&
            isGuestCheckoutEligible && (
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
                    <div className="text-muted-foreground">
                      Min {symbol}
                      {MIN_AMOUNT} • Max {symbol}
                      {MAX_AMOUNT.toLocaleString()}
                    </div>
                    {amountTooLow && (
                      <div className="text-destructive">
                        Minimum deposit is {symbol}
                        {MIN_AMOUNT}
                      </div>
                    )}
                    {amountTooHigh && (
                      <div className="text-destructive">
                        Maximum deposit is {symbol}
                        {MAX_AMOUNT.toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Numpad */}
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

                <div className="mt-5 haven-card-soft px-4 py-3 border-primary/20 bg-primary/5">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      <strong className="text-foreground">
                        Secure checkout:
                      </strong>{" "}
                      You will complete payment via the Coinbase secure
                      checkout. Haven never sees your card details.
                    </p>
                  </div>
                </div>

                {/* Skip amount hint */}
                {amountDisplay === 0 && (
                  <div className="mt-3 text-center">
                    <p className="text-[11px] text-muted-foreground">
                      You can also skip this and enter the amount in Coinbase
                      checkout
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* BANK TAB - Direct flow for non-US users (no amount entry) */}
          {tab === "bank" && !isGuestCheckoutEligible && (
            <div className="p-5">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <CreditCard className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  Deposit via Coinbase
                </h3>
                <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
                  You&apos;ll be redirected to Coinbase to complete your
                  deposit. Enter your amount there.
                </p>
              </div>

              {/* Details card */}
              <div className="haven-card-soft overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    Deposit Details
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-muted-foreground">
                        You will receive
                      </span>
                      <span className="text-[13px] text-foreground font-medium">
                        USDC
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-muted-foreground">
                        Network
                      </span>
                      <span className="text-[13px] text-foreground font-medium">
                        Solana
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-muted-foreground">
                        Payment currency
                      </span>
                      <span className="text-[13px] text-foreground font-medium">
                        {currency}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-muted-foreground">
                        Destination
                      </span>
                      <span className="text-[12px] text-foreground font-mono truncate max-w-[55%]">
                        {shortAddress(walletAddress)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-secondary/30">
                  <div className="flex items-start gap-3">
                    <Globe className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      <strong className="text-foreground">
                        Coinbase account required:
                      </strong>{" "}
                      You&apos;ll sign in with your Coinbase account and can use{" "}
                      <span className="text-foreground">
                        linked payment methods
                      </span>{" "}
                      or{" "}
                      <span className="text-foreground">
                        existing crypto balance
                      </span>
                      . Don&apos;t have an account? Create one for free.
                    </div>
                  </div>
                </div>
              </div>

              {/* Acknowledgement */}
              <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div className="text-[12px] text-muted-foreground leading-snug">
                  I acknowledge that this transfer is facilitated by{" "}
                  <span className="text-foreground font-semibold">
                    Coinbase
                  </span>
                  , and I will need to sign in with my Coinbase account. Haven
                  does not handle card or banking details.
                </div>
              </label>

              {/* Error */}
              {coinbaseError && (
                <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                  <p className="text-[12px] text-destructive">
                    {coinbaseError}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* BANK TAB - Confirm Step (US users only) */}
          {tab === "bank" &&
            bankStep === "confirm" &&
            isGuestCheckoutEligible && (
              <div className="p-5">
                <div className="text-center py-6">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
                    {amountDisplay > 0
                      ? "You are depositing"
                      : "Deposit via Coinbase"}
                  </p>
                  {amountDisplay > 0 ? (
                    <span className="text-[44px] font-bold text-foreground tracking-tight">
                      {formatCurrency(amountDisplay, currency)}
                    </span>
                  ) : (
                    <span className="text-[24px] font-semibold text-muted-foreground">
                      Amount to be entered in checkout
                    </span>
                  )}
                </div>

                {/* Details card */}
                <div className="haven-card-soft overflow-hidden">
                  <div className="p-4 border-b border-border">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                      Deposit Details
                    </p>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-muted-foreground">
                          You are buying
                        </span>
                        <span className="text-[13px] text-foreground font-medium">
                          USDC
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-muted-foreground">
                          Network
                        </span>
                        <span className="text-[13px] text-foreground font-medium">
                          Solana
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-muted-foreground">
                          Payment currency
                        </span>
                        <span className="text-[13px] text-foreground font-medium">
                          {currency}
                        </span>
                      </div>
                      {amountDisplay > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-muted-foreground">
                            Amount
                          </span>
                          <span className="text-[13px] text-foreground font-medium">
                            {formatCurrency(amountDisplay, currency)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[12px] text-muted-foreground">
                          Destination
                        </span>
                        <span className="text-[12px] text-foreground font-mono truncate max-w-[55%]">
                          {shortAddress(walletAddress)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-secondary/30">
                    <div className="flex items-start gap-3">
                      <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="text-[11px] text-muted-foreground leading-relaxed">
                        <strong className="text-foreground">
                          Payment methods:
                        </strong>{" "}
                        Coinbase supports{" "}
                        <span className="text-foreground">
                          Visa/Mastercard debit
                        </span>
                        , <span className="text-foreground">Apple Pay</span>,
                        and{" "}
                        <span className="text-foreground">
                          existing Coinbase balance
                        </span>
                        . Credit cards are not supported.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Acknowledgement */}
                <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <div className="text-[12px] text-muted-foreground leading-snug">
                    I acknowledge that this transfer is facilitated by{" "}
                    <span className="text-foreground font-semibold">
                      Coinbase
                    </span>
                    . Haven does not handle card or banking details.
                  </div>
                </label>

                {/* Error */}
                {coinbaseError && (
                  <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                    <p className="text-[12px] text-destructive">
                      {coinbaseError}
                    </p>
                  </div>
                )}
              </div>
            )}

          {/* CRYPTO TAB */}
          {tab === "crypto" && (
            <div className="p-5 space-y-4">
              {/* Instructions */}
              <div className="haven-card-soft px-4 py-4">
                <p className="text-[13px] font-medium text-foreground mb-3">
                  Deposit USDC from another wallet
                </p>
                <ol className="space-y-2 text-[12px] text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center">
                      1
                    </span>
                    <span>
                      In your exchange or wallet, choose{" "}
                      <span className="text-foreground font-medium">
                        Withdraw / Send
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center">
                      2
                    </span>
                    <span>
                      Select{" "}
                      <span className="text-foreground font-medium">USDC</span>{" "}
                      as the token
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center">
                      3
                    </span>
                    <span>
                      Choose the{" "}
                      <span className="text-foreground font-medium">
                        Solana network
                      </span>{" "}
                      (important!)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center">
                      4
                    </span>
                    <span>Paste your Haven deposit address below</span>
                  </li>
                </ol>
              </div>

              {/* Warning */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200 leading-relaxed">
                    <strong>Important:</strong> Only send{" "}
                    <span className="font-semibold">USDC on Solana</span>.
                    Sending USDC on other networks may result in permanent loss
                    of funds.
                  </p>
                </div>
              </div>

              {/* Address and QR */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div className="haven-card-soft px-4 py-4">
                  <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    Your Haven deposit address
                  </p>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[12px] font-mono text-foreground">
                        {walletAddress}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="flex-shrink-0 haven-pill hover:bg-accent gap-1.5"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-primary" />
                          <span className="text-[11px]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span className="text-[11px]">Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Solana • {shortAddress(walletAddress)}
                  </p>
                </div>

                <div className="haven-card-soft flex flex-col items-center justify-center gap-2 px-4 py-4">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    Scan to deposit
                  </p>
                  <div className="rounded-xl bg-white p-2 shadow-lg">
                    <QRCodeSVG value={solanaAddressUri} size={100} level="M" />
                  </div>
                </div>
              </div>

              {/* Current balance */}
              <div className="haven-card-soft px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Current balance
                  </span>
                  <span className="text-[13px] text-primary font-semibold">
                    {formatCurrency(laneBalanceDisplay, currency)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-5 border-t border-border bg-card/80 backdrop-blur-sm">
          {/* US users: Amount step -> Continue button */}
          {tab === "bank" &&
            bankStep === "amount" &&
            isGuestCheckoutEligible && (
              <button
                type="button"
                onClick={() => goToStep("confirm")}
                disabled={!canProceedToConfirm}
                className={[
                  "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                  canProceedToConfirm
                    ? "haven-btn-primary"
                    : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
                ].join(" ")}
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

          {/* US users: Confirm step -> Launch Coinbase */}
          {tab === "bank" &&
            bankStep === "confirm" &&
            isGuestCheckoutEligible && (
              <button
                type="button"
                onClick={launchCoinbase}
                disabled={!canLaunchCoinbase || coinbaseLaunching}
                className={[
                  "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                  canLaunchCoinbase && !coinbaseLaunching
                    ? "haven-btn-primary"
                    : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
                ].join(" ")}
              >
                {coinbaseLaunching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Opening Coinbase...
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-4 h-4" />
                    Continue to Coinbase
                  </>
                )}
              </button>
            )}

          {/* Non-US users: Direct launch button */}
          {tab === "bank" && !isGuestCheckoutEligible && (
            <button
              type="button"
              onClick={launchCoinbase}
              disabled={!canLaunchCoinbase || coinbaseLaunching}
              className={[
                "w-full rounded-2xl px-4 py-3.5 text-[15px] font-semibold transition-all flex items-center justify-center gap-2",
                canLaunchCoinbase && !coinbaseLaunching
                  ? "haven-btn-primary"
                  : "bg-secondary text-muted-foreground cursor-not-allowed border border-border",
              ].join(" ")}
            >
              {coinbaseLaunching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Opening Coinbase...
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4" />
                  Proceed to Coinbase
                </>
              )}
            </button>
          )}

          {tab === "crypto" && (
            <button
              type="button"
              onClick={close}
              className="haven-btn-secondary w-full"
            >
              Done
            </button>
          )}

          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            {tab === "bank"
              ? isGuestCheckoutEligible
                ? "Secure checkout via Coinbase"
                : "Requires Coinbase account • Secure checkout"
              : "Only deposit USDC on Solana"}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};;

export default Deposit;
