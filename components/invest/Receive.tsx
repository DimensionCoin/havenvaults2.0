// components/invest/Receive.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

type ReceiveProps = {
  walletAddress: string;
  onSuccess?: () => void | Promise<void>;
};

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const Receive: React.FC<ReceiveProps> = ({ walletAddress, onSuccess }) => {
  const [copied, setCopied] = useState(false);

  const solanaAddressUri = useMemo(
    () => `solana:${walletAddress}`,
    [walletAddress]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      if (onSuccess) await onSuccess();
    } catch (e) {
      console.error("[Receive] Failed to copy address:", e);
    }
  };

  return (
    <DrawerContent
      className="
        border-t border-zinc-800 bg-[#03180051] backdrop-blur-xl text-zinc-50
        flex flex-col
        max-h-[90vh]
      "
    >
      <DrawerHeader className="shrink-0">
        <DrawerTitle className="text-base font-semibold">
          Receive tokens
        </DrawerTitle>
        <DrawerDescription className="text-[10px] text-zinc-400">
          Share your Solana address to receive SOL or any SPL token from another
          wallet or an exchange.
        </DrawerDescription>
      </DrawerHeader>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Instructions */}
        <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-3 text-[11px]">
          <p className="mb-2 font-medium text-zinc-100">
            How to send to your Haven wallet
          </p>

          <div className="space-y-3 text-zinc-400">
            <div>
              <p className="mb-1 font-medium text-zinc-200">
                From another Solana wallet (Phantom, Solflare, etc.)
              </p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Tap <span className="text-zinc-100 font-medium">Send</span>.
                </li>
                <li>
                  Choose the token you want to send (SOL / USDC / any SPL
                  token).
                </li>
                <li>
                  Scan the QR code or paste your{" "}
                  <span className="text-zinc-100 font-medium">
                    Haven wallet address
                  </span>
                  .
                </li>
                <li>Enter the amount and confirm the transaction.</li>
              </ol>
            </div>

            <div>
              <p className="mb-1 font-medium text-zinc-200">
                From an exchange (Coinbase, Binance, Kraken, etc.)
              </p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Go to{" "}
                  <span className="text-zinc-100 font-medium">Withdraw</span> /{" "}
                  <span className="text-zinc-100 font-medium">Send</span>.
                </li>
                <li>Select the token you want to withdraw (ex: USDC, SOL).</li>
                <li>
                  Choose the{" "}
                  <span className="text-zinc-100 font-medium">
                    Solana network
                  </span>{" "}
                  (sometimes shown as
                  <span className="text-zinc-100 font-medium">
                    {" "}
                    SOL
                  </span> or{" "}
                  <span className="text-zinc-100 font-medium">SPL</span>).
                </li>
                <li>Paste your Haven wallet address below as the recipient.</li>
                <li>
                  If the exchange asks for a{" "}
                  <span className="text-zinc-100 font-medium">memo</span>, leave
                  it blank (your wallet doesn’t use memos).
                </li>
                <li>
                  Confirm the withdrawal. It may take a few minutes to arrive.
                </li>
              </ol>
            </div>

            <p className="text-[10px] text-amber-300/80">
              Warning: Only send assets on the{" "}
              <span className="font-semibold text-amber-200">
                Solana network
              </span>
              . Sending from other networks (Ethereum, Base, BSC, Polygon, etc.)
              to this address can result in permanent loss of funds.
            </p>
          </div>
        </div>

        {/* Address + QR */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)]">
          {/* Address + copy */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-zinc-300">
              Your Haven wallet address
            </p>

            <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-zinc-100">
                  {walletAddress}
                </p>
                <p className="mt-1 text-[10px] text-zinc-500">
                  Solana • {shortAddress(walletAddress)}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/20 transition"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <p className="text-[11px] text-zinc-500">
              Share this address with anyone who wants to send you tokens on
              Solana.
            </p>

            <div className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 text-[11px]">
              <p className="text-zinc-400">
                Tip: If you don’t see a token after it’s sent, pull to refresh
                your balance or reopen the app.
              </p>
            </div>
          </div>

          {/* QR code */}
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-black/30 px-3 py-3">
            <p className="mb-1 text-[11px] font-medium text-zinc-300">
              Scan to send
            </p>
            <div className="rounded-xl bg-white p-2 shadow-[0_0_24px_rgba(0,0,0,0.7)]">
              <QRCodeSVG
                value={solanaAddressUri}
                size={120}
                includeMargin={false}
                level="M"
              />
            </div>
            <p className="mt-1 text-center text-[10px] text-zinc-500">
              Scanning this from a Solana wallet should autofill your Haven
              address.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <DrawerFooter className="shrink-0 border-t border-zinc-800 bg-black/20">
        <DrawerClose asChild>
          <Button
            variant="outline"
            className="w-full border-zinc-700 text-zinc-100"
          >
            Done
          </Button>
        </DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  );
};

export default Receive;
