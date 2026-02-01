// hooks/useSponsoredExternalTransferV2.ts
"use client";

import { useCallback, useMemo, useState } from "react";
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
import { resolveRpcUrl } from "@/lib/resolveRpcUrl";

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────────────────────
   Config (NO throwing at module scope)
───────────────────────────────────────────────────────────── */

const RPC = resolveRpcUrl(process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl("devnet"));
const DECIMALS = 6;

const FEE_USDC: number = (() => {
  const raw =
    process.env.NEXT_PUBLIC_EXTERNAL_TRANSFER_FEE_USDC ??
    process.env.NEXT_PUBLIC_TRANSFER_FEE_USDC ??
    "1.5";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1.5;
})();


/* ─────────────────────────────────────────────────────────────
   Lazy load SNS SDK
───────────────────────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────────────────────
   Domain Resolution
───────────────────────────────────────────────────────────── */

async function resolveSolDomain(
  conn: Connection,
  domain: string,
): Promise<string | null> {
  try {
    const sns = await getSnsModule();
    const name = domain.toLowerCase().replace(/\.sol$/, "");

    const { pubkey } = await sns.getDomainKeySync(name);
    const { registry } = await sns.NameRegistryState.retrieve(conn, pubkey);

    if (!registry.owner || registry.owner.equals(PublicKey.default))
      return null;
    return registry.owner.toBase58();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[resolveSolDomain] Failed to resolve ${domain}:`, err);
    return null;
  }
}

async function resolveSolDomainViaApi(domain: string): Promise<string | null> {
  try {
    const name = domain.toLowerCase().replace(/\.sol$/, "");
    const response = await fetch(
      `https://sns-sdk-proxy.bonfida.workers.dev/resolve/${name}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) return null;

    const data: unknown = await response.json().catch(() => null);
    const result =
      typeof (data as { result?: unknown } | null)?.result === "string"
        ? (data as { result: string }).result
        : null;

    return result;
  } catch {
    return null;
  }
}

async function resolveAddressOrDomain(
  conn: Connection,
  input: string,
): Promise<ResolvedAddress | null> {
  const trimmed = input.trim();

  // Valid Solana address?
  try {
    new PublicKey(trimmed);
    return { address: trimmed, isDomain: false };
  } catch {
    // continue
  }

  // Valid .sol domain format?
  if (!/^[a-zA-Z0-9_-]+\.sol$/i.test(trimmed)) return null;

  let resolved = await resolveSolDomain(conn, trimmed).catch(() => null);
  if (!resolved) resolved = await resolveSolDomainViaApi(trimmed);
  if (!resolved) return null;

  return {
    address: resolved,
    isDomain: true,
    domain: trimmed.toLowerCase(),
  };
}

/* ─────────────────────────────────────────────────────────────
   Token program detection
───────────────────────────────────────────────────────────── */

