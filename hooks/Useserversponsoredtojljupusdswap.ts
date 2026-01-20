// hooks/useServerSponsoredToJLJupUSDSwap.ts
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

/* ───────── ENV / CONSTANTS ───────── */

// JLJupUSD - Jupiter Lend vault share token for JupUSD
const JLJUPUSD_MINT = "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk";
const JLJUPUSD_DECIMALS = 6;

/* ───────── EXPORTED TYPES ───────── */

export type ToJLJupUSDSwapStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "done"
  | "error";

/**
 * Swap any token for JLJupUSD vault shares (deposit directly into Plus savings)
 */
export type ToJLJupUSDSwapInput = {
  fromOwnerBase58: string;
  /** The token to sell (e.g., SOL mint, BTC mint, etc.) */
  inputMint: string;
  /** Decimals of the input token */
  inputDecimals: number;
  /** Amount of input token to swap (in UI units, e.g., 0.5 SOL) */
  amountUi: number;
  /** Optional slippage in basis points (default 50 = 0.5%) */
  slippageBps?: number;
  /** If true, swap entire balance of input token */
  isMax?: boolean;
};

export type ToJLJupUSDSwapResult = {
  signature: string;
  inputMint: string;
  outputMint: string;
  amountUnits: number;
  totalTimeMs: number;
  priorityFeeLamports?: number;
  // Fee info
  feeUnits?: number;
  feeMint?: string;
  feeDecimals?: number;
};

export type ToJLJupUSDSwapError = {
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
  // Fee info (fee is taken from output token = JLJupUSD)
  expectedFeeUnits?: number;
  expectedFeeBps?: number;
  expectedFeeRate?: number;
  feeMint?: string;
  feeDecimals?: number;
  buildTimeMs?: number;
  priorityFeeLamports?: number;
  priorityFeeMicroLamports?: number;
  computeUnits?: number;
};

type SendResponse = {
  signature: string;
  sendTimeMs?: number;
};

/* ───────── HELPERS ───────── */

/**
 * Optimized fetch with shorter timeout for speed
 */
async function postJSON<T>(
  url: string,
  body: unknown,
  options?: { timeout?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeout = options?.timeout ?? 15_000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
      keepalive: true,
    });

    clearTimeout(timeoutId);

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
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === "AbortError") {
      const err = new Error("Request timed out") as Error & {
        code?: string;
        retryable?: boolean;
      };
      err.code = "TIMEOUT";
      err.retryable = true;
      throw err;
    }
    throw e;
  }
}

