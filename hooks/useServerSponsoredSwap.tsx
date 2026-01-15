// hooks/useServerSponsoredSwap.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

import { usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";

/* Buffer polyfill */
declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}
if (typeof window !== "undefined") window.Buffer = window.Buffer || Buffer;

/* ───────── EXPORTED TYPES ───────── */

export type SwapStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "done"
  | "error";

export type SwapInput = {
  fromOwnerBase58: string;
  inputMint: string;
  outputMint: string;
  amountUi: string;
  slippageBps?: number;
  isMax?: boolean;
};

export type SwapResult = {
  signature: string;
  inputMint: string;
  outputMint: string;
  grossInUnits: number;
  netInUnits: number;
  feeUnits: number;
  buildTimeMs?: number;
  totalTimeMs: number;
};

export type SwapError = {
  message: string;
  code?: string;
  stage?: string;
  retryable?: boolean;
};

/* ───────── INTERNAL TYPES ───────── */

type BuildResponse = {
  transaction: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  traceId: string;
  inputMint: string;
  outputMint: string;
  grossInUnits: number;
  netInUnits: number;
  feeUnits: number;
  feeMint: string;
  feeDecimals: number;
  buildTimeMs?: number;
};

type SendResponse = {
  signature: string;
  sendTimeMs?: number;
};

/* ───────── HELPERS ───────── */

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
  });

  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const d = data as Record<string, unknown> | null;
    const msg =
      d?.userMessage ||
      d?.error ||
      d?.message ||
      `Request failed: ${res.status}`;
    const e = new Error(String(msg)) as Error & {
      code?: string;
      stage?: string;
      retryable?: boolean;
    };
    e.code = d?.code as string | undefined;
    e.stage = d?.stage as string | undefined;
    e.retryable =
      d?.code === "BLOCKHASH_EXPIRED" || d?.code === "SESSION_EXPIRED";
    throw e;
  }

  return data as T;
}

function pickWallet(
  wallets: ConnectedStandardSolanaWallet[],
  address: string
): ConnectedStandardSolanaWallet | null {
  // Prefer non-embedded (Phantom, etc) over Privy embedded
  const nonEmbedded = wallets.find(
    (w) => w.address === address && w.standardWallet?.name !== "Privy"
  );
  return nonEmbedded ?? wallets.find((w) => w.address === address) ?? null;
}

function isUserRejection(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("cancelled") ||
    msg.includes("user canceled")
  );
}

function isBlockhashError(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  const code = String((e as { code?: string })?.code || "").toLowerCase();
  return (
    msg.includes("blockhash") ||
    msg.includes("expired") ||
    code.includes("blockhash")
  );
}

/* ───────── HOOK ───────── */

