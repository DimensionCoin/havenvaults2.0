// providers/PrivyProvider.tsx
"use client";

import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const SOLANA_RPC_HTTP =
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

const SOLANA_NETWORK =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet" ? "mainnet" : "devnet";

const SOLANA_CHAIN_ID =
  SOLANA_NETWORK === "mainnet" ? "solana:mainnet" : "solana:devnet";

const SOLANA_RPC_WS = SOLANA_RPC_HTTP.startsWith("https://")
  ? SOLANA_RPC_HTTP.replace("https://", "wss://")
  : SOLANA_RPC_HTTP.startsWith("http://")
  ? SOLANA_RPC_HTTP.replace("http://", "ws://")
  : SOLANA_RPC_HTTP;

export default function PrivyProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        // No "wallet" login button (CEX feel)
        loginMethods: ["email", "google"],

        appearance: {
          walletChainType: "solana-only",
          showWalletLoginFirst: false,
        },

        // ✅ Key: hide Privy wallet confirmation modals for signing/sending
        embeddedWallets: {
          solana: {},
          showWalletUIs: false,
        },

        // Required for embedded wallet signing flows
        solana: {
          rpcs: {
            [SOLANA_CHAIN_ID]: {
              rpc: createSolanaRpc(SOLANA_RPC_HTTP),
              rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_RPC_WS),
            },
          },
        },

        // If you truly don’t want users using Phantom/etc, omit this entirely.
        // externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
