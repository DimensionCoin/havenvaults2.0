// hooks/useServerSponsoredUsdcSwap.ts
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

/* ───────── ENV ───────── */

const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_SWAP_MINT || process.env.NEXT_PUBLIC_USDC_MINT;

const USDC_DECIMALS = 6;

/**
 * Safety caps so Haven doesn't overpay when the network is hot.
 * - Priority fee is paid by Haven fee payer, so cap it.
 * - Defaults are conservative; tune in prod if needed.
 */
const PRIORITY_FEE_LAMPORTS_CAP = Number(
  process.env.NEXT_PUBLIC_PRIORITY_FEE_LAMPORTS_CAP ?? "100000", // 0.0001 SOL
);
const MAX_BUILD_ATTEMPTS = 2;
const MAX_SEND_ATTEMPTS = 2;

/* ───────── EXPORTED TYPES ───────── */

export type UsdcSwapStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "done"
  | "error";

export type UsdcSwapBuyInput = {
  kind: "buy";
  fromOwnerBase58: string;
  outputMint: string;
  amountDisplay: number; // user's display currency amount
  fxRate: number; // display -> USD rate (display / fxRate = USD)
  slippageBps?: number;
};

export type UsdcSwapSellInput = {
  kind: "sell";
  fromOwnerBase58: string;
  inputMint: string;
  amountUi: number;
  inputDecimals: number;
  slippageBps?: number;
  isMax?: boolean;
};

export type UsdcSwapInput = UsdcSwapBuyInput | UsdcSwapSellInput;

export type UsdcSwapResult = {
  signature: string;
  kind: "buy" | "sell";
  inputMint: string;
  outputMint: string;
  amountUnits: number; // input units (gross for sell, USDC units for buy)
  totalTimeMs: number;
  priorityFeeLamports?: number;
  confirmed?: boolean;
};

