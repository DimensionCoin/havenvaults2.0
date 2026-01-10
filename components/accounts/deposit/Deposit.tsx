"use client";

// components/accounts/deposit/Deposit.tsx
import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

const Deposit: React.FC<DepositProps> = ({
  open,
  onOpenChange,
  walletAddress,
  balanceUsd,
  onSuccess,
}) => {
  // ✅ Bank transfer first + default
  const [tab, setTab] = useState<"onramp" | "crypto">("onramp");
  const [copied, setCopied] = useState(false);

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

  const solanaAddressUri = `solana:${walletAddress}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          "p-0 overflow-hidden flex flex-col",
          // Haven surfaces + border
          "border border-border bg-card text-card-foreground text-foreground shadow-fintech-lg",

          // Desktop sizing
          "sm:w-[min(92vw,520px)] sm:max-w-[520px]",
          "sm:max-h-[90vh] sm:rounded-[28px]",

          // Mobile fullscreen
          "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
          "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
          "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",
        ].join(" ")}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Scrollable body */}
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
              {/* ✅ Bank transfer FIRST */}
              <TabsList className="mb-3 grid w-full grid-cols-2 rounded-2xl border border-border bg-background/40 p-1">
                <TabsTrigger
                  value="onramp"
                  className={[
                    "text-xs rounded-xl px-3 py-2 transition-colors",
                    "bg-transparent text-muted-foreground",
                    "data-[state=active]:!bg-primary data-[state=active]:!text-primary-foreground",
                    "data-[state=active]:shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                  ].join(" ")}
                >
                  Bank transfer
                </TabsTrigger>

                <TabsTrigger
                  value="crypto"
                  className={[
                    "text-xs rounded-xl px-3 py-2 transition-colors",
                    "bg-transparent text-muted-foreground",
                    "data-[state=active]:!bg-primary data-[state=active]:!text-primary-foreground",
                    "data-[state=active]:shadow-[0_0_18px_rgba(16,185,129,0.25)]",
                  ].join(" ")}
                >
                  Crypto deposit
                </TabsTrigger>
              </TabsList>

              {/* ===== Bank transfer tab ===== */}
              <TabsContent value="onramp" className="mt-2 space-y-3">
                <div className="haven-card-soft px-3.5 py-3.5 text-[11px]">
                  <p className="font-medium text-foreground/90 mb-1">
                    Bank transfer (coming soon)
                  </p>
                  <p className="text-muted-foreground">
                    Soon you’ll be able to deposit USDC with a bank transfer and
                    have it land directly in your Haven deposit account.
                  </p>

                  <div className="mt-3 rounded-2xl border border-border bg-background/40 px-3 py-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        Current balance
                      </span>
                      <span className="font-semibold text-primary">
                        ${cleanNumber(balanceUsd).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <p className="mt-3 text-[10px] text-muted-foreground">
                    Until then, use{" "}
                    <span className="font-semibold text-foreground/90">
                      Crypto deposit
                    </span>{" "}
                    to send USDC on Solana.
                  </p>
                </div>
              </TabsContent>

              {/* ===== Crypto deposit tab ===== */}
              <TabsContent value="crypto" className="mt-2 space-y-4">
                {/* Helper card */}
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

                {/* Address + QR */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)]">
                  {/* Address + copy */}
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

                  {/* QR */}
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

          {/* Pinned footer (optional, matches Transfer feel) */}
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
