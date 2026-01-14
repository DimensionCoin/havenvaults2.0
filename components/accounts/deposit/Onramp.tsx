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

  /** Optional redirect after Coinbase checkout - defaults to current page */
  redirectUrl?: string;

  /** Force sandbox mode (optional). Defaults to dev=true, prod=false */
  sandbox?: boolean;

  /** Callback when deposit completes successfully */
  onSuccess?: () => void | Promise<void>;

  /** Callback to close the parent modal */
  onClose?: () => void;
};

// Supported fiat currencies by Coinbase Onramp
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

function sanitizeAmount(input: string) {
  const cleaned = input.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  const normalized =
    parts.length <= 2
      ? parts[0] + (parts[1] !== undefined ? `.${parts[1]}` : "")
      : parts[0] + `.${parts.slice(1).join("")}`;
  return normalized === "." ? "" : normalized;
}

function to2(n: number) {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function isProbablySolanaAddress(addr: string) {
  const a = addr.trim();
  if (a.length < 32 || a.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(a);
}

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function openCheckout(
  url: string,
  options: { onPopupClosed?: () => void }
): { type: "popup" | "redirect" | "iframe"; cleanup?: () => void } {
  const mobile = isMobileDevice();

  if (mobile) {
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

  if (popup) {
    const pollInterval = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollInterval);
        options.onPopupClosed?.();
      }
    }, 500);

    popup.focus();

    return {
      type: "popup",
      cleanup: () => {
        clearInterval(pollInterval);
        if (!popup.closed) popup.close();
      },
    };
  }

  window.location.assign(url);
  return { type: "redirect" };
}

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
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
  return symbols[currency] || currency;
}

