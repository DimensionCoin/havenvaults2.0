// hooks/useSponsoredCryptoTransfer.ts
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

/* ───────────────── Types ───────────────── */

export type SponsoredCryptoTransferParams = {
  /** Sender wallet address (must be a Privy Solana wallet) */
  fromOwnerBase58: string;
  /** Destination Solana address (Haven user or external) */
  toOwnerBase58: string;
  /** SPL token mint (including wSOL) */
  mint: string;
  /** Token decimals (from your BalanceProvider / tokenConfig) */
  decimals: number;
  /** Amount in whole tokens (e.g. 3.5 JUP, 0.2 wSOL) */
  amountUi: number;
  /** Optional symbol for nicer errors: "JUP", "HAVENSOL", etc. */
  symbol?: string;
};

/* ───────────────── Config ───────────────── */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl("devnet");

// Haven fee payer – must match NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS on server
const HAVEN_FEEPAYER = new PublicKey(
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!
);

// Treasury – receives the % fee in the same asset
const TREASURY_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!
);

// USDC mint – we explicitly *block* it here, since you use the USDC hook
const USDC_MINT_STR = process.env.NEXT_PUBLIC_USDC_MINT ?? "";

// Fee percentage (fraction), e.g. 0.01 = 1%
const FEE_PCT: number = (() => {
  const raw =
    process.env.NEXT_PUBLIC_CRYPTO_FEE_UI ??
    process.env.CRYPTO_FEE_UI ??
    "0.01"; // default 1%
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.01;
})();

/* ───────────────── Helpers ───────────────── */

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("Token mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ───────────────── Hook ───────────────── */

export function useSponsoredCryptoTransfer() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [loading, setLoading] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (params: SponsoredCryptoTransferParams) => {
      setLoading(true);
      setError(null);
      setLastSig(null);

      try {
        if (!Number.isFinite(params.amountUi) || params.amountUi <= 0) {
          throw new Error("Amount must be greater than 0");
        }

        if (!params.mint) {
          throw new Error("Token mint required for SPL transfer");
        }

        // block USDC – use the dedicated USDC hook instead
        if (USDC_MINT_STR && params.mint === USDC_MINT_STR) {
          throw new Error("Use the USDC transfer flow for this token");
        }

        const fromOwner = new PublicKey(params.fromOwnerBase58);
        const toOwner = new PublicKey(params.toOwnerBase58);

        // 🔑 Find the Privy wallet that owns fromOwnerBase58
        const wallet = wallets.find(
          (w) => w.address === params.fromOwnerBase58
        );
        if (!wallet) {
          throw new Error("Source wallet not available for this user.");
        }

        const conn = new Connection(RPC, "confirmed");
        const ixs = [];

        const mintPk = new PublicKey(params.mint);
        const decimals = params.decimals;

        const tokenProgramId = await detectTokenProgramId(conn, mintPk);

        const fromAta = getAssociatedTokenAddressSync(
          mintPk,
          fromOwner,
          false,
          tokenProgramId
        );
        const toAta = getAssociatedTokenAddressSync(
          mintPk,
          toOwner,
          false,
          tokenProgramId
        );
        const treasuryAta = getAssociatedTokenAddressSync(
          mintPk,
          TREASURY_OWNER,
          false,
          tokenProgramId
        );

        // create ATAs if missing – paid by HAVEN_FEEPAYER
        ixs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            fromAta,
            fromOwner,
            mintPk,
            tokenProgramId
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            toAta,
            toOwner,
            mintPk,
            tokenProgramId
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            treasuryAta,
            TREASURY_OWNER,
            mintPk,
            tokenProgramId
          )
        );

        const baseUnits = Math.round(params.amountUi * 10 ** decimals);
        if (baseUnits <= 0) throw new Error("Amount too small");

        const feeUnits = Math.floor(baseUnits * FEE_PCT);
        const totalUnits = baseUnits + feeUnits;

        // 🔍 Optional: client-side balance check so errors are nicer
        try {
          const bal = await conn.getTokenAccountBalance(fromAta, "processed");
          const haveUnits = BigInt(bal.value.amount);
          if (haveUnits < BigInt(totalUnits)) {
            const haveUi = Number(bal.value.amount) / 10 ** bal.value.decimals;
            const needUi = totalUnits / 10 ** decimals;
            const ticker = params.symbol ?? "tokens";

            throw new Error(
              `You only have ${haveUi.toFixed(
                6
              )} ${ticker} but this transfer needs ${needUi.toFixed(
                6
              )} including the fee.`
            );
          }
        } catch (e) {
          // If balance fetch fails, we still try to send – RPC will catch underflow
          if (e instanceof Error) {
            // surface balance error to user instead of generic "insufficient funds"
            throw e;
          }
        }

        // main transfer
        ixs.push(
          createTransferCheckedInstruction(
            fromAta,
            mintPk,
            toAta,
            fromOwner,
            baseUnits,
            decimals,
            [],
            tokenProgramId
          )
        );

        // fee transfer to treasury (same token)
        if (feeUnits > 0) {
          ixs.push(
            createTransferCheckedInstruction(
              fromAta,
              mintPk,
              treasuryAta,
              fromOwner,
              feeUnits,
              decimals,
              [],
              tokenProgramId
            )
          );
        }

        // Build sponsored v0 tx: Haven fee payer
        const { blockhash } = await conn.getLatestBlockhash("processed");
        const msg = new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);

        // User signs as token owner; Haven signs server-side as fee payer
        const { signedTransaction } = await signTransaction({
          transaction: tx.serialize(),
          wallet,
          options: {
            uiOptions: {
              showWalletUIs: false, // button press = consent
            },
          },
        });

        const txBase64 = Buffer.from(signedTransaction).toString("base64");

        const res = await fetch("/api/user/wallet/crypto-transfer", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: txBase64 }),
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

  return {
    send,
    loading,
    lastSig,
    error,
    /** e.g. 0.01 => 1% */
    feePct: FEE_PCT,
    feePctDisplay: FEE_PCT * 100,
  };
}
