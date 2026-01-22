// hooks/useSponsoredExternalTransferV2.ts
"use client";

/**
 * Sponsored USDC Transfer to External Wallets
 *
 * This hook enables sending USDC to:
 * - Raw Solana wallet addresses
 * - .sol domains (SNS - Solana Name Service)
 *
 * Gas fees are sponsored by Haven. A USDC fee is charged on top of the transfer amount.
 *
 * Dependencies:
 * - @bonfida/spl-name-service (for .sol domain resolution)
 *
 * Install: npm install @bonfida/spl-name-service
 */

import { useCallback, useState } from "react";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { useWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { Buffer } from "buffer";

/* ─── Types ───────────────────────────────────────────── */

export type ExternalTransferParams = {
  fromOwnerBase58: string;
  toAddressOrDomain: string;
  amountUi: number;
  memo?: string;
};

export type ExternalTransferResult = {
  signature: string;
  resolvedAddress: string;
  inputAddress: string;
  amountUi: number;
  feeUi: number;
};

export type ResolvedAddress = {
  address: string;
  isDomain: boolean;
  domain?: string;
};

/* ─── Config ──────────────────────────────────────────── */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl("devnet");
const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);
const HAVEN_FEEPAYER = new PublicKey(
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!,
);
const TREASURY_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!,
);
const DECIMALS = 6;

const FEE_USDC: number = (() => {
  const raw =
    process.env.NEXT_PUBLIC_EXTERNAL_TRANSFER_FEE_USDC ??
    process.env.NEXT_PUBLIC_TRANSFER_FEE_USDC ??
    "1.5";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1.5;
})();

/* ─── Lazy load SNS SDK ──────────────────────────────── */

let snsModule: typeof import("@bonfida/spl-name-service") | null = null;

async function getSnsModule() {
  if (!snsModule) {
    try {
      snsModule = await import("@bonfida/spl-name-service");
    } catch {
      throw new Error(
        "SNS module not available. Install @bonfida/spl-name-service to use .sol domains.",
      );
    }
  }
  return snsModule;
}

/* ─── Domain Resolution ──────────────────────────────── */

async function resolveSolDomain(
  conn: Connection,
  domain: string,
): Promise<string | null> {
  try {
    const sns = await getSnsModule();
    const name = domain.toLowerCase().replace(/\.sol$/, "");

    // Get the domain key
    const { pubkey } = await sns.getDomainKeySync(name);

    // Get the name registry (contains the owner)
    const { registry } = await sns.NameRegistryState.retrieve(conn, pubkey);

    if (!registry.owner || registry.owner.equals(PublicKey.default)) {
      return null;
    }

    return registry.owner.toBase58();
  } catch (err) {
    console.warn(`[resolveSolDomain] Failed to resolve ${domain}:`, err);
    return null;
  }
}

/* ─── Fallback resolution using public API ───────────── */