/** UI-only: hide full address */
function maskAccountId(id?: string) {
  const a = (id || "").trim();
  if (!a) return "Primary account";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}••••${a.slice(-4)}`;
}

/**
 * Robust country normalization:
 * - Accepts "CA", "Canada", "canada", etc.
 * - Returns ISO2 (e.g., "CA") or undefined (omit country param)
 */
function normalizeCountryISO2(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  const upper = raw.toUpperCase();

  // Already ISO2
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  // Common names → ISO2
  const map: Record<string, string> = {
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

  if (map[upper]) return map[upper];

  // Unknown format → omit param (most robust)
  return undefined;
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

  const toAddress = useMemo(() => {
    return (destinationAddress || user?.walletAddress || "").trim();
  }, [destinationAddress, user?.walletAddress]);

  const paymentCurrency = useMemo(() => {
    const userCurrency = (
      displayCurrency ||
      user?.displayCurrency ||
      "USD"
    ).toUpperCase();

    if (SUPPORTED_FIAT_CURRENCIES.includes(userCurrency)) return userCurrency;

    console.warn(
      `[Onramp] Currency ${userCurrency} not supported by Coinbase, falling back to USD`
    );
    return "USD";
  }, [displayCurrency, user?.displayCurrency]);

  const currencySymbol = getCurrencySymbol(paymentCurrency);

  const [amountDisplay, setAmountDisplay] =
    useState<string>(defaultAmountDisplay);
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const paymentAmountStr = useMemo(() => {
    const cleaned = sanitizeAmount(amountDisplay);
    const n = Number(cleaned);
    if (!cleaned || !Number.isFinite(n) || n <= 0) return "";
    return to2(n);
  }, [amountDisplay]);

  const isSandbox = sandbox ?? process.env.NODE_ENV !== "production";

  const canSubmit = useMemo(() => {
    if (!toAddress || !isProbablySolanaAddress(toAddress)) return false;
    if (!paymentAmountStr) return false;
    if (!approved) return false;
    return true;
  }, [toAddress, paymentAmountStr, approved]);

  const getRedirectUrl = useCallback(() => {
    if (redirectUrl) return redirectUrl;
    if (typeof window === "undefined") return undefined;

    const url = new URL(window.location.href);
    url.searchParams.set("onramp_status", "complete");
    return url.toString();
  }, [redirectUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const status = params.get("onramp_status");

    if (status === "complete") {
      const url = new URL(window.location.href);
      url.searchParams.delete("onramp_status");
      window.history.replaceState({}, "", url.toString());
      onSuccess?.();
    }
  }, [onSuccess]);

  useEffect(() => {
    return () => {
      checkoutRef.current?.cleanup?.();
    };
  }, []);

  const handlePopupClosed = useCallback(() => {
    setCheckoutOpen(false);
    setLoading(false);
    onSuccess?.();
  }, [onSuccess]);

  const start = useCallback(async () => {
    setErr(null);

    if (!toAddress) return setErr("Missing deposit address.");
    if (!isProbablySolanaAddress(toAddress))
      return setErr("Deposit address looks invalid.");
    if (!paymentAmountStr) return setErr("Enter a valid amount.");
    if (!approved) return setErr("Please approve to continue.");

    setLoading(true);

    // ✅ robust: send ISO2 country if we can, otherwise omit entirely
    const countryISO2 = normalizeCountryISO2(user?.country);

    try {
      const res = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          destinationAddress: toAddress,
          purchaseCurrency: "USDC",
          destinationNetwork: "solana",
          paymentCurrency: paymentCurrency,
          paymentAmount: paymentAmountStr,
          redirectUrl: getRedirectUrl(),
          partnerUserRef: user?.id ? `user-${user.id}` : "user-unknown",
          sandbox: isSandbox,

          // ✅ IMPORTANT: "CA" not "Canada" (or omit if unknown)
          ...(countryISO2 ? { country: countryISO2 } : {}),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        onrampUrl?: string;
        sandbox?: boolean;
        sent?: unknown;
        coinbase?: { errorMessage?: string };
      };

      if (!res.ok) {
        const msg =
          data?.error ||
          data?.coinbase?.errorMessage ||
          "Failed to start checkout.";
        throw new Error(msg);
      }

      const url = data?.onrampUrl as string | undefined;
      if (!url) throw new Error("Missing onramp URL.");

      if (process.env.NODE_ENV !== "production") {
        console.log("[Onramp] Sandbox:", data?.sandbox);
        console.log("[Onramp] Payment currency:", paymentCurrency);
        console.log("[Onramp] Payment amount:", paymentAmountStr);
        console.log("[Onramp] countryISO2:", countryISO2 || "(omitted)");
        console.log("[Onramp] sent payload:", data?.sent);
        console.log("[Onramp] checkout url:", url);
      }

      const result = openCheckout(url, { onPopupClosed: handlePopupClosed });
      checkoutRef.current = result;

      if (result.type === "popup") setCheckoutOpen(true);
      else setLoading(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "";
      setErr(message || "Failed to start checkout.");
      console.error("[Onramp] start error:", e);
      setLoading(false);
    }
  }, [
    approved,
    getRedirectUrl,
    handlePopupClosed,
    paymentCurrency,
    paymentAmountStr,
    toAddress,
    user?.id,
    user?.country,
    isSandbox,
  ]);

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

      {/* Bank-like “card payment” box */}
      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-xs font-medium text-white/60">
          Deposit to account
        </div>
        <div className="mt-1 text-sm text-white/85">
          {maskAccountId(toAddress)}
        </div>

        <div className="mt-3 h-px bg-white/10" />

        <div className="mt-3">
          <div className="text-xs font-medium text-white/60">Amount</div>

          <div className="relative mt-2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/60">
              {currencySymbol}
            </span>
            <input
              value={amountDisplay}
              onChange={(e) => setAmountDisplay(sanitizeAmount(e.target.value))}
              inputMode="decimal"
              placeholder="50"
              className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-3 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-emerald-300/30"
            />
          </div>

          <div className="mt-2 text-[12px] text-white/55">
            {paymentAmountStr ? (
              <>
                Total{" "}
                <span className="text-white/85 font-semibold">
                  {currencySymbol}
                  {paymentAmountStr}
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
      <label className="mt-3 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
        <input
          type="checkbox"
          checked={approved}
          onChange={(e) => setApproved(e.target.checked)}
          className="mt-1 h-4 w-4 accent-emerald-400"
        />
        <div className="text-[12px] text-white/70 leading-snug">
          I authorize this card payment for{" "}
          <span className="text-white/85 font-semibold">
            {currencySymbol}
            {paymentAmountStr || "0.00"}
          </span>
          .
        </div>
      </label>

      {err && (
        <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {err}
        </div>
      )}

      <button
        onClick={start}
        disabled={!canSubmit || loading}
        className={[
          "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition border",
          !canSubmit || loading
            ? "cursor-not-allowed border-white/10 bg-white/5 text-white/40"
            : "border-emerald-300/30 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25",
        ].join(" ")}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowUpRight className="h-4 w-4" />
        )}
        {loading ? "Opening checkout…" : "Continue"}
      </button>

      <div className="mt-3 text-[11px] text-white/45">
        Secure checkout. You’ll be redirected to complete your payment.
      </div>

      {/* Dev-only preview unchanged, but shows normalized country */}
      {process.env.NODE_ENV !== "production" && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-[11px] text-white/60">
          <div className="font-semibold text-white/75 mb-1">
            Dev: params preview
          </div>
          <div>destinationAddress: {toAddress || "—"}</div>
          <div>destinationNetwork: solana</div>
          <div>purchaseCurrency: USDC</div>
          <div>
            paymentCurrency:{" "}
            <span className="text-emerald-300">{paymentCurrency}</span>
          </div>
          <div>paymentAmount: {paymentAmountStr || "—"}</div>
          <div>
            country: {normalizeCountryISO2(user?.country) || "(omitted)"}
          </div>
          <div>
            partnerUserRef: {user?.id ? `user-${user.id}` : "user-unknown"}{" "}
            {isSandbox ? "(sandbox- prefixed server-side)" : ""}
          </div>
          <div className="break-all">
            redirectUrl: {getRedirectUrl() || "—"}
          </div>
          <div>platform: {isMobileDevice() ? "mobile" : "desktop"}</div>
          <div>
            mode:{" "}
            <span className={isSandbox ? "text-amber-300" : "text-emerald-300"}>
              {isSandbox ? "SANDBOX" : "PRODUCTION"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