export function useServerSponsoredSwap() {
  const { login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<SwapStatus>("idle");
  const [error, setError] = useState<SwapError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // ───────── Sign with wallet ─────────

  const signWithWallet = useCallback(
    async (address: string, txBytes: Uint8Array) => {
      const wallet = pickWallet(wallets, address);
      if (!wallet) {
        throw new Error("Wallet not connected. Please reconnect.");
      }

      const { signedTransaction } = await signTransaction({
        transaction: txBytes,
        wallet,
      });

      return Buffer.from(signedTransaction).toString("base64");
    },
    [wallets, signTransaction]
  );

  // ───────── Main swap function ─────────

  const swap = useCallback(
    async (input: SwapInput): Promise<SwapResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) {
        throw new Error("A swap is already in progress");
      }

      if (!input.fromOwnerBase58 || !input.inputMint || !input.outputMint) {
        throw new Error("Invalid swap parameters");
      }

      inFlightRef.current = true;
      abortRef.current = new AbortController();

      // Reset state
      setStatus("idle");
      setError(null);
      setSignature(null);

      try {
        /* ══════════ PHASE 1: BUILD ══════════ */
        setStatus("building");

        let buildResp: BuildResponse;

        // Try up to 2 times for blockhash expiry
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            buildResp = await postJSON<BuildResponse>("/api/jup/build", {
              fromOwnerBase58: input.fromOwnerBase58,
              inputMint: input.inputMint,
              outputMint: input.outputMint,
              amountUi: input.amountUi,
              slippageBps: input.slippageBps ?? 50,
              isMax: input.isMax === true,
            });
            break;
          } catch (e) {
            if (attempt === 2 || !isBlockhashError(e)) throw e;
            // Retry on blockhash error
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        /* ══════════ PHASE 2: SIGN ══════════ */
        setStatus("signing");

        const txBytes = Buffer.from(buildResp!.transaction, "base64");
        const unsignedTx = VersionedTransaction.deserialize(txBytes);

        // Validate user is a signer
        const msg = unsignedTx.message as unknown as {
          header?: { numRequiredSignatures?: number };
          staticAccountKeys?: PublicKey[];
        };
        const numSigners = msg.header?.numRequiredSignatures ?? 0;
        const signerKeys = (msg.staticAccountKeys ?? [])
          .slice(0, numSigners)
          .map((k) => (k instanceof PublicKey ? k : new PublicKey(k)));

        if (!signerKeys.some((k) => k.toBase58() === input.fromOwnerBase58)) {
          throw new Error("Transaction doesn't include user as signer");
        }

        let signedB64: string;
        try {
          signedB64 = await signWithWallet(input.fromOwnerBase58, txBytes);
        } catch (e) {
          if (isUserRejection(e)) {
            throw new Error("Transaction cancelled");
          }
          throw e;
        }

        /* ══════════ PHASE 3: SEND ══════════ */
        setStatus("sending");

        let sendResp: SendResponse;
        try {
          // Pass fee info from build response to send endpoint for tracking
          sendResp = await postJSON<SendResponse>("/api/jup/send", {
            transaction: signedB64,
            // Fee tracking info (symbol resolved server-side from token config)
            feeUnits: buildResp!.feeUnits,
            feeMint: buildResp!.feeMint,
            feeDecimals: buildResp!.feeDecimals,
          });
        } catch (e) {
          // If blockhash expired during send, could retry build+sign
          // For now, just throw
          throw e;
        }

        setSignature(sendResp.signature);

        /* ══════════ PHASE 4: CONFIRM (optional) ══════════ */
        setStatus("confirming");

        // We consider it done once broadcast succeeds
        // Could add confirmation polling here if needed

        setStatus("done");

        const totalTime = Date.now() - startTime;
        console.log(
          `[Swap] ${sendResp.signature.slice(0, 8)}... ${totalTime}ms`
        );

        return {
          signature: sendResp.signature,
          inputMint: buildResp!.inputMint,
          outputMint: buildResp!.outputMint,
          grossInUnits: buildResp!.grossInUnits,
          netInUnits: buildResp!.netInUnits,
          feeUnits: buildResp!.feeUnits,
          buildTimeMs: buildResp!.buildTimeMs,
          totalTimeMs: totalTime,
        };
      } catch (e) {
        const err = e as Error & {
          code?: string;
          stage?: string;
          retryable?: boolean;
        };
        const swapError: SwapError = {
          message: err.message || "Swap failed",
          code: err.code,
          stage: err.stage,
          retryable: err.retryable || isBlockhashError(e),
        };

        setError(swapError);
        setStatus("error");

        console.error("[Swap] Failed:", swapError);
        throw e;
      } finally {
        inFlightRef.current = false;
        abortRef.current = null;
      }
    },
    [signWithWallet]
  );

  // ───────── Reset ─────────

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    inFlightRef.current = false;
    setStatus("idle");
    setError(null);
    setSignature(null);
  }, []);

  // ───────── Return ─────────

  return useMemo(
    () => ({
      swap,
      reset,
      status,
      error,
      signature,
      isBusy:
        inFlightRef.current || !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
    }),
    [swap, reset, status, error, signature]
  );
}
