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

/**
 * Haven pays priority fees (fee payer = Haven), so cap them hard.
 * Tune in prod if you want more aggressive landing during congestion.
 */
const PRIORITY_FEE_LAMPORTS_CAP = Number(
  process.env.NEXT_PUBLIC_PRIORITY_FEE_LAMPORTS_CAP ?? "100000", // 0.0001 SOL
);

const MAX_BUILD_ATTEMPTS = 2;
const MAX_SEND_ATTEMPTS = 2;

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
  confirmed?: boolean;

  // Fee info (UI only)
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

  // Build route returns these
  expectedFeeUnits?: number;
  expectedFeeBps?: number;
  expectedFeeRate?: number;

  feeMint: string; // build route uses input mint for fees
  feeDecimals: number;

  buildTimeMs?: number;
  priorityFeeLamports?: number;
  priorityFeeMicroLamports?: number;
  computeUnits?: number;
};

type SendResponse = {
  signature: string;
  sendTimeMs?: number;
  confirmed?: boolean;
  confirmTimeout?: boolean;
};

/* ───────── HELPERS ───────── */

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function safeUnitsFromUi(ui: number, decimals: number): number {
  const d = clampInt(decimals, 0, 18);
  const factor = 10 ** d;
  const units = Math.floor(ui * factor);
  if (!Number.isFinite(units) || units <= 0) return 0;
  if (units > Number.MAX_SAFE_INTEGER) throw new Error("Amount too large");
  return units;
}

async function postJSON<T>(
  url: string,
  body: unknown,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<T> {
  const controller = new AbortController();
  const timeout = options?.timeout ?? 15_000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const outer = options?.signal;
  const onAbort = () => controller.abort();
  if (outer) outer.addEventListener("abort", onAbort, { once: true });

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
        (d?.userMessage as string) ||
        (d?.error as string) ||
        (d?.message as string) ||
        `Request failed: ${res.status}`;

      const err = new Error(String(msg)) as Error & {
        code?: string;
        stage?: string;
        retryable?: boolean;
      };
      err.code = (d?.code as string) || undefined;
      err.stage = (d?.stage as string) || undefined;
      err.retryable =
        err.code === "BLOCKHASH_EXPIRED" ||
        err.code === "SESSION_EXPIRED" ||
        err.code === "TIMEOUT";
      throw err;
    }

    return data as T;
  } catch (e) {
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
  } finally {
    clearTimeout(timeoutId);
    if (outer) outer.removeEventListener("abort", onAbort);
  }
}

