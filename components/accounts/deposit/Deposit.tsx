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
  X,
  ExternalLink,
  Copy,
  CheckCircle2,
  CreditCard,
  Wallet,
  Lock,
  Info,
  ShieldCheck,
} from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useUser } from "@/providers/UserProvider";
import DevEmailGate from "@/components/shared/DevEmailGate";

type DepositProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
  balanceUsd: number;
  onSuccess?: () => void | Promise<void>;
};

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const cleanNumber = (n: number) => (Number.isFinite(n) ? n : 0);

type OnrampSessionResponse = {
  onrampUrl?: string;
  url?: string;
  one_click_buy_url?: string;
  redirectUrl?: string;
  error?: string;
  code?: string;
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

/* -------------------- ENV GATING (CLIENT) -------------------- */
const ONRAMP_ENABLED =
  String(process.env.NEXT_PUBLIC_ONRAMP_ENABLED || "false")
    .trim()
    .toLowerCase() === "true";

const ONRAMP_ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ONRAMP_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const Deposit: React.FC<DepositProps> = ({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}) => {
  const { user } = useUser();

  const [tab, setTab] = useState<"onramp" | "crypto">("crypto");
  const [copied, setCopied] = useState(false);

  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const [coinbaseAcknowledged, setCoinbaseAcknowledged] = useState(false);
  const [coinbaseLaunching, setCoinbaseLaunching] = useState(false);
  const [coinbaseError, setCoinbaseError] = useState<string | null>(null);

  const popupRef = useRef<{ cleanup?: () => void } | null>(null);

  const userEmail = String(user?.email || "")
    .trim()
    .toLowerCase();

  const isDev = useMemo(
    () => ONRAMP_ADMIN_EMAILS.includes(userEmail),
    [userEmail],
  );

  const canUseOnramp = ONRAMP_ENABLED || isDev;
  const showMask = !canUseOnramp;

  useEffect(() => {
    if (!canUseOnramp) setCoinbaseAcknowledged(false);
  }, [canUseOnramp]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    return () => {
      popupRef.current?.cleanup?.();
      popupRef.current = null;
    };
  }, []);

  // Lock body scroll while open (modal itself will scroll)
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error("[Deposit] Failed to copy address:", e);
    }
  };

  const handleOnrampSuccess = useCallback(async () => {
    if (onSuccess) await onSuccess();
    setTimeout(() => onOpenChange(false), 500);
  }, [onSuccess, onOpenChange]);

  const launchCoinbase = useCallback(async () => {
    if (!canUseOnramp) {
      setCoinbaseError("Bank deposits are not enabled yet.");
      return;
    }
    if (!coinbaseAcknowledged) {
      setCoinbaseError("Please acknowledge the Coinbase checkout terms.");
      return;
    }

    setCoinbaseError(null);
    setCoinbaseLaunching(true);

    try {
      const res = await fetch("/api/onramp/session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationAddress: walletAddress,
          purchaseCurrency: "USDC",
          destinationNetwork: "solana",
          paymentCurrency: displayCurrency,
          sandbox: false,
          ...(user?.country
            ? { country: String(user.country).toUpperCase() }
            : {}),
        }),
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

      popupRef.current?.cleanup?.();
      popupRef.current = null;

      const result = openCoinbasePopup(url, { onClosed: handleOnrampSuccess });
      popupRef.current = result;

      if (result.type === "redirect") {
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
    canUseOnramp,
    coinbaseAcknowledged,
    walletAddress,
    displayCurrency,
    user?.country,
    handleOnrampSuccess,
  ]);

  const solanaAddressUri = `solana:${walletAddress}`;

  const close = () => {
    if (coinbaseLaunching) return;
    onOpenChange(false);
  };

  if (!open || !mounted) return null;

  const envMisconfigured =
    process.env.NODE_ENV !== "production" &&
    !ONRAMP_ENABLED &&
    ONRAMP_ADMIN_EMAILS.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      {/* Backdrop visual ONLY */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />

      {/* Click-catcher (outside-card click closes) */}
      <button
        type="button"
        aria-label="Close deposit modal"
        className="absolute inset-0 cursor-default"
        onClick={() => {
          if (!coinbaseLaunching) close();
        }}
      />

      {/* Centered card */}
      <div className="absolute inset-0 flex items-center justify-center px-4 py-4">
        <div
          className={[
            "relative z-10 w-full max-w-md haven-card shadow-[0_20px_70px_rgba(0,0,0,0.7)]",
            // ✅ Constrain height + make internal layout scrollable
            "max-h-[calc(100svh-2rem)] flex flex-col",
          ].join(" ")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ✅ HEADER (pinned) */}
          <div className="p-5 pb-4 border-b border-border/60">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  <div className="text-sm font-semibold text-foreground/90">
                    Deposit funds
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Add USDC to your Haven deposit account.
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right text-xs text-muted-foreground">
                  Balance
                  <div className="mt-0.5 font-semibold text-foreground/90">
                    ${cleanNumber(balanceUsd).toFixed(2)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={close}
                  disabled={coinbaseLaunching}
                  className="haven-pill hover:bg-accent disabled:opacity-50"
                  aria-label="Close"
                  title={coinbaseLaunching ? "Please wait…" : "Close"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* ✅ BODY (scrollable) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 pt-4">
            <Tabs
              value={tab}
              onValueChange={(val) => setTab(val as "onramp" | "crypto")}
            >
              <TabsList className="mb-3 grid w-full grid-cols-2 rounded-2xl border border-border bg-background/50 p-1">
                <TabsTrigger
                  value="onramp"
                  className={[
                    "text-xs rounded-xl px-3 py-2 transition-colors",
                    "bg-transparent text-muted-foreground",
                    "data-[state=active]:!bg-primary data-[state=active]:!text-black",
                    "data-[state=active]:shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                  ].join(" ")}
                  title={showMask ? "Coming soon" : undefined}
                >
                  <span className="inline-flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Bank deposit
                  </span>
                </TabsTrigger>

                <TabsTrigger
                  value="crypto"
                  className={[
                    "text-xs rounded-xl px-3 py-2 transition-colors",
                    "bg-transparent text-muted-foreground",
                    "data-[state=active]:!bg-primary data-[state=active]:!text-black",
                    "data-[state=active]:shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                  ].join(" ")}
                >
                  <span className="inline-flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    Crypto deposit
                  </span>
                </TabsTrigger>
              </TabsList>

              {/* Bank deposit tab */}
              <TabsContent value="onramp" className="mt-2 space-y-3">
                {envMisconfigured ? (
                  <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    Env misconfigured: NEXT_PUBLIC_ONRAMP_ADMIN_EMAILS is empty,
                    so DevEmailGate will block everyone. Add it and restart dev
                    server.
                  </div>
                ) : null}

                {showMask ? (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    <div className="flex items-start gap-2">
                      <Lock className="mt-[1px] h-3.5 w-3.5" />
                      <div>
                        <div className="font-semibold text-foreground/90">
                          Bank deposits are coming soon
                        </div>
                        <div className="mt-0.5 text-amber-100/80">
                          You can preview this flow, but checkout is disabled
                          for now.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Professional provider disclosure */}
                <div className="rounded-2xl border border-border bg-background/50 px-4 py-4 text-[11px]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-background">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[12px] font-semibold text-foreground/90">
                          Coinbase facilitates this transfer
                        </p>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">
                          <Info className="h-3.5 w-3.5" />
                          External checkout
                        </span>
                      </div>

                      <p className="mt-1 text-muted-foreground leading-relaxed">
                        When you continue, you&apos;ll complete your payment in
                        a Coinbase-hosted checkout. Coinbase is responsible for
                        payment processing, compliance checks, and transfer
                        execution. Haven does not collect or store your card or
                        banking credentials.
                      </p>

                      <div className="mt-3 grid gap-2">
                        <div className="rounded-2xl border border-border bg-background px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">
                              You&apos;re buying
                            </span>
                            <span className="font-semibold text-foreground">
                              USDC
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Network
                            </span>
                            <span className="font-semibold text-foreground">
                              Solana
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">
                              Destination
                            </span>
                            <span className="font-mono text-foreground/90 truncate max-w-[55%]">
                              {shortAddress(walletAddress)}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-muted-foreground">
                          <div className="font-semibold text-foreground/90">
                            Payment methods
                          </div>
                          <div className="mt-1 leading-relaxed">
                            Credit cards are not supported. Coinbase checkout
                            supports{" "}
                            <span className="text-foreground/90 font-medium">
                              Visa/Mastercard debit
                            </span>{" "}
                            and, where available,{" "}
                            <span className="text-foreground/90 font-medium">
                              existing Coinbase USDC balance
                            </span>
                            .
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-background px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Payment currency
                            </span>
                            <span className="font-semibold text-foreground">
                              {displayCurrency}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <DevEmailGate
                  allowEmails={ONRAMP_ADMIN_EMAILS}
                  title="Bank deposits are temporarily restricted"
                  message="We’re currently in approval/testing. This feature will be enabled for everyone soon."
                  blurPx={14}
                  className="mt-0"
                >
                  <div className="space-y-3">
                    <label className="flex items-start gap-2 rounded-2xl border border-border bg-background/50 px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={coinbaseAcknowledged}
                        onChange={(e) =>
                          setCoinbaseAcknowledged(e.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 accent-primary"
                      />
                      <span className="text-[11px] text-muted-foreground leading-relaxed">
                        I acknowledge that this transfer is facilitated by{" "}
                        <span className="text-foreground/90 font-medium">
                          Coinbase
                        </span>
                        , and I will be redirected to a Coinbase-hosted checkout
                        to complete payment. Haven does not handle card details.
                      </span>
                    </label>

                    {coinbaseError && (
                      <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                        {coinbaseError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={launchCoinbase}
                      disabled={
                        !coinbaseAcknowledged ||
                        coinbaseLaunching ||
                        !canUseOnramp
                      }
                      className={[
                        "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition",
                        "flex items-center justify-center gap-2 border",
                        coinbaseAcknowledged &&
                        !coinbaseLaunching &&
                        canUseOnramp
                          ? "border-primary/25 bg-primary/10 text-foreground hover:bg-primary/15"
                          : "border-border bg-background/50 text-muted-foreground cursor-not-allowed",
                      ].join(" ")}
                    >
                      {coinbaseLaunching ? (
                        <>
                          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                          Opening Coinbase…
                        </>
                      ) : (
                        <>
                          <ExternalLink className="h-4 w-4 text-primary" />
                          Continue to Coinbase
                        </>
                      )}
                    </button>

                    <div className="text-[10px] text-muted-foreground text-center">
                      You&apos;ll complete the payment in Coinbase&apos;s secure
                      checkout.
                    </div>

                    {popupRef.current?.cleanup && (
                      <button
                        type="button"
                        onClick={() => {
                          popupRef.current?.cleanup?.();
                          popupRef.current = null;
                          setCoinbaseLaunching(false);
                        }}
                        className="w-full rounded-2xl border border-border bg-background/50 px-4 py-2.5 text-[11px] text-muted-foreground hover:bg-accent transition"
                      >
                        Close Coinbase window
                      </button>
                    )}
                  </div>
                </DevEmailGate>

                <div className="rounded-2xl border border-border bg-background/50 px-3 py-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Current balance
                    </span>
                    <span className="font-semibold text-primary">
                      ${cleanNumber(balanceUsd).toFixed(2)}
                    </span>
                  </div>
                </div>
              </TabsContent>

              {/* Crypto deposit tab */}
              <TabsContent value="crypto" className="mt-2 space-y-4">
                <div className="haven-card-soft px-4 py-4 text-[11px]">
                  <p className="mb-2 font-medium text-foreground/90">
                    Deposit USDC from another wallet or exchange
                  </p>

                  <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                    <li>
                      In your exchange or wallet, choose{" "}
                      <span className="text-foreground/90 font-medium">
                        Withdraw / Send
                      </span>
                      .
                    </li>
                    <li>
                      Select{" "}
                      <span className="text-foreground/90 font-medium">
                        USDC
                      </span>{" "}
                      as the token.
                    </li>
                    <li>
                      Choose the{" "}
                      <span className="text-foreground/90 font-medium">
                        Solana network
                      </span>{" "}
                      (important).
                    </li>
                    <li>
                      Paste your{" "}
                      <span className="text-foreground/90 font-medium">
                        Haven deposit address
                      </span>{" "}
                      below or scan the QR code.
                    </li>
                    <li>Confirm the transfer.</li>
                  </ol>

                  <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    <span className="font-semibold">Important:</span> Only send{" "}
                    <span className="font-semibold">USDC on Solana</span>.
                    Sending USDC on other networks may result in permanent loss
                    of funds.
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)]">
                  <div className="haven-card-soft px-4 py-4">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Your Haven deposit address
                    </p>

                    <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-background/50 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-xs font-mono text-foreground/90">
                          {walletAddress}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Solana • {shortAddress(walletAddress)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopy}
                        className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold transition border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {copied ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </>
                          )}
                        </span>
                      </button>
                    </div>

                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Use this address to receive USDC on Solana.
                    </p>

                    <div className="mt-3 rounded-2xl border border-border bg-background/50 px-3 py-2 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Current balance
                        </span>
                        <span className="font-semibold text-primary">
                          ${cleanNumber(balanceUsd).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="haven-card-soft flex flex-col items-center justify-center gap-2 px-4 py-4">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Scan to deposit
                    </p>

                    <div className="rounded-2xl bg-white p-2 shadow-[0_0_24px_rgba(0,0,0,0.35)]">
                      <QRCodeSVG
                        value={solanaAddressUri}
                        size={124}
                        level="M"
                      />
                    </div>

                    <p className="text-[10px] text-muted-foreground text-center">
                      Scan from another Solana wallet to fill in the address.
                    </p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* ✅ FOOTER (pinned) */}
          <div className="p-5 pt-4 border-t border-border/60">
            <button
              type="button"
              className="haven-btn-primary w-full"
              onClick={close}
              disabled={coinbaseLaunching}
            >
              Done
            </button>

            <div className="mt-2 text-center text-[11px] text-muted-foreground">
              Need help? Only deposit{" "}
              <span className="font-semibold">USDC</span> on{" "}
              <span className="font-semibold">Solana</span>.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default Deposit;