async function resolveSolDomainViaApi(domain: string): Promise<string | null> {
  try {
    const name = domain.toLowerCase().replace(/\.sol$/, "");

    // Try Bonfida's public API
    const response = await fetch(
      `https://sns-sdk-proxy.bonfida.workers.dev/resolve/${name}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );

    if (response.ok) {
      const data = await response.json();
      if (data?.result) {
        return data.result;
      }
    }
  } catch {
    // Silently fail, caller will handle
  }

  return null;
}

/* ─── Combined resolution with fallback ──────────────── */

async function resolveAddressOrDomain(
  conn: Connection,
  input: string,
): Promise<ResolvedAddress | null> {
  const trimmed = input.trim();

  // Check if it's a valid Solana address
  try {
    new PublicKey(trimmed);
    return { address: trimmed, isDomain: false };
  } catch {
    // Not a valid address, continue to domain resolution
  }

  // Check if it's a .sol domain
  if (!/^[a-zA-Z0-9_-]+\.sol$/i.test(trimmed)) {
    return null;
  }

  // Try on-chain resolution first
  let resolved = await resolveSolDomain(conn, trimmed).catch(() => null);

  // Fallback to API if on-chain fails
  if (!resolved) {
    resolved = await resolveSolDomainViaApi(trimmed);
  }

  if (!resolved) {
    return null;
  }

  return {
    address: resolved,
    isDomain: true,
    domain: trimmed.toLowerCase(),
  };
}

/* ─── Token program detection ────────────────────────── */

async function detectTokenProgramId(
  conn: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("USDC mint not found");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ─── Hook ─────────────────────────────────────────────── */

export function useSponsoredExternalTransfer() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [lastResult, setLastResult] = useState<ExternalTransferResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  /**
   * Validate and resolve an address or domain without sending.
   * Useful for real-time input validation in UI.
   */
  const validateAndResolve = useCallback(
    async (input: string): Promise<ResolvedAddress | null> => {
      if (!input.trim()) return null;

      setResolving(true);
      try {
        const conn = new Connection(RPC, "confirmed");
        return await resolveAddressOrDomain(conn, input);
      } finally {
        setResolving(false);
      }
    },
    [],
  );

  /**
   * Calculate the total amount needed (transfer + fee)
   */
  const calculateTotal = useCallback((amountUi: number): number => {
    return amountUi + FEE_USDC;
  }, []);

  /**
   * Send USDC to an external wallet or .sol domain.
   */
  const send = useCallback(
    async (params: ExternalTransferParams): Promise<ExternalTransferResult> => {
      const { fromOwnerBase58, toAddressOrDomain, amountUi } = params;

      setLoading(true);
      setError(null);
      setLastResult(null);

      try {
        // Validate amount
        if (!Number.isFinite(amountUi) || amountUi <= 0) {
          throw new Error("Amount must be greater than 0");
        }

        if (amountUi < 0.01) {
          throw new Error("Minimum transfer amount is 0.01 USDC");
        }

        const fromOwner = new PublicKey(fromOwnerBase58);
        const conn = new Connection(RPC, "confirmed");

        // Resolve destination
        setResolving(true);
        const resolved = await resolveAddressOrDomain(conn, toAddressOrDomain);
        setResolving(false);

        if (!resolved) {
          throw new Error(
            "Invalid destination. Enter a valid Solana address or .sol domain.",
          );
        }

        const toOwner = new PublicKey(resolved.address);

        // Prevent self-transfer
        if (fromOwner.equals(toOwner)) {
          throw new Error("Cannot send to yourself");
        }

        // Prevent sending to Haven system wallets
        if (toOwner.equals(HAVEN_FEEPAYER) || toOwner.equals(TREASURY_OWNER)) {
          throw new Error("Cannot send to Haven system wallets");
        }

        // Get Privy wallet
        const wallet = wallets.find((w) => w.address === fromOwnerBase58);
        if (!wallet) {
          throw new Error("Wallet not available. Please reconnect.");
        }

        // Detect token program
        const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

        // Derive ATAs
        const fromAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          fromOwner,
          false,
          tokenProgramId,
        );
        const toAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          toOwner,
          false,
          tokenProgramId,
        );
        const treasuryAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          TREASURY_OWNER,
          false,
          tokenProgramId,
        );

        // Check sender balance
        const fromAtaInfo = await conn
          .getTokenAccountBalance(fromAta, "confirmed")
          .catch(() => null);
        const balance = fromAtaInfo?.value?.uiAmount ?? 0;
        const totalNeeded = amountUi + FEE_USDC;

        if (balance < totalNeeded) {
          throw new Error(
            `Insufficient USDC balance. You need ${totalNeeded.toFixed(2)} USDC (${amountUi} + ${FEE_USDC} fee) but have ${balance.toFixed(2)} USDC.`,
          );
        }

        // Build instructions
        const ixs = [
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            fromAta,
            fromOwner,
            USDC_MINT,
            tokenProgramId,
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            toAta,
            toOwner,
            USDC_MINT,
            tokenProgramId,
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            treasuryAta,
            TREASURY_OWNER,
            USDC_MINT,
            tokenProgramId,
          ),
        ];

        const amountUnits = Math.round(amountUi * 10 ** DECIMALS);
        const feeUnits = Math.round(FEE_USDC * 10 ** DECIMALS);

        // Transfer to recipient
        ixs.push(
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            toAta,
            fromOwner,
            amountUnits,
            DECIMALS,
            [],
            tokenProgramId,
          ),
        );

        // Transfer fee to treasury
        ixs.push(
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            treasuryAta,
            fromOwner,
            feeUnits,
            DECIMALS,
            [],
            tokenProgramId,
          ),
        );

        // Build transaction
        const { blockhash } = await conn.getLatestBlockhash("processed");
        const msg = new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);

        // Sign with user's wallet
        const { signedTransaction } = await signTransaction({
          transaction: tx.serialize(),
          wallet,
          options: { uiOptions: { showWalletUIs: false } },
        });

        // Send to backend for co-signing
        const res = await fetch("/api/user/wallet/transfer", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction: Buffer.from(signedTransaction).toString("base64"),
          }),
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json?.signature) {
          // Handle specific error codes
          if (json?.code === "BLOCKHASH_EXPIRED") {
            throw new Error("Transaction expired. Please try again.");
          }
          if (json?.code === "INSUFFICIENT_FUNDS") {
            throw new Error(
              "Haven fee wallet is low on SOL. Please try again shortly.",
            );
          }
          throw new Error(json?.error || `Transfer failed (${res.status})`);
        }

        const result: ExternalTransferResult = {
          signature: json.signature,
          resolvedAddress: resolved.address,
          inputAddress: toAddressOrDomain,
          amountUi,
          feeUi: FEE_USDC,
        };

        setLastResult(result);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
        setResolving(false);
      }
    },
    [wallets, signTransaction],
  );

  return {
    send,
    validateAndResolve,
    calculateTotal,
    loading,
    resolving,
    lastResult,
    error,
    feeUsdc: FEE_USDC,
    clearError: useCallback(() => setError(null), []),
  };
}