function pickWallet(
  wallets: ConnectedStandardSolanaWallet[],
  address: string,
): ConnectedStandardSolanaWallet | null {
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
  const { login, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<ToJLJupUSDSwapStatus>("idle");
  const [error, setError] = useState<ToJLJupUSDSwapError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const prefetchCacheRef = useRef<{
    key: string;
    response: BuildResponse;
    expires: number;
  } | null>(null);

  const ensureAuthed = useCallback(async () => {
    if (!ready)
      throw new Error("Auth is still loading. Try again in a moment.");
    if (!authenticated) {
      await login();
    }
  }, [ready, authenticated, login]);

  const signWithWallet = useCallback(
    async (address: string, txBytes: Uint8Array) => {
      const wallet = pickWallet(wallets, address);
      if (!wallet) throw new Error("Wallet not connected. Please reconnect.");

      const { signedTransaction } = await signTransaction({
        transaction: txBytes,
        wallet,
      });

      return Buffer.from(signedTransaction).toString("base64");
    },
    [wallets, signTransaction],
  );

  const buildTransaction = useCallback(
    async (params: {
      fromOwnerBase58: string;
      inputMint: string;
      outputMint: string;
      amountUnits: number;
      slippageBps: number;
      isMax: boolean;
    }): Promise<BuildResponse> => {
      const cacheKey = JSON.stringify(params);
      const cached = prefetchCacheRef.current;

      if (cached && cached.key === cacheKey && cached.expires > Date.now()) {
        prefetchCacheRef.current = null;
        return cached.response;
      }

      return postJSON<BuildResponse>("/api/jup/build", params, {
        timeout: 10_000,
        signal: abortRef.current?.signal,
      });
    },
    [],
  );

  /**
   * Prefetch build right before confirm (short TTL).
   * We also avoid caching if priority fee is above cap.
   */
  const prefetch = useCallback(
    async (input: ToJLJupUSDSwapInput): Promise<void> => {
      if (!input.fromOwnerBase58 || !input.inputMint) return;
      if (input.inputMint === JLJUPUSD_MINT) return;

      try {
        await ensureAuthed();
      } catch {
        return;
      }

      const isMax = Boolean(input.isMax);
      const amountUnits = isMax
        ? 1
        : safeUnitsFromUi(input.amountUi, input.inputDecimals);

      if (!amountUnits) return;

      const params = {
        fromOwnerBase58: input.fromOwnerBase58,
        inputMint: input.inputMint,
        outputMint: JLJUPUSD_MINT,
        amountUnits,
        slippageBps: clampInt(input.slippageBps ?? 50, 1, 3_000),
        isMax,
      };

      try {
        const response = await postJSON<BuildResponse>(
          "/api/jup/build",
          params,
          {
            timeout: 8_000,
            signal: abortRef.current?.signal,
          },
        );

        const pLamports = response.priorityFeeLamports ?? 0;
        if (
          Number.isFinite(pLamports) &&
          pLamports > 0 &&
          pLamports > PRIORITY_FEE_LAMPORTS_CAP
        ) {
          return;
        }

        prefetchCacheRef.current = {
          key: JSON.stringify(params),
          response,
          expires: Date.now() + 12_000,
        };
      } catch {
        // non-fatal
      }
    },
    [ensureAuthed],
  );

  const swap = useCallback(
    async (input: ToJLJupUSDSwapInput): Promise<ToJLJupUSDSwapResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) throw new Error("A swap is already in progress");
      if (!input.fromOwnerBase58) throw new Error("Invalid swap parameters");
      if (!input.inputMint) throw new Error("Input token not specified");
      if (input.inputMint === JLJUPUSD_MINT) {
        throw new Error("Cannot swap JLJupUSD to itself");
      }

      inFlightRef.current = true;
      abortRef.current = new AbortController();

      setStatus("idle");
      setError(null);
      setSignature(null);

      await ensureAuthed();

      const isMax = Boolean(input.isMax);
      const slippageBps = clampInt(input.slippageBps ?? 50, 1, 3_000);

      const amountUnits = isMax
        ? 1
        : safeUnitsFromUi(input.amountUi, input.inputDecimals);

      if (!amountUnits) {
        const err: ToJLJupUSDSwapError = {
          message: "Amount is too small",
          code: "INVALID_AMOUNT",
        };
        setError(err);
        setStatus("error");
        throw Object.assign(new Error(err.message), err);
      }

      let priorityFeeLamports: number | undefined;

      try {
        /* ══════════ PHASE 1: BUILD ══════════ */
        setStatus("building");

        const buildParams = {
          fromOwnerBase58: input.fromOwnerBase58,
          inputMint: input.inputMint,
          outputMint: JLJUPUSD_MINT,
          amountUnits,
          slippageBps,
          isMax,
        };

        let buildResp: BuildResponse | undefined;

        for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
          try {
            buildResp = await buildTransaction(buildParams);
            break;
          } catch (e) {
            if (attempt === MAX_BUILD_ATTEMPTS || !isRetryableError(e)) throw e;
            await sleep(120);
          }
        }

        priorityFeeLamports = buildResp!.priorityFeeLamports;

        // ── GAS SAFETY: cap priority fee (Haven pays this) ──
        if (
          typeof priorityFeeLamports === "number" &&
          Number.isFinite(priorityFeeLamports) &&
          priorityFeeLamports > PRIORITY_FEE_LAMPORTS_CAP
        ) {
          const err: ToJLJupUSDSwapError = {
            message:
              "Network is busy right now. Try again in a moment for cheaper fees.",
            code: "PRIORITY_FEE_TOO_HIGH",
            stage: "build",
            retryable: true,
          };
          setError(err);
          setStatus("error");
          throw Object.assign(new Error(err.message), err);
        }

        /* ══════════ PHASE 2: SIGN ══════════ */
        setStatus("signing");

        const txBytes = Buffer.from(buildResp!.transaction, "base64");
        const unsignedTx = VersionedTransaction.deserialize(txBytes);

        // Validate user is a required signer (protects against stale/wrong wallet)
        const msg = unsignedTx.message as unknown as {
          header?: { numRequiredSignatures?: number };
          staticAccountKeys?: PublicKey[];
        };
        const numSigners = msg.header?.numRequiredSignatures ?? 0;
        const signerKeys = (msg.staticAccountKeys ?? [])
          .slice(0, numSigners)
          .map((k) => (k instanceof PublicKey ? k : new PublicKey(k)));

        if (!signerKeys.some((k) => k.toBase58() === input.fromOwnerBase58)) {
          const err: ToJLJupUSDSwapError = {
            message:
              "Wallet session is out of sync. Please refresh and try again.",
            code: "WALLET_MISMATCH",
            stage: "sign",
            retryable: true,
          };
          setError(err);
          setStatus("error");
          throw Object.assign(new Error(err.message), err);
        }

        let signedB64: string;
        try {
          signedB64 = await signWithWallet(input.fromOwnerBase58, txBytes);
        } catch (e) {
          if (isUserRejection(e)) {
            const err: ToJLJupUSDSwapError = {
              message: "Transaction cancelled",
              code: "USER_CANCELLED",
              stage: "sign",
              retryable: false,
            };
            setError(err);
            setStatus("error");
            throw Object.assign(new Error(err.message), err);
          }
          throw e;
        }

        /* ══════════ PHASE 3: SEND ══════════ */
        setStatus("sending");

        let sendResp: SendResponse | undefined;

        for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
          try {
            sendResp = await postJSON<SendResponse>(
              "/api/jup/send",
              {
                transaction: signedB64,
                // fee transfer in build happens in INPUT mint (your build route)
                feeMint: buildResp!.feeMint,
                // optional fast-confirm inputs if your send route supports them
                recentBlockhash: buildResp!.recentBlockhash,
                lastValidBlockHeight: buildResp!.lastValidBlockHeight,
              },
              { timeout: 30_000, signal: abortRef.current?.signal },
            );
            break;
          } catch (e) {
            if (isBlockhashError(e)) throw e; // must rebuild/resign
            if (attempt === MAX_SEND_ATTEMPTS || !isRetryableError(e)) throw e;
            await sleep(150);
          }
        }

        setSignature(sendResp!.signature);

        setStatus("done");

        const totalTime = Date.now() - startTime;

        return {
          signature: sendResp!.signature,
          inputMint: input.inputMint,
          outputMint: JLJUPUSD_MINT,
          amountUnits,
          totalTimeMs: totalTime,
          priorityFeeLamports,
          confirmed: Boolean(sendResp!.confirmed),

          // UI-only fee info from build response
          feeUnits: buildResp!.expectedFeeUnits,
          feeMint: buildResp!.feeMint,
          feeDecimals: buildResp!.feeDecimals,
        };
      } catch (e) {
        const err = e as Error & {
          code?: string;
          stage?: string;
          retryable?: boolean;
        };

        const swapError: ToJLJupUSDSwapError = {
          message: err.message || "Swap failed",
          code: err.code,
          stage: err.stage,
          retryable: Boolean(err.retryable) || isRetryableError(e),
        };

        setError(swapError);
        setStatus("error");
        throw e;
      } finally {
        inFlightRef.current = false;
        abortRef.current = null;
      }
    },
    [ensureAuthed, signWithWallet, buildTransaction],
  );

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

  const clearPrefetch = useCallback(() => {
    prefetchCacheRef.current = null;
  }, []);

  return useMemo(
    () => ({
      swap,
      prefetch,
      clearPrefetch,
      reset,
      status,
      error,
      signature,
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