async function detectTokenProgramId(
  conn: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("USDC mint not found on this network.");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ─────────────────────────────────────────────────────────────
   Hook
───────────────────────────────────────────────────────────── */

type TransferApiOk = { signature: string };
type TransferApiErr = { error?: string; userMessage?: string; code?: string };
type TransferApiResponse = TransferApiOk | TransferApiErr;

function pickErrorMessage(payload: unknown, fallback: string): string {
  const p = payload as TransferApiErr | null | undefined;
  if (typeof p?.userMessage === "string" && p.userMessage.trim())
    return p.userMessage;
  if (typeof p?.error === "string" && p.error.trim()) return p.error;
  return fallback;
}

export function useSponsoredExternalTransfer() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [lastResult, setLastResult] = useState<ExternalTransferResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Lazily construct these only when needed
  // NOTE: Next.js only inlines NEXT_PUBLIC_ vars with static access
  // (process.env.NEXT_PUBLIC_X), not dynamic access (process.env[name]).
 const getConfig = useCallback(() => {
   const usdcMintStr = process.env.NEXT_PUBLIC_USDC_MINT?.trim();
   const feePayerStr = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS?.trim();
   const treasuryStr = process.env.NEXT_PUBLIC_APP_TREASURY_OWNER?.trim();

   if (!usdcMintStr) {
     throw new Error("Configuration error: Missing NEXT_PUBLIC_USDC_MINT.");
   }
   if (!feePayerStr) {
     throw new Error(
       "Configuration error: Missing NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS.",
     );
   }
   if (!treasuryStr) {
     throw new Error(
       "Configuration error: Missing NEXT_PUBLIC_APP_TREASURY_OWNER.",
     );
   }

   return {
     USDC_MINT: new PublicKey(usdcMintStr),
     HAVEN_FEEPAYER: new PublicKey(feePayerStr),
     TREASURY_OWNER: new PublicKey(treasuryStr),
   };
 }, []);

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

  const calculateTotal = useCallback((amountUi: number): number => {
    return amountUi + FEE_USDC;
  }, []);

  const send = useCallback(
    async (params: ExternalTransferParams): Promise<ExternalTransferResult> => {
      const { fromOwnerBase58, toAddressOrDomain, amountUi } = params;

      setLoading(true);
      setError(null);
      setLastResult(null);

      try {
        // Config only needed here; if missing, user sees clean message
        const { USDC_MINT, HAVEN_FEEPAYER, TREASURY_OWNER } = getConfig();

        if (!Number.isFinite(amountUi) || amountUi <= 0) {
          throw new Error("Amount must be greater than 0");
        }
        if (amountUi < 0.01) {
          throw new Error("Minimum transfer amount is 0.01 USDC");
        }

        const fromOwnerTrimmed = (fromOwnerBase58 || "").trim();

        let fromOwner: PublicKey;
        try {
          fromOwner = new PublicKey(fromOwnerTrimmed);
        } catch {
          throw new Error("Invalid sender wallet address. Please reconnect.");
        }

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

        if (fromOwner.equals(toOwner))
          throw new Error("Cannot send to yourself");
        if (toOwner.equals(HAVEN_FEEPAYER) || toOwner.equals(TREASURY_OWNER)) {
          throw new Error("Cannot send to Haven system wallets");
        }

        const wallet = wallets.find(
          (w) => (w.address || "").trim() === fromOwnerTrimmed,
        );
        if (!wallet) throw new Error("Wallet not available. Please reconnect.");

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

        // Balance check (no silent swallowing; no string matching)
        let balance = 0;

        try {
          const ataAccountInfo = await conn.getAccountInfo(
            fromAta,
            "confirmed",
          );

          // ATA doesn't exist => balance is 0 (expected)
          if (!ataAccountInfo) {
            balance = 0;
          } else {
            const fromAtaInfo = await conn.getTokenAccountBalance(
              fromAta,
              "confirmed",
            );
            balance = fromAtaInfo?.value?.uiAmount ?? 0;
          }
        } catch {
          throw new Error("Failed to check USDC balance. Please try again.");
        }

        const totalNeeded = amountUi + FEE_USDC;
        if (balance < totalNeeded) {
          throw new Error(
            `Insufficient USDC balance. You need ${totalNeeded.toFixed(2)} USDC (${amountUi} + ${FEE_USDC} fee) but have ${balance.toFixed(2)} USDC.`,
          );
        }

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

        const { blockhash, lastValidBlockHeight } =
          await conn.getLatestBlockhash("processed");

        const msg = new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);

        const { signedTransaction } = await signTransaction({
          transaction: tx.serialize(),
          wallet,
          options: { uiOptions: { showWalletUIs: false } },
        });

        const res = await fetch("/api/user/wallet/transfer", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction: Buffer.from(signedTransaction).toString("base64"),
            expectedUserBase58: fromOwnerTrimmed,
            recentBlockhash: blockhash,
            lastValidBlockHeight,
          }),
        });

        const json = (await res
          .json()
          .catch(() => ({}))) as TransferApiResponse;

        if (!res.ok || typeof (json as TransferApiOk).signature !== "string") {
          throw new Error(
            pickErrorMessage(json, `Transfer failed (${res.status})`),
          );
        }

        const signature = (json as TransferApiOk).signature;

        const result: ExternalTransferResult = {
          signature,
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
    [wallets, signTransaction, getConfig],
  );

  return useMemo(
    () => ({
      send,
      validateAndResolve,
      calculateTotal,
      loading,
      resolving,
      lastResult,
      error,
      feeUsdc: FEE_USDC,
      clearError: () => setError(null),
    }),
    [
      send,
      validateAndResolve,
      calculateTotal,
      loading,
      resolving,
      lastResult,
      error,
    ],
  );
}
