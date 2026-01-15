// components/accounts/deposit/Onramp.tsx
"use client";

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { ArrowUpRight, Loader2, Info, X } from "lucide-react";
import { useUser } from "@/providers/UserProvider";

type Props = {
  destinationAddress?: string;
  defaultAmountDisplay?: string;
  title?: string;
  subtitle?: string;
  displayCurrency?: string;
  redirectUrl?: string;
  sandbox?: boolean;
  onSuccess?: () => void | Promise<void>;
  onClose?: () => void;
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
];

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

const COUNTRY_MAP: Record<string, string> = {
  CANADA: "CA",
  "UNITED STATES": "US",
  USA: "US",
  "UNITED KINGDOM": "GB",
  UK: "GB",
  ENGLAND: "GB",
  FRANCE: "FR",
  GERMANY: "DE",
  SPAIN: "ES",
  ITALY: "IT",
  NETHERLANDS: "NL",
  AUSTRALIA: "AU",
  JAPAN: "JP",
  SINGAPORE: "SG",
  SWITZERLAND: "CH",
  MEXICO: "MX",
  BRAZIL: "BR",
};

function sanitizeAmount(input: string): string {
  const cleaned = input.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return parts[0] + "." + parts.slice(1).join("");
}

function formatAmount(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

function isValidSolanaAddress(addr: string): boolean {
  const a = addr.trim();
  return a.length >= 32 && a.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(a);
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function normalizeCountry(input?: string | null): string | undefined {
  const raw = (input || "").trim().toUpperCase();
  if (!raw) return undefined;
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return COUNTRY_MAP[raw];
}

function maskAddress(addr?: string): string {
  const a = (addr || "").trim();
  if (!a) return "Primary account";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}••••${a.slice(-4)}`;
}

function openCheckout(
  url: string,
  onClosed?: () => void
): { type: "popup" | "redirect"; cleanup?: () => void } {
  if (isMobile()) {
    window.location.assign(url);
    return { type: "redirect" };
  }

  const width = 500;
  const height = 700;
  const left = Math.max(0, (window.screen.width - width) / 2);
  const top = Math.max(0, (window.screen.height - height) / 2);

  const popup = window.open(
    url,
    "coinbase_onramp",
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
  );

  if (!popup) {
    window.location.assign(url);
    return { type: "redirect" };
  }

  popup.focus();

  const interval = setInterval(() => {
    if (popup.closed) {
      clearInterval(interval);
      onClosed?.();
    }
  }, 500);

  return {
    type: "popup",
    cleanup: () => {
      clearInterval(interval);
      if (!popup.closed) popup.close();
    },
  };
}

export default function Onramp({
  destinationAddress,
  defaultAmountDisplay = "50",
  title = "Add money",
  subtitle = "Pay with your card.",
  displayCurrency,
  redirectUrl,
  sandbox,
  onSuccess,
  onClose,
}: Props) {
  const { user } = useUser();
  const checkoutRef = useRef<{ cleanup?: () => void } | null>(null);

  const [amount, setAmount] = useState(defaultAmountDisplay);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Derived values
  const toAddress = useMemo(
    () => (destinationAddress || user?.walletAddress || "").trim(),
    [destinationAddress, user?.walletAddress]
  );

  const currency = useMemo(() => {
    const c = (displayCurrency || user?.displayCurrency || "USD").toUpperCase();
    return SUPPORTED_FIAT_CURRENCIES.includes(c) ? c : "USD";
  }, [displayCurrency, user?.displayCurrency]);

  const symbol = CURRENCY_SYMBOLS[currency] || currency;

  const amountStr = useMemo(() => {
    const n = Number(sanitizeAmount(amount));
    return n > 0 ? formatAmount(n) : "";
  }, [amount]);

  const isSandbox = sandbox ?? process.env.NODE_ENV !== "production";

  const canSubmit =
    toAddress && isValidSolanaAddress(toAddress) && amountStr && approved;

  const getRedirectUrl = useCallback(() => {
    if (redirectUrl) return redirectUrl;
    if (typeof window === "undefined") return undefined;
    const url = new URL(window.location.href);
    url.searchParams.set("onramp_status", "complete");
    return url.toString();
  }, [redirectUrl]);

  // Handle redirect return
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("onramp_status") === "complete") {
      const url = new URL(window.location.href);
      url.searchParams.delete("onramp_status");
      window.history.replaceState({}, "", url.toString());
      onSuccess?.();
    }
  }, [onSuccess]);

  // Cleanup on unmount
  useEffect(() => {
    return () => checkoutRef.current?.cleanup?.();
  }, []);

  const handlePopupClosed = useCallback(() => {
    setCheckoutOpen(false);
    setLoading(false);
    onSuccess?.();
  }, [onSuccess]);

  const start = useCallback(async () => {
    setError(null);

    if (!toAddress) return setError("Missing deposit address.");
    if (!isValidSolanaAddress(toAddress))
      return setError("Invalid Solana address.");
    if (!amountStr) return setError("Enter a valid amount.");
    if (!approved) return setError("Please approve to continue.");

    setLoading(true);

    const country = normalizeCountry(user?.country);

    try {
      const startTime = Date.now();

      const res = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationAddress: toAddress,
          purchaseCurrency: "USDC",
          destinationNetwork: "solana",
          paymentCurrency: currency,
          paymentAmount: amountStr,
          redirectUrl: getRedirectUrl(),
          partnerUserRef: user?.id ? `user-${user.id}` : "user-unknown",
          sandbox: isSandbox,
          ...(country && { country }),
        }),
      });

      console.log(`[Onramp] API took ${Date.now() - startTime}ms`);

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to start checkout.");
      }

      // Backend returns 'onrampUrl'
      const url = data?.onrampUrl;
      if (!url) throw new Error("Missing onramp URL.");

      if (process.env.NODE_ENV !== "production") {
        console.log("[Onramp] Opening:", {
          url,
          sandbox: data?.sandbox,
          timings: data?.timings,
        });
      }

      const result = openCheckout(url, handlePopupClosed);
      checkoutRef.current = result;

      if (result.type === "popup") {
        setCheckoutOpen(true);
      } else {
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start checkout.");
      setLoading(false);
    }
  }, [
    toAddress,
    amountStr,
    approved,
    currency,
    user?.id,
    user?.country,
    isSandbox,
    getRedirectUrl,
    handlePopupClosed,
  ]);

  // Checkout open state - show waiting screen
  if (checkoutOpen) {
    return (
      <div className="glass-panel bg-white/10 p-4 sm:p-6">
        <div className="flex flex-col items-center justify-center py-10 gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <div className="text-center">
            <div className="text-base font-semibold text-white/95">
              Complete payment
            </div>
            <div className="mt-1 text-sm text-white/70">
              Finish in the secure checkout window.
            </div>
          </div>
          <button
            onClick={() => {
              checkoutRef.current?.cleanup?.();
              setCheckoutOpen(false);
              setLoading(false);
            }}
            className="mt-2 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 transition"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel bg-white/10 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-white/95">{title}</div>
          <div className="mt-1 text-sm text-white/70">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 transition"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <Info className="h-4 w-4 text-white/70" />
          </div>
        </div>
      </div>

      {/* Deposit details */}
      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-xs font-medium text-white/60">
          Deposit to account
        </div>
        <div className="mt-1 text-sm text-white/85">
          {maskAddress(toAddress)}
        </div>

        <div className="mt-3 h-px bg-white/10" />

        <div className="mt-3">
          <div className="text-xs font-medium text-white/60">Amount</div>
          <div className="relative mt-2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/60">
              {symbol}
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              inputMode="decimal"
              placeholder="50"
              className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-3 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-emerald-300/30"
            />
          </div>
          <div className="mt-2 text-[12px] text-white/55">
            {amountStr ? (
              <>
                Total{" "}
                <span className="text-white/85 font-semibold">
                  {symbol}
                  {amountStr}
                </span>
              </>
            ) : (
              <>Enter an amount to continue.</>
            )}
            {isSandbox && (
              <span className="ml-2 text-amber-300/80">(Sandbox)</span>
            )}
          </div>
        </div>
      </div>

      {/* Consent */}
      <label className="mt-3 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={approved}
          onChange={(e) => setApproved(e.target.checked)}
          className="mt-1 h-4 w-4 accent-emerald-400"
        />
        <div className="text-[12px] text-white/70 leading-snug">
          I authorize this card payment for{" "}
          <span className="text-white/85 font-semibold">
            {symbol}
            {amountStr || "0.00"}
          </span>
          .
        </div>
      </label>

      {/* Error */}
      {error && (
        <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={start}
        disabled={!canSubmit || loading}
        className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition border ${
          !canSubmit || loading
            ? "cursor-not-allowed border-white/10 bg-white/5 text-white/40"
            : "border-emerald-300/30 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25"
        }`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowUpRight className="h-4 w-4" />
        )}
        {loading ? "Opening checkout…" : "Continue"}
      </button>

      <div className="mt-3 text-[11px] text-white/45">
        Secure checkout. You&apos;ll be redirected to complete your payment.
      </div>
    </div>
  );
}
