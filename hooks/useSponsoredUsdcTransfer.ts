// hooks/useSponsoredUsdcTransfer.ts
"use client";

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

export type TransferNotify = {
  toOwnerBase58: string;
  message?: string;
  amountUi?: number;
};

export type SponsoredUsdcTransferParams = {
  /** Sender wallet address (must match a Privy Solana wallet address) */
  fromOwnerBase58: string;
  /** Destination Solana wallet address (user or external) */
  toOwnerBase58: string;
  /** Amount in USDC (e.g. 20 = 20 USDC sent to recipient) */
  amountUi: number;
  /** Optional: notify payload for the backend */
  notify?: TransferNotify;
};

/* ─── Network / token / fee config ────────────────────── */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl("devnet");

const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);

// Haven fee-payer wallet (must match server: NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS)
const HAVEN_FEEPAYER = new PublicKey(
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!
);

// Treasury owner (where the fee goes)
const TREASURY_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!
);

// USDC(6)
const DECIMALS = 6;

// Fee in USDC, charged ON TOP of amountUi
const FEE_USDC: number = (() => {
  const raw =
    process.env.NEXT_PUBLIC_TRANSFER_FEE_USDC ??
    process.env.TRANSFER_FEE_USDC ??
    "1.5"; // default 1.5 USDC
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1.5;
})();

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("USDC mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ─── Hook ─────────────────────────────────────────────── */

export function useSponsoredUsdcTransfer() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [loading, setLoading] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async ({
      fromOwnerBase58,
      toOwnerBase58,
      amountUi,
      notify,
    }: SponsoredUsdcTransferParams) => {
      setLoading(true);
      setError(null);
      setLastSig(null);

      try {
        if (!Number.isFinite(amountUi) || amountUi <= 0) {
          throw new Error("Amount must be greater than 0");
        }

        const fromOwner = new PublicKey(fromOwnerBase58);
        const toOwner = new PublicKey(toOwnerBase58);

        // 🔎 Privy wallet that owns fromOwnerBase58
        const wallet = wallets.find((w) => w.address === fromOwnerBase58);
        if (!wallet) {
          throw new Error("Source wallet not available for this user.");
        }

        const conn = new Connection(RPC, "confirmed");
        const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

        // ATAs for sender, recipient, and treasury
        const fromAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          fromOwner,
          false,
          tokenProgramId
        );
        const toAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          toOwner,
          false,
          tokenProgramId
        );
        const treasuryAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          TREASURY_OWNER,
          false,
          tokenProgramId
        );

        const ixs = [
          // NOTE: payer here is HAVEN_FEEPAYER (same as tx fee payer)
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            fromAta,
            fromOwner,
            USDC_MINT,
            tokenProgramId
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            toAta,
            toOwner,
            USDC_MINT,
            tokenProgramId
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            treasuryAta,
            TREASURY_OWNER,
            USDC_MINT,
            tokenProgramId
          ),
        ];

        // recipient amount
        const amountUnits = Math.round(amountUi * 10 ** DECIMALS);
        // fee to treasury
        const feeUnits = Math.round(FEE_USDC * 10 ** DECIMALS);

        // transfer amount to recipient
        ixs.push(
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            toAta,
            fromOwner,
            amountUnits,
            DECIMALS,
            [],
            tokenProgramId
          )
        );

        // transfer fee to treasury
        ixs.push(
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            treasuryAta,
            fromOwner,
            feeUnits,
            DECIMALS,
            [],
            tokenProgramId
          )
        );

        const { blockhash } = await conn.getLatestBlockhash("processed");

        // 👇 FEE PAYER IS HAVEN (must match server check)
        const msg = new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);

        // Client signs as token authority (fromOwner); Haven signs later on the server.
        const { signedTransaction } = await signTransaction({
          transaction: tx.serialize(), // Uint8Array
          wallet,
          options: {
            uiOptions: {
              showWalletUIs: false, // button press = consent
            },
          },
        });

        const txBase64 = Buffer.from(signedTransaction).toString("base64");

        // Send to backend for Haven co-sign + broadcast
        const body: Record<string, unknown> = { transaction: txBase64 };
        if (notify) body.notify = notify;

        const res = await fetch("/api/user/wallet/transfer", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const j = await res.json().catch(() => ({} as any));

        if (!res.ok || !j?.signature) {
          throw new Error(
            typeof j.error === "string"
              ? j.error
              : `Transfer failed (HTTP ${res.status})`
          );
        }

        const sig: string = j.signature;
        setLastSig(sig);
        return sig;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallets, signTransaction]
  );

  return { send, loading, lastSig, error, feeUsdc: FEE_USDC };
}
