"use client";

// components/accounts/deposit/Deposit.tsx
// FIXED: Better currency detection + proper one-click-buy URL handling for international users
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
  Zap,
  Building2,
  User,
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
  paymentCurrency?: string;
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

// Map country codes to their default fiat currencies
// This is crucial for international users
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  UK: "GBP",
  AU: "AUD",
  NZ: "NZD",
  JP: "JPY",
  SG: "SGD",
  CH: "CHF",
  BR: "BRL",
  MX: "MXN",
  // EU countries use EUR
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  IE: "EUR",
  FI: "EUR",
  GR: "EUR",
  LU: "EUR",
  MT: "EUR",
  CY: "EUR",
  SK: "EUR",
  SI: "EUR",
  EE: "EUR",
  LV: "EUR",
  LT: "EUR",
};

// Countries that support Guest Checkout (US only)
const GUEST_CHECKOUT_COUNTRIES = new Set(["US"]);

// Quick amount presets based on currency
const AMOUNT_PRESETS: Record<string, number[]> = {
  USD: [25, 50, 100, 250],
  CAD: [25, 50, 100, 250],
  EUR: [25, 50, 100, 250],
  GBP: [20, 50, 100, 200],
  AUD: [50, 100, 200, 500],
  JPY: [3000, 5000, 10000, 25000],
  DEFAULT: [25, 50, 100, 250],
};

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
      minimumFractionDigits: currency === "JPY" ? 0 : 2,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
    }).format(n);
  } catch {
    return `${n.toFixed(currency === "JPY" ? 0 : 2)} ${currency}`;
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

  // Post-checkout state
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

  // IMPROVED: Get user's country code normalized
  const userCountry = useMemo(() => {
    const raw = (user?.country || "").toUpperCase().trim();
    // Handle full country names
    const countryMap: Record<string, string> = {
      CANADA: "CA",
      "UNITED STATES": "US",
      USA: "US",
      "UNITED KINGDOM": "GB",
      UK: "GB",
      AUSTRALIA: "AU",
    };
    if (raw.length === 2) return raw;
    return countryMap[raw] || raw.slice(0, 2);
  }, [user?.country]);

  // IMPROVED: Currency detection - prioritize country-based currency
  const currency = useMemo(() => {
    // First, check if user has a display currency set
    const displayCurr = (balanceDisplayCurrency || user?.displayCurrency || "")
      .toUpperCase()
      .trim();

    // If display currency is set and valid (not USDC), use it
    if (
      displayCurr &&
      displayCurr !== "USDC" &&
      (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(displayCurr)
    ) {
      return displayCurr;
    }

    // Otherwise, derive from country
    if (userCountry && COUNTRY_TO_CURRENCY[userCountry]) {
      const countryCurrency = COUNTRY_TO_CURRENCY[userCountry];
      if (
        (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(
          countryCurrency,
        )
      ) {
        return countryCurrency;
      }
    }

    // Default to USD
    return "USD";
  }, [balanceDisplayCurrency, user?.displayCurrency, userCountry]);

  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const laneBalanceDisplay = Number.isFinite(balanceUsd) ? balanceUsd : 0;

  const isGuestCheckoutEligible = useMemo(() => {
    return GUEST_CHECKOUT_COUNTRIES.has(userCountry);
  }, [userCountry]);

  // Get amount presets for current currency
  const amountPresets = useMemo(() => {
    return AMOUNT_PRESETS[currency] || AMOUNT_PRESETS.DEFAULT;
  }, [currency]);

  // Amount parsing
  const amountDisplay = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  const MIN_AMOUNT = currency === "JPY" ? 500 : 5;
  const MAX_AMOUNT = currency === "JPY" ? 1000000 : 10000;

  const amountWithinBounds =
    amountDisplay === 0 ||
    (amountDisplay >= MIN_AMOUNT && amountDisplay <= MAX_AMOUNT);
  const amountTooLow = amountDisplay > 0 && amountDisplay < MIN_AMOUNT;
  const amountTooHigh = amountDisplay > MAX_AMOUNT;

  const canProceedToConfirm =
    amountWithinBounds && !amountTooLow && !amountTooHigh;

  const canLaunchCoinbase = acknowledged;

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
          await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
          console.error("[Deposit] Balance refresh failed:", e);
        }
      };

      setTimeout(async () => {
        await checkBalance();
      }, 2000);

      pollIntervalRef.current = setInterval(async () => {
        if (pollCountRef.current >= 10) {
          cleanupPolling();
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

    const currentBalance = usdcUsd;
    if (currentBalance > balanceBeforeCheckout + 0.01) {
      cleanupPolling();
      setNewBalance(currentBalance);
      setPostCheckoutState("success");

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
    setBalanceBeforeCheckout(usdcUsd);
    setCheckoutOpen(false);
    setCoinbaseLaunching(false);
    setFlowType(null);
    setQuoteMethod(null);
    setFeeInfo(null);
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
    setBalanceBeforeCheckout(usdcUsd);

    try {
      const requestBody: OnrampSessionRequest = {
        destinationAddress: walletAddress,
        purchaseCurrency: "USDC",
        destinationNetwork: "solana",
        // CRITICAL: Use the detected currency (CAD for Canada, etc.)
        paymentCurrency: currency,
        sandbox: false,
      };

      // Include paymentAmount for ALL users if they entered one
      if (amountDisplay > 0) {
        requestBody.paymentAmount = amountDisplay.toFixed(
          currency === "JPY" ? 0 : 2,
        );
      }

      // Include country if available
      if (userCountry) {
        requestBody.country = userCountry;
      }

      console.log("[Deposit] Launching with:", {
        currency,
        amount: amountDisplay || "(none)",
        country: userCountry,
      });

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

      if (data.flowType) setFlowType(data.flowType);
      if (data.method) setQuoteMethod(data.method);
      if (data.fees) setFeeInfo(data.fees);

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
    userCountry,
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

  const selectPresetAmount = useCallback((amount: number) => {
    setAmountInput(amount.toString());
  }, []);

  const goToStep = useCallback((newStep: BankStep) => setBankStep(newStep), []);

  const solanaAddressUri = `solana:${walletAddress}`;

  const close = () => {
    if (coinbaseLaunching || postCheckoutState === "checking") return;
    onOpenChange(false);
  };

  if (!open || !mounted) return null;

  const canClose = !coinbaseLaunching && postCheckoutState !== "checking";

  // Post-checkout state screens
  if (postCheckoutState) {
    return createPortal(
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4">
        <div className="relative w-full sm:max-w-md haven-card overflow-hidden h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
            {postCheckoutState === "checking" && (
              <>
                <RefreshCw className="h-10 w-10 text-primary animate-spin" />
                <div className="text-center">
                  <div className="text-lg font-semibold text-foreground">
                    Checking for your deposit...
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    We&apos;re watching for your funds to arrive.
                  </div>
                  <div className="mt-4 haven-card-soft px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Before</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(balanceBeforeCheckout ?? 0, "USD")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-2">
                      <span className="text-muted-foreground">Current</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(usdcUsd, "USD")}
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
                  className="mt-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
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
                  <div className="mt-4 haven-card-soft px-4 py-3 border-primary/20 bg-primary/5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">New balance</span>
                      <span className="font-semibold text-primary text-lg">
                        {formatCurrency(newBalance ?? usdcUsd, "USD")}
                      </span>
                    </div>
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
                    If you completed the purchase, funds may still be
                    processing.
                  </div>
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

  // Checkout open - waiting screen
  if (checkoutOpen) {
    return createPortal(
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-4">
        <div className="relative w-full sm:max-w-md haven-card overflow-hidden h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center p-5 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <div className="text-base font-semibold text-foreground">
                Complete your purchase
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {flowType === "coinbase_login"
                  ? "Sign in to Coinbase or create a free account."
                  : "Finish in the secure Coinbase window."}
              </div>
              {amountDisplay > 0 && (
                <div className="mt-2 text-[12px] text-primary">
                  ✓ {formatCurrency(amountDisplay, currency)} pre-filled
                </div>
              )}
            </div>
            <button
              onClick={() => {
                popupRef.current?.cleanup?.();
                popupRef.current = null;
                setCheckoutOpen(false);
                setCoinbaseLaunching(false);
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
              {tab === "bank" && bankStep === "confirm" && (
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
                    bankStep === "amount" &&
                    `Paying with ${currency}`}
                  {tab === "bank" &&
                    bankStep === "confirm" &&
                    "Review and confirm"}
                  {tab === "crypto" && "Deposit USDC from another wallet"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs text-muted-foreground">
                Balance
                <div className="mt-0.5 font-semibold text-foreground">
                  {formatCurrency(laneBalanceDisplay, "USD")}
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

          {/* Tab Switcher */}
          {(tab === "crypto" || (tab === "bank" && bankStep === "amount")) && (
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
                Card / Bank
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

          {/* Progress indicator */}
          {tab === "bank" && (
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
          {/* BANK TAB - Amount Step */}
          {tab === "bank" && bankStep === "amount" && (
            <div className="p-5">
              {/* Coinbase account info for non-US users */}
              {!isGuestCheckoutEligible && (
                <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                  <div className="flex items-start gap-2">
                    <User className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="text-[12px] text-blue-200 leading-relaxed">
                      <strong className="text-blue-100">
                        Coinbase account required
                      </strong>
                      <br />
                      You&apos;ll sign in or create a free Coinbase account.
                    </div>
                  </div>
                </div>
              )}

              {/* Amount Display */}
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
                      Minimum is {symbol}
                      {MIN_AMOUNT}
                    </div>
                  )}
                  {amountTooHigh && (
                    <div className="text-destructive">
                      Maximum is {symbol}
                      {MAX_AMOUNT.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Amount Presets */}
              <div className="mb-4">
                <div className="grid grid-cols-4 gap-2">
                  {amountPresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => selectPresetAmount(preset)}
                      className={[
                        "py-2.5 rounded-xl text-[13px] font-semibold transition-all border",
                        amountDisplay === preset
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-secondary border-border text-foreground hover:bg-accent",
                      ].join(" ")}
                    >
                      {symbol}
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Numpad - hide decimal for JPY */}
              <div className="grid grid-cols-3 gap-2">
                {(currency === "JPY"
                  ? [
                      "1",
                      "2",
                      "3",
                      "4",
                      "5",
                      "6",
                      "7",
                      "8",
                      "9",
                      "00",
                      "0",
                      "DEL",
                    ]
                  : [
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
                    ]
                ).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pressKey(k)}
                    className={[
                      "h-12 sm:h-14 rounded-2xl text-[18px] font-semibold transition-all bg-secondary hover:bg-accent active:scale-95 border border-border",
                      k === "DEL" ? "text-muted-foreground" : "text-foreground",
                    ].join(" ")}
                  >
                    {k === "DEL" ? "⌫" : k}
                  </button>
                ))}
              </div>

              {amountDisplay === 0 && (
                <div className="mt-4 text-center">
                  <p className="text-[11px] text-muted-foreground">
                    Or skip and enter the amount in Coinbase
                  </p>
                </div>
              )}
            </div>
          )}

          {/* BANK TAB - Confirm Step */}
          {tab === "bank" && bankStep === "confirm" && (
            <div className="p-5">
              <div className="text-center py-6">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
                  {amountDisplay > 0 ? "You are depositing" : "Deposit via"}
                </p>
                {amountDisplay > 0 ? (
                  <span className="text-[44px] font-bold text-foreground tracking-tight">
                    {formatCurrency(amountDisplay, currency)}
                  </span>
                ) : (
                  <span className="text-[24px] font-semibold text-foreground">
                    Coinbase
                  </span>
                )}
              </div>

              <div className="haven-card-soft overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                    Details
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-muted-foreground">
                        You receive
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
                  </div>
                </div>

                <div className="p-4 bg-secondary/30">
                  <div className="flex items-start gap-3">
                    {isGuestCheckoutEligible ? (
                      <>
                        <Zap className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                        <div className="text-[11px] text-muted-foreground leading-relaxed">
                          <strong className="text-foreground">
                            Quick checkout
                          </strong>{" "}
                          — Apple Pay or debit card. No account needed.
                        </div>
                      </>
                    ) : (
                      <>
                        <Building2 className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        <div className="text-[11px] text-muted-foreground leading-relaxed">
                          <strong className="text-foreground">
                            Coinbase checkout
                          </strong>{" "}
                          — Sign in or create a free account to pay with your
                          saved cards or balance.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div className="text-[12px] text-muted-foreground leading-snug">
                  I understand this deposit is processed by{" "}
                  <span className="text-foreground font-semibold">
                    Coinbase
                  </span>
                  . Haven never sees my payment details.
                </div>
              </label>

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
                      Choose <strong>Withdraw / Send</strong> in your wallet
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center">
                      2
                    </span>
                    <span>
                      Select <strong>USDC</strong> as the token
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center">
                      3
                    </span>
                    <span>
                      Choose <strong>Solana</strong> network (important!)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold flex items-center justify-center">
                      4
                    </span>
                    <span>Paste your Haven address below</span>
                  </li>
                </ol>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200 leading-relaxed">
                    <strong>Only send USDC on Solana.</strong> Other networks
                    may result in lost funds.
                  </p>
                </div>
              </div>

              <div className="haven-card-soft px-4 py-4">
                <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Your deposit address
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
              </div>

              <div className="haven-card-soft flex flex-col items-center gap-2 px-4 py-4">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Scan to deposit
                </p>
                <div className="rounded-xl bg-white p-2 shadow-lg">
                  <QRCodeSVG value={solanaAddressUri} size={120} level="M" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-5 border-t border-border bg-card/80 backdrop-blur-sm">
          {tab === "bank" && bankStep === "amount" && (
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
              {amountDisplay > 0
                ? `Continue with ${formatCurrency(amountDisplay, currency)}`
                : "Continue"}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {tab === "bank" && bankStep === "confirm" && (
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
                  {isGuestCheckoutEligible
                    ? "Continue to Checkout"
                    : "Continue with Coinbase"}
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
            {tab === "bank" ? (
              <>
                <ShieldCheck className="w-3 h-3 inline mr-1" />
                Powered by Coinbase • {currency}
              </>
            ) : (
              "Only deposit USDC on Solana"
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default Deposit;