function pickWallet(
  wallets: ConnectedStandardSolanaWallet[],
  address: string,
): ConnectedStandardSolanaWallet | null {
  // Prefer non-embedded (Phantom, etc) over Privy embedded
  const nonEmbedded = wallets.find(
    (w) => w.address === address && w.standardWallet?.name !== "Privy",
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

function isRetryableError(e: unknown): boolean {
  const code = String((e as { code?: string })?.code || "").toLowerCase();
  return (
    isBlockhashError(e) || code === "timeout" || code === "session_expired"
  );
}

/* ───────── HOOK ───────── */

export function useServerSponsoredToJLJupUSDSwap() {
  const { login, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<ToJLJupUSDSwapStatus>("idle");
  const [error, setError] = useState<ToJLJupUSDSwapError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cache for prefetched builds
  const prefetchCacheRef = useRef<{
    key: string;
    response: BuildResponse;
    expires: number;
  } | null>(null);

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
    [wallets, signTransaction],
  );

  // ───────── Build transaction (extracted for prefetch) ─────────

  const buildTransaction = useCallback(
    async (params: {
      fromOwnerBase58: string;
      inputMint: string;
      outputMint: string;
      amountUnits: number;
      slippageBps: number;
      isMax: boolean;
    }): Promise<BuildResponse> => {
      // Check prefetch cache first
      const cacheKey = JSON.stringify(params);
      const cached = prefetchCacheRef.current;
      if (cached && cached.key === cacheKey && cached.expires > Date.now()) {
        console.log("[ToJLJupUSDSwap] Using prefetched build");
        prefetchCacheRef.current = null; // Consume the cache
        return cached.response;
      }

      // Uses the same /api/jup/build endpoint as regular swaps
      return postJSON<BuildResponse>("/api/jup/build", params, {
        timeout: 10_000, // 10s timeout for build
      });
    },
    [],
  );

  // ───────── Prefetch build (call before user confirms) ─────────

  const prefetch = useCallback(
    async (input: ToJLJupUSDSwapInput): Promise<void> => {
      if (!input.fromOwnerBase58 || !input.inputMint) return;

      const amountUnits = Math.floor(
        input.amountUi * 10 ** input.inputDecimals,
      );
      if (!Number.isFinite(amountUnits) || amountUnits <= 0) return;

      const params = {
        fromOwnerBase58: input.fromOwnerBase58,
        inputMint: input.inputMint,
        outputMint: JLJUPUSD_MINT,
        amountUnits,
        slippageBps: input.slippageBps ?? 50,
        isMax: input.isMax ?? false,
      };

      try {
        const response = await postJSON<BuildResponse>(
          "/api/jup/build",
          params,
          { timeout: 8_000 },
        );

        // Cache with 20s TTL (blockhash valid for ~60s, but we want fresh)
        prefetchCacheRef.current = {
          key: JSON.stringify(params),
          response,
          expires: Date.now() + 20_000,
        };

        console.log("[ToJLJupUSDSwap] Prefetch complete");
      } catch (e) {
        // Prefetch failure is non-fatal
        console.warn("[ToJLJupUSDSwap] Prefetch failed:", e);
      }
    },
    [],
  );

  // ───────── Main swap function ─────────

  const swap = useCallback(
    async (input: ToJLJupUSDSwapInput): Promise<ToJLJupUSDSwapResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) {
        throw new Error("A swap is already in progress");
      }

      if (!input.fromOwnerBase58) {
        throw new Error("Invalid swap parameters");
      }

      if (!input.inputMint) {
        throw new Error("Input token not specified");
      }

      // Prevent swapping JLJupUSD to itself
      if (input.inputMint === JLJUPUSD_MINT) {
        throw new Error("Cannot swap JLJupUSD to itself");
      }

      inFlightRef.current = true;
      abortRef.current = new AbortController();

      // Reset state
      setStatus("idle");
      setError(null);
      setSignature(null);

      // Calculate amount in base units
      const amountUnits = Math.floor(
        input.amountUi * 10 ** input.inputDecimals,
      );

      if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
        const err: ToJLJupUSDSwapError = {
          message: "Amount is too small",
          code: "INVALID_AMOUNT",
        };
        setError(err);
        setStatus("error");
        inFlightRef.current = false;
        throw new Error(err.message);
      }

      let priorityFeeLamports: number | undefined;

      try {
        /* ══════════ PHASE 1: BUILD ══════════ */
        setStatus("building");

        let buildResp: BuildResponse | undefined;
        const buildParams = {
          fromOwnerBase58: input.fromOwnerBase58,
          inputMint: input.inputMint,
          outputMint: JLJUPUSD_MINT,
          amountUnits,
          slippageBps: input.slippageBps ?? 50,
          isMax: input.isMax === true,
        };

        console.log("[ToJLJupUSDSwap] Build params:", {
          ...buildParams,
          amountUi: input.amountUi,
        });

        // Fast retry loop - reduced delay for speed
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            buildResp = await buildTransaction(buildParams);
            break;
          } catch (e) {
            if (attempt === 2 || !isRetryableError(e)) throw e;
            // Minimal delay - just enough to get a fresh blockhash
            await new Promise((r) => setTimeout(r, 100));
          }
        }

        priorityFeeLamports = buildResp!.priorityFeeLamports;

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

        // Pass fee info from build response to send endpoint for tracking
        // Fee is taken from output token (JLJupUSD) and sent to treasury
        const sendResp = await postJSON<SendResponse>(
          "/api/jup/send",
          {
            transaction: signedB64,
            // Fee tracking info - fee mint is JLJupUSD
            feeMint: buildResp!.feeMint ?? JLJUPUSD_MINT,
          },
          { timeout: 30_000 }, // Longer timeout for send (network latency)
        );

        setSignature(sendResp.signature);

        /* ══════════ PHASE 4: DONE ══════════ */
        // Skip confirming state - we trust the RPC accepted it
        setStatus("done");

        const totalTime = Date.now() - startTime;
        console.log(
          `[ToJLJupUSDSwap] ${sendResp.signature.slice(0, 8)}... ${totalTime}ms` +
            ` | ${input.amountUi} ${input.inputMint.slice(0, 8)} -> JLJupUSD` +
            (priorityFeeLamports
              ? ` (priority: ${priorityFeeLamports} lamports)`
              : ""),
        );

        return {
          signature: sendResp.signature,
          inputMint: input.inputMint,
          outputMint: JLJUPUSD_MINT,
          amountUnits,
          totalTimeMs: totalTime,
          priorityFeeLamports,
          // Fee info
          feeUnits: buildResp!.expectedFeeUnits,
          feeMint: buildResp!.feeMint ?? JLJUPUSD_MINT,
          feeDecimals: buildResp!.feeDecimals ?? JLJUPUSD_DECIMALS,
        };
      } catch (e) {
        const err = e as Error & {
          code?: string;
          stage?: string;
          retryable?: boolean;
        };

        // Create user-friendly error message
        let userMessage = err.message || "Swap failed";

        // Handle specific error codes
        if (err.code === "INSUFFICIENT_BALANCE") {
          userMessage = "Insufficient balance to complete this swap";
        } else if (err.code === "SLIPPAGE_EXCEEDED") {
          userMessage = "Price moved too much. Please try again.";
        } else if (err.code === "TIMEOUT") {
          userMessage = "Request timed out. Please try again.";
        } else if (err.code === "BLOCKHASH_EXPIRED") {
          userMessage = "Transaction expired. Please try again.";
        }

        const swapError: ToJLJupUSDSwapError = {
          message: userMessage,
          code: err.code,
          stage: err.stage,
          retryable: err.retryable || isRetryableError(e),
        };

        setError(swapError);
        setStatus("error");

        console.error("[ToJLJupUSDSwap] Failed:", {
          code: err.code,
          message: err.message,
          stage: err.stage,
        });
        throw new Error(userMessage);
      } finally {
        inFlightRef.current = false;
        abortRef.current = null;
      }
    },
    [signWithWallet, buildTransaction],
  );

  // ───────── Reset ─────────

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    inFlightRef.current = false;
    prefetchCacheRef.current = null;
    setStatus("idle");
    setError(null);
    setSignature(null);
  }, []);

  // ───────── Clear prefetch cache ─────────

  const clearPrefetch = useCallback(() => {
    prefetchCacheRef.current = null;
  }, []);

  // ───────── Return ─────────

  return useMemo(
    () => ({
      swap,
      prefetch,
      clearPrefetch,
      reset,
      status,
      error,
      signature,
      // Expose the mint for convenience
      outputMint: JLJUPUSD_MINT,
      outputDecimals: JLJUPUSD_DECIMALS,
      isBusy:
        inFlightRef.current || !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
    }),
    [swap, prefetch, clearPrefetch, reset, status, error, signature],
  );
}
