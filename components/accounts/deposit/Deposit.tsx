"use client";

// components/accounts/deposit/Deposit.tsx
import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { QRCodeSVG } from "qrcode.react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { useUser } from "@/providers/UserProvider";

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
  url?: string;
  one_click_buy_url?: string;
  redirectUrl?: string;
  error?: string;
  code?: string;
};

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function openCoinbasePopup(
  url: string,
  opts?: { onClosed?: () => void }
): { type: "popup" | "redirect"; cleanup?: () => void } {
  const mobile = isMobileDevice();

  // Mobile: popups are unreliable → do a normal redirect
  if (mobile) {
    window.location.assign(url);
    return { type: "redirect" };
  }

  // Desktop popup
  const width = 460;
  const height = 720;

  const dualScreenLeft =
    window.screenLeft !== undefined ? window.screenLeft : window.screenX;
  const dualScreenTop =
    window.screenTop !== undefined ? window.screenTop : window.screenY;

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
    ].join(",")
  );

  // Popup blocked → fallback to redirect
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

  const [tab, setTab] = useState<"onramp" | "crypto">("onramp");
  const [copied, setCopied] = useState(false);

  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  // ✅ Onramp consent + popup
  const [coinbaseConsent, setCoinbaseConsent] = useState(false);
  const [coinbaseLaunching, setCoinbaseLaunching] = useState(false);
  const [coinbaseError, setCoinbaseError] = useState<string | null>(null);

  const popupRef = useRef<{ cleanup?: () => void } | null>(null);

  // ✅ UI admin gating (server already blocks too)
  const myEmail = "nick.vassallo97@gmail.com";
  const userEmail = String(user?.email || "")
    .trim()
    .toLowerCase();
  const isAdmin = userEmail === myEmail;

  // If non-admin, force them onto crypto tab and keep them there
  useEffect(() => {
    if (!isAdmin && tab === "onramp") setTab("crypto");
    // also clear consent state so nothing weird persists
    if (!isAdmin) setCoinbaseConsent(false);
  }, [isAdmin, tab]);

  useEffect(() => {
    // cleanup popup on unmount
    return () => {
      popupRef.current?.cleanup?.();
      popupRef.current = null;
    };
  }, []);

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
    // ✅ hard UI stop (server will also stop)
    if (!isAdmin) {
      setCoinbaseError("Onramp is temporarily disabled.");
      return;
    }
    if (!coinbaseConsent) return;

    setCoinbaseError(null);
    setCoinbaseLaunching(true);

    try {
      const res = await fetch("/api/onramp/session", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          destinationAddress: walletAddress,
          purchaseCurrency: "USDC",
          destinationNetwork: "solana",
          paymentCurrency: displayCurrency,
          sandbox: false,
          country: "CA",
        }),
      });

      const text = await res.text().catch(() => "");
      let data: OnrampSessionResponse = {};
      try {
        data = text ? (JSON.parse(text) as OnrampSessionResponse) : {};
      } catch {}

      if (!res.ok) {
        // Show server’s disable message nicely
        const serverMsg =
          data?.error ||
          (text && text.length < 180 ? text : "") ||
          `Failed to create Coinbase session (HTTP ${res.status})`;
        throw new Error(serverMsg);
      }

      const url = data.url || data.one_click_buy_url || data.redirectUrl || "";
      if (!url) throw new Error("Missing Coinbase redirect URL");

      // Close any previous popup before opening a new one
      popupRef.current?.cleanup?.();
      popupRef.current = null;

      const result = openCoinbasePopup(url, {
        onClosed: async () => {
          await handleOnrampSuccess();
        },
      });

      popupRef.current = result;

      // If redirect (mobile or popup blocked), stop spinner (navigation happens anyway)
      if (result.type === "redirect") {
        setCoinbaseLaunching(false);
      }
    } catch (e: unknown) {
      console.error("[Deposit] Coinbase launch failed:", e);
      setCoinbaseError(
        e instanceof Error
          ? e.message
          : "Couldn’t open Coinbase right now."
      );
      setCoinbaseLaunching(false);
    }
  }, [
    isAdmin,
    coinbaseConsent,
    displayCurrency,
    walletAddress,
    handleOnrampSuccess,
  ]);

  const solanaAddressUri = `solana:${walletAddress}`;

  // Optional: a nicer, consistent label when blocked
  const onrampBlockedMessage = useMemo(() => {
    return (
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
        Onramp is temporarily disabled while we complete Coinbase approval.
        Crypto deposits are still available.
      </div>
    );
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          "p-0 overflow-hidden flex flex-col",
          "border border-border bg-card text-card-foreground text-foreground shadow-fintech-lg",
          "sm:w-[min(92vw,520px)] sm:max-w-[520px]",
          "sm:max-h-[90vh] sm:rounded-[28px]",
          "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
          "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
          "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",
        ].join(" ")}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar overscroll-contain px-3 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] sm:px-5 sm:pb-5 sm:pt-5">
            <DialogHeader className="pb-3">
              <DialogTitle className="text-base font-semibold">
                Deposit funds
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[11px] text-muted-foreground">
                Move USDC into your Haven deposit account.
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={tab}
              onValueChange={(val) => setTab(val as "onramp" | "crypto")}
            >
              <TabsList className="mb-3 grid w-full grid-cols-2 rounded-2xl border border-border bg-background/40 p-1">
                <TabsTrigger
                  value="onramp"
                  // ✅ block the tab for everyone except you
                  disabled={!isAdmin}
                  className={[
                    "text-xs rounded-xl px-3 py-2 transition-colors",
                    "bg-transparent text-muted-foreground",
                    "data-[state=active]:!bg-primary data-[state=active]:!text-black",
                    "data-[state=active]:shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                    !isAdmin ? "opacity-50 cursor-not-allowed" : "",
                  ].join(" ")}
                  title={!isAdmin ? "Onramp temporarily disabled" : undefined}
                >
                  Bank deposit
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
                  Crypto deposit
                </TabsTrigger>
              </TabsList>

              {/* ===== Bank deposit tab ===== */}
              <TabsContent value="onramp" className="mt-2 space-y-3">
                {/* ✅ Even if somehow shown, keep it blocked */}
                {!isAdmin ? (
                  <div className="haven-card-soft px-3.5 py-3.5 text-[11px]">
                    <p className="font-medium text-foreground/90">
                      Bank deposits temporarily unavailable
                    </p>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      We’re completing Coinbase approval. Please use Crypto
                      deposit for now.
                    </p>
                    <div className="mt-3">{onrampBlockedMessage}</div>
                  </div>
                ) : (
                  <>
                    <div className="haven-card-soft px-3.5 py-3.5 text-[11px]">
                      <p className="font-medium text-foreground/90">
                        Buy USDC with Coinbase
                      </p>

                      <p className="mt-1 text-muted-foreground leading-relaxed">
                        Haven will open Coinbase in a secure checkout window.
                        Coinbase is the provider that facilitates the payment
                        and purchase of USDC. Haven never stores your card or
                        bank details.
                      </p>

                      <div className="mt-3 rounded-2xl border border-border bg-background/40 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            You’re buying
                          </span>
                          <span className="font-semibold text-foreground">
                            USDC
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Payment currency
                          </span>
                          <span className="font-semibold text-foreground">
                            {displayCurrency}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">
                            Destination wallet
                          </span>
                          <span className="font-mono text-foreground/90 truncate max-w-[52%]">
                            {shortAddress(walletAddress)}
                          </span>
                        </div>
                      </div>

                      <label className="mt-3 flex items-start gap-2 rounded-2xl border border-border bg-background/40 px-3 py-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={coinbaseConsent}
                          onChange={(e) => setCoinbaseConsent(e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-primary"
                        />
                        <span className="text-[11px] text-muted-foreground leading-relaxed">
                          I understand Haven will link me to Coinbase, and
                          Coinbase is the provider facilitating this
                          transaction.
                        </span>
                      </label>

                      {coinbaseError ? (
                        <div className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
                          {coinbaseError}
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={launchCoinbase}
                        disabled={!coinbaseConsent || coinbaseLaunching}
                        className={[
                          "mt-3 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition",
                          "flex items-center justify-center gap-2",
                          "border border-[#0052FF]/30 bg-[#0052FF]/10 text-[#9bb4ff]",
                          "hover:bg-[#0052FF]/15 hover:border-[#0052FF]/45",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                          "shadow-[0_10px_26px_rgba(0,82,255,0.14)]",
                        ].join(" ")}
                      >
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#0052FF]" />
                        {coinbaseLaunching
                          ? "Opening Coinbase…"
                          : "Continue to Coinbase"}
                      </button>

                      {popupRef.current?.cleanup ? (
                        <button
                          type="button"
                          onClick={() => {
                            popupRef.current?.cleanup?.();
                            popupRef.current = null;
                            setCoinbaseLaunching(false);
                          }}
                          className="mt-2 w-full rounded-2xl border border-border bg-background/40 px-4 py-2 text-[11px] text-muted-foreground hover:bg-accent transition"
                        >
                          Close Coinbase window
                        </button>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-border bg-background/40 px-3 py-2 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Current balance
                        </span>
                        <span className="font-semibold text-primary">
                          ${cleanNumber(balanceUsd).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* ===== Crypto deposit tab (unchanged) ===== */}
              <TabsContent value="crypto" className="mt-2 space-y-4">
                <div className="haven-card-soft px-3.5 py-3.5 text-[11px]">
                  <p className="mb-2 font-medium text-foreground/90">
                    How to deposit USDC to Haven
                  </p>

                  <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                    <li>
                      Go to your exchange or wallet and choose{" "}
                      <span className="text-foreground/90 font-medium">
                        Withdraw
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
                      Make sure the{" "}
                      <span className="text-foreground/90 font-medium">
                        Solana network
                      </span>{" "}
                      is selected.
                    </li>
                    <li>
                      Paste or scan your{" "}
                      <span className="text-foreground/90 font-medium">
                        Haven deposit address
                      </span>{" "}
                      below.
                    </li>
                    <li>Choose an amount and confirm.</li>
                  </ol>

                  <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">
                    Warning: Only send USDC on{" "}
                    <span className="font-semibold">Solana</span>. Other
                    networks will result in loss of funds.
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)]">
                  <div className="haven-card-soft px-3.5 py-3.5">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Your Haven deposit address
                    </p>

                    <div className="mt-2 flex items-center gap-2 rounded-2xl border border-border bg-background/40 px-3 py-2">
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
                        className={[
                          "shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold transition",
                          "border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15",
                        ].join(" ")}
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>

                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Share this address to receive USDC on Solana.
                    </p>

                    <div className="mt-3 rounded-2xl border border-border bg-background/40 px-3 py-2 text-[11px]">
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

                  <div className="haven-card-soft flex flex-col items-center justify-center gap-2 px-3.5 py-3.5">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Scan to deposit
                    </p>

                    <div className="rounded-2xl bg-white p-2 shadow-[0_0_24px_rgba(0,0,0,0.35)]">
                      <QRCodeSVG
                        value={solanaAddressUri}
                        size={124}
                        includeMargin={false}
                        level="M"
                      />
                    </div>

                    <p className="text-[10px] text-muted-foreground text-center">
                      Scan from another Solana wallet to fill in your address.
                    </p>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="shrink-0 border-t border-border bg-card/95 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+14px)] sm:px-5 sm:pb-5">
            <button
              type="button"
              className="haven-btn-primary"
              onClick={() => onOpenChange(false)}
            >
              Done
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Deposit;