export type UsdcSwapError = {
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

  // server returns expectedFeeUnits/expectedFeeBps/expectedFeeRate in build route
  expectedFeeUnits?: number;
  expectedFeeBps?: number;
  expectedFeeRate?: number;

  feeMint: string;
  feeDecimals: number;

  buildTimeMs?: number;

  priorityFeeLamports?: number;
  priorityFeeMicroLamports?: number;
  computeUnits?: number;

  owner?: string; // debug
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
  // Keep within JS safe int (server will also validate)
  if (units > Number.MAX_SAFE_INTEGER) throw new Error("Amount too large");
  return units;
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

/**
 * Optimized POST with JSON + abort + useful error parsing
 */
async function postJSON<T>(
  url: string,
  body: unknown,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<T> {
  const controller = new AbortController();
  const timeout = options?.timeout ?? 15_000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // If caller passes a signal, abort our request too
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

/* ───────── HOOK ───────── */

export function useServerSponsoredUsdcSwap() {
  const { login, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<UsdcSwapStatus>("idle");
  const [error, setError] = useState<UsdcSwapError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cache for prefetched builds
  const prefetchCacheRef = useRef<{
    key: string;
    response: BuildResponse;
    expires: number;
  } | null>(null);

  const ensureAuthed = useCallback(async () => {
    // Cookie-session is server-side; but we still want to ensure Privy is ready
    // and the user can sign.
    if (!ready)
      throw new Error("Auth is still loading. Try again in a moment.");
    if (!authenticated) {
      await login();
    }
  }, [ready, authenticated, login]);

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

      // Keep cache VERY short so we don't waste money on stale blockhash/priority fee spikes.
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
   * Prefetch a build right before user hits confirm.
   * (We keep TTL short so we don’t sign stale blockhash.)
   */
  const prefetch = useCallback(
    async (input: UsdcSwapInput): Promise<void> => {
      if (!input.fromOwnerBase58 || !USDC_MINT) return;
      try {
        await ensureAuthed();
      } catch {
        // Non-fatal: prefetch is just a speed optimization
        return;
      }

      let inputMint: string;
      let outputMint: string;
      let amountUnits: number;
      let isMax = false;

      if (input.kind === "buy") {
        const fx = input.fxRate || 1;
        const notionalUsd =
          Number.isFinite(input.amountDisplay) && input.amountDisplay > 0
            ? input.amountDisplay / fx
            : 0;
        if (notionalUsd <= 0) return;

        amountUnits = safeUnitsFromUi(notionalUsd, USDC_DECIMALS);
        if (!amountUnits) return;

        inputMint = USDC_MINT;
        outputMint = input.outputMint;
      } else {
        isMax = Boolean(input.isMax);
        if (isMax) {
          // server will use full balance; we just pass a dummy >0
          amountUnits = 1;
        } else {
          amountUnits = safeUnitsFromUi(input.amountUi, input.inputDecimals);
          if (!amountUnits) return;
        }
        inputMint = input.inputMint;
        outputMint = USDC_MINT;
      }

      const params = {
        fromOwnerBase58: input.fromOwnerBase58,
        inputMint,
        outputMint,
        amountUnits,
        slippageBps: input.slippageBps ?? 50,
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

        // Only cache if it’s not going to make Haven overpay.
        const pLamports = response.priorityFeeLamports ?? 0;
        if (
          Number.isFinite(pLamports) &&
          pLamports > 0 &&
          pLamports > PRIORITY_FEE_LAMPORTS_CAP
        ) {
          // Network is hot — don’t cache this, user may wait and try later.
          return;
        }

        prefetchCacheRef.current = {
          key: JSON.stringify(params),
          response,
          expires: Date.now() + 12_000, // super short TTL
        };
      } catch {
        // prefetch failure is non-fatal
      }
    },
    [ensureAuthed],
  );

  const swap = useCallback(
    async (input: UsdcSwapInput): Promise<UsdcSwapResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) throw new Error("A swap is already in progress");
      if (!USDC_MINT) throw new Error("USDC mint not configured");
      if (!input.fromOwnerBase58) throw new Error("Invalid swap parameters");

      inFlightRef.current = true;
      abortRef.current = new AbortController();

      setStatus("idle");
      setError(null);
      setSignature(null);

      // Ensure auth ready + user can sign
      await ensureAuthed();

      // Derive swap params
      let inputMint: string;
      let outputMint: string;
      let amountUnits: number;
      const kind = input.kind;
      const slippageBps = clampInt(input.slippageBps ?? 50, 1, 3_000);
      let isMax = false;

      if (input.kind === "buy") {
        // Display -> USD -> USDC units
        const fx = input.fxRate || 1;
        const notionalUsd =
          Number.isFinite(input.amountDisplay) && input.amountDisplay > 0
            ? input.amountDisplay / fx
            : 0;

        if (notionalUsd <= 0) {
          const err: UsdcSwapError = {
            message: "Amount must be greater than 0",
            code: "INVALID_AMOUNT",
          };
          setError(err);
          setStatus("error");
          throw new Error(err.message);
        }

        amountUnits = safeUnitsFromUi(notionalUsd, USDC_DECIMALS);
        if (!amountUnits) {
          const err: UsdcSwapError = {
            message: "Amount is too small",
            code: "INVALID_AMOUNT",
          };
          setError(err);
          setStatus("error");
          throw new Error(err.message);
        }

        inputMint = USDC_MINT;
        outputMint = input.outputMint;
      } else {
        isMax = Boolean(input.isMax);

        // If isMax, server ignores amountUnits and uses balance; still require a positive number to pass validation paths.
        amountUnits = isMax
          ? 1
          : safeUnitsFromUi(input.amountUi, input.inputDecimals);

        if (!amountUnits) {
          const err: UsdcSwapError = {
            message: "Amount is too small",
            code: "INVALID_AMOUNT",
          };
          setError(err);
          setStatus("error");
          throw new Error(err.message);
        }

        inputMint = input.inputMint;
        outputMint = USDC_MINT;
      }

      let priorityFeeLamports: number | undefined;

      try {
        /* ══════════ PHASE 1: BUILD ══════════ */
        setStatus("building");

        const buildParams = {
          fromOwnerBase58: input.fromOwnerBase58,
          inputMint,
          outputMint,
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
            // Small wait for fresh blockhash/fees
            await sleep(120);
          }
        }

        priorityFeeLamports = buildResp!.priorityFeeLamports;

        // ── GAS SAFETY: cap priority fee (Haven pays this) ──
        // If above cap, we fail fast with a retryable error.
        if (
          typeof priorityFeeLamports === "number" &&
          Number.isFinite(priorityFeeLamports) &&
          priorityFeeLamports > PRIORITY_FEE_LAMPORTS_CAP
        ) {
          const err: UsdcSwapError = {
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
          const err: UsdcSwapError = {
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
            const err: UsdcSwapError = {
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
                feeMint: buildResp!.feeMint, // hint for server-side fee parsing
                // pass confirm context (faster + fewer RPC calls)
                recentBlockhash: buildResp!.recentBlockhash,
                lastValidBlockHeight: buildResp!.lastValidBlockHeight,
              },
              { timeout: 30_000, signal: abortRef.current?.signal },
            );
            break;
          } catch (e) {
            // If blockhash expired after sign, we must rebuild+resign.
            if (isBlockhashError(e)) throw e;
            if (attempt === MAX_SEND_ATTEMPTS || !isRetryableError(e)) throw e;
            await sleep(150);
          }
        }

        setSignature(sendResp!.signature);

        /* ══════════ PHASE 4: DONE ══════════ */
        setStatus("done");

        const totalTime = Date.now() - startTime;

        return {
          signature: sendResp!.signature,
          kind,
          inputMint,
          outputMint,
          amountUnits,
          totalTimeMs: totalTime,
          priorityFeeLamports,
          confirmed: Boolean(sendResp!.confirmed),
        };
      } catch (e) {
        const err = e as Error & {
          code?: string;
          stage?: string;
          retryable?: boolean;
        };

        const swapError: UsdcSwapError = {
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
      isBusy:
        inFlightRef.current || !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
    }),
    [swap, prefetch, clearPrefetch, reset, status, error, signature],
  );
}
