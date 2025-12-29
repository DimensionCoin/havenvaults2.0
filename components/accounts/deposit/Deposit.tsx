// components/accounts/deposit/Deposit.tsx
"use client";

import React, { useState } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QRCodeSVG } from "qrcode.react";

type DepositProps = {
  walletAddress: string;
  balanceUsd: number;
  onSuccess?: () => void | Promise<void>;
};

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const Deposit: React.FC<DepositProps> = ({
  walletAddress,
  balanceUsd,
  onSuccess,
}) => {
  const [tab, setTab] = useState<"crypto" | "onramp">("crypto");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      if (onSuccess) {
        onSuccess();
      }
    } catch (e) {
      console.error("[Deposit] Failed to copy address:", e);
    }
  };

  const solanaAddressUri = `solana:${walletAddress}`;

  return (
    <DrawerContent
      className="
        border-t border-zinc-800 bg-[#03180051] backdrop-blur-xl text-zinc-50
        flex flex-col
        max-h-[90vh]          /* ⬅️ drawer won't exceed viewport */
      "
    >
      <DrawerHeader className="shrink-0">
        <DrawerTitle className="text-base font-semibold">
          Deposit funds
        </DrawerTitle>
        <DrawerDescription className="text-[10px] text-zinc-400">
          Move USDC into your Haven deposit account from an exchange or another
          Solana wallet.
        </DrawerDescription>
      </DrawerHeader>

      {/* Scrollable body */}
      <div className="px-4 pb-4 flex-1 overflow-y-auto">
        <Tabs
          value={tab}
          onValueChange={(val) => setTab(val as "crypto" | "onramp")}
        >
          <TabsList className="mb-3 grid w-full grid-cols-2 rounded-xl bg-black p-1">
            <TabsTrigger
              value="crypto"
              className="
                text-xs rounded-lg px-3 py-1.5 transition-colors
                bg-transparent text-zinc-400
                data-[state=active]:!bg-emerald-500
                data-[state=active]:!text-black
                data-[state=active]:shadow-[0_0_10px_rgba(52,211,153,0.7)]
              "
            >
              Crypto deposit
            </TabsTrigger>

            <TabsTrigger
              value="onramp"
              className="
                text-xs rounded-lg px-3 py-1.5 transition-colors
                bg-transparent text-zinc-400
                data-[state=active]:!bg-emerald-500
                data-[state=active]:!text-black
                data-[state=active]:shadow-[0_0_10px_rgba(52,211,153,0.7)]
              "
            >
              On-ramp
            </TabsTrigger>
          </TabsList>

          {/* ===== Crypto deposit tab ===== */}
          <TabsContent value="crypto" className="mt-2 space-y-4">
            {/* “How to deposit” helper card */}
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-3 text-[11px]">
              <p className="mb-2 font-medium text-zinc-100">
                How to deposit USDC to Haven
              </p>
              <ol className="space-y-1 text-zinc-400 list-decimal list-inside">
                <li>
                  Go to your exchange or wallet and choose{" "}
                  <span className="text-zinc-100 font-medium">Withdraw</span>.
                </li>
                <li>
                  Select <span className="text-zinc-100 font-medium">USDC</span>{" "}
                  as the token.
                </li>
                <li>
                  Make sure the{" "}
                  <span className="text-zinc-100 font-medium">
                    Solana network
                  </span>{" "}
                  is selected (not Ethereum, Base, etc).
                </li>
                <li>
                  Paste or scan your{" "}
                  <span className="text-zinc-100 font-medium">
                    Haven wallet address
                  </span>{" "}
                  below as the recipient.
                </li>
                <li>
                  Choose the amount of USDC you want to send and confirm the
                  withdrawal.
                </li>
              </ol>
              <p className="mt-2 text-[10px] text-amber-300/80">
                Warning: Only send USDC on the{" "}
                <span className="font-semibold text-amber-200">
                  Solana network
                </span>
                . Sending assets on other networks to this address will result
                in a loss of funds.
              </p>
            </div>

            {/* Address + copy + QR */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)]">
              {/* Address + copy */}
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-zinc-300">
                  Your Haven deposit address
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-mono text-zinc-100">
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
                  You can share this address with anyone who wants to send you
                  USDC on Solana.
                </p>

                <div className="mt-2 rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Current USDC balance</span>
                    <span className="font-semibold text-emerald-300">
                      ~{balanceUsd.toFixed(2)} USDC
                    </span>
                  </div>
                </div>
              </div>

              {/* QR code */}
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-black/30 px-3 py-3">
                <p className="text-[11px] font-medium text-zinc-300 mb-1">
                  Scan to deposit
                </p>
                <div className="rounded-xl bg-white p-2 shadow-[0_0_24px_rgba(0,0,0,0.7)]">
                  <QRCodeSVG
                    value={solanaAddressUri}
                    size={120} // slightly smaller to help on tiny screens
                    includeMargin={false}
                    level="M"
                  />
                </div>
                <p className="text-[10px] text-zinc-500 text-center mt-1">
                  Scan this code from another Solana wallet. It will fill in
                  your Haven address automatically.
                </p>
              </div>
            </div>
          </TabsContent>

          {/* ===== On-ramp tab ===== */}
          <TabsContent value="onramp" className="mt-4">
            <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-4 text-[11px] text-zinc-400">
              <p className="font-medium text-zinc-100 mb-1">
                Card & bank on-ramp (coming soon)
              </p>
              <p className="mb-2">
                Soon you’ll be able to purchase USDC directly with your card or
                bank account and have it land right in your Haven deposit
                account.
              </p>
              <p>
                For now, you can deposit by sending USDC on the{" "}
                <span className="font-semibold text-zinc-100">Solana</span>{" "}
                network from an exchange or another wallet using the{" "}
                <span className="font-semibold text-zinc-100">
                  Crypto deposit
                </span>{" "}
                tab.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      
    </DrawerContent>
  );
};

export default Deposit;
