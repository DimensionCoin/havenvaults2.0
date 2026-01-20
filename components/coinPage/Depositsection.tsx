"use client";

import React, { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  QrCode,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { WalletQRCode } from "./Walletqrcode";

type DepositSectionProps = {
  symbol: string;
  ownerBase58: string;
  showDeposit: boolean;
  onShowDepositChange: (show: boolean) => void;
};

export function DepositSection({
  symbol,
  ownerBase58,
  showDeposit,
  onShowDepositChange,
}: DepositSectionProps) {
  const [addressCopied, setAddressCopied] = useState(false);

  const copyAddress = useCallback(async () => {
    if (!ownerBase58) return;
    try {
      await navigator.clipboard.writeText(ownerBase58);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = ownerBase58;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    }
  }, [ownerBase58]);

  return (
    <section className="mt-4">
      <div className="haven-card-soft px-3 py-3 sm:px-4 sm:py-4">
        <button
          type="button"
          onClick={() => onShowDepositChange(!showDeposit)}
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border bg-primary/10">
              <QrCode className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground">
                Deposit {symbol || "tokens"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Transfer from another wallet or exchange
              </p>
            </div>
          </div>
          {showDeposit ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </button>

        {showDeposit && (
          <div className="mt-4 space-y-4">
            {/* Warning banner */}
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="text-[12px]">
                <p className="font-semibold text-foreground">Important</p>
                <p className="mt-1 text-muted-foreground">
                  Only send{" "}
                  <span className="font-semibold text-foreground">
                    {symbol || "this token"}
                  </span>{" "}
                  to this address. Sending other tokens or using the wrong
                  network will result in{" "}
                  <span className="font-semibold text-destructive">
                    permanent loss
                  </span>
                  .
                </p>
              </div>
            </div>

            {/* QR Code and Address */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* QR Code */}
              <div className="flex flex-col items-center rounded-2xl border bg-card/60 px-4 py-4">
                <p className="mb-3 text-[11px] font-medium text-muted-foreground">
                  Scan with your wallet app
                </p>
                {ownerBase58 ? (
                  <div className="rounded-xl bg-white p-3">
                    <WalletQRCode value={ownerBase58} size={140} />
                  </div>
                ) : (
                  <div className="flex h-[164px] w-[164px] items-center justify-center rounded-xl border bg-muted/20">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Works with Phantom, Solflare, and others
                </p>
              </div>

              {/* Address details */}
              <div className="space-y-3">
                <div className="rounded-2xl border bg-card/60 px-3 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Your deposit address
                    </p>
                    <button
                      type="button"
                      onClick={copyAddress}
                      disabled={!ownerBase58}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-card/80 px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
                    >
                      {addressCopied ? (
                        <>
                          <Check className="h-3 w-3 text-primary" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="mt-2 rounded-xl border bg-muted/20 px-3 py-2">
                    <p className="break-all font-mono text-[11px] text-foreground">
                      {ownerBase58 || "Loading..."}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border bg-card/60 px-3 py-3">
                  <p className="text-[11px] font-semibold text-foreground">
                    How to deposit
                  </p>
                  <ol className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="font-semibold text-primary">1.</span>
                      <span>Open your wallet app or exchange</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-semibold text-primary">2.</span>
                      <span>
                        Select{" "}
                        <span className="font-semibold text-foreground">
                          {symbol || "the token"}
                        </span>{" "}
                        and tap Send
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-semibold text-primary">3.</span>
                      <span>Scan the QR code or paste the address above</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-semibold text-primary">4.</span>
                      <span>Confirm and wait a few seconds</span>
                    </li>
                  </ol>
                </div>

                {ownerBase58 && (
                  <a
                    href={`https://solscan.io/account/${ownerBase58}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-2xl border bg-card/60 px-4 py-2.5 text-[11px] font-medium text-foreground transition hover:bg-secondary"
                  >
                    <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                    View transaction history
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
