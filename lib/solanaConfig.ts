// lib/solanaConfig.ts
export type SolanaNetwork = "devnet" | "mainnet" | "localnet" | "other";

const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
const networkEnv = process.env.NEXT_PUBLIC_SOLANA_NETWORK;

// Fail fast if misconfigured (optional but recommended on server side)
if (!rpcUrl) {
  // On the client this will just be ignored, but on the server it helps catch misconfig early
  console.warn(
    "[solanaConfig] Missing NEXT_PUBLIC_SOLANA_RPC_URL. Falling back to devnet."
  );
}

export const SOLANA_RPC_URL: string = rpcUrl || "https://api.devnet.solana.com";

// Optional: a derived network flag for UI / analytics
export const SOLANA_NETWORK: SolanaNetwork =
  (networkEnv as SolanaNetwork) ||
  (SOLANA_RPC_URL.includes("devnet")
    ? "devnet"
    : SOLANA_RPC_URL.includes("mainnet")
    ? "mainnet"
    : "other");
