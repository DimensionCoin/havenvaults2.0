// hooks/usePlusWithdraw.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { Buffer } from "buffer";

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}
if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

/* ───────── EXPORTED TYPES ───────── */

export type PlusWithdrawStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "done"
  | "error";

export type PlusWithdrawParams = {
  /** Amount user enters in UI (display currency). */
  amountDisplay: number;
  /** Optional: enforce the connected wallet matches this owner58. */
  owner58?: string;
  /** Optional slippage for the JupUSD→USDC swap (bps). Default 50. */
  slippageBps?: number;
  /** Optional: withdraw max (ignores amountDisplay if true). */
  isMax?: boolean;
};

export type PlusWithdrawResult = {
  signature: string;
  totalTimeMs: number;

  // Useful debug/UI fields
  traceId?: string;
  jupUsdWithdrawUnits?: string;
  slippageBps?: number;

  fx: {
    targetCurrency: string;
    rateBaseToTarget: number;
    amountBase: number; // USD amount in base currency units (6dp)
    amountDisplay: number;
  };
};

export type PlusWithdrawError = {
  message: string;
  code?: string;
  stage?: string;
  retryable?: boolean;
};

/* ───────── INTERNAL TYPES ───────── */

type JsonObject = Record<string, unknown>;

type FxResponse = {
  base?: string;
  target?: string;
  rate?: number;
};

type BuildResponse = {
  transaction: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  traceId?: string;

  jupUsdWithdrawUnits?: string;
  slippageBps?: number;

  // optional debug
  computeUnits?: number;
  priorityFeeLamports?: number;
  userJupUsdAta?: string;
  userUsdcAta?: string;
};

type SendResponse = {
  signature: string;
  sendTimeMs?: number;
};

/* ───────── CONSTANTS ───────── */

const BUILD_URL = "/api/savings/plus/withdraw/build";
const SEND_URL = "/api/savings/plus/withdraw/send";
const FX_URL = "/api/fx";

/* ───────── HELPERS ───────── */

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function floor6(n: number): number {
  return Math.floor(n * 1e6) / 1e6;
}

async function postJSON<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    cache: "no-store",
    signal,
  });

  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const d = (data && isJsonObject(data) ? data : null) as JsonObject | null;
    const msg = (d?.error || d?.message || `Request failed: ${res.status}`) as
      | string
      | undefined;

    const e = new Error(String(msg || "Request failed")) as Error & {
      code?: string;
      retryable?: boolean;
      stage?: string;
    };

    e.code = (d?.code as string | undefined) ?? undefined;
    e.stage = (d?.stage as string | undefined) ?? undefined;
    e.retryable = String(msg || "")
      .toLowerCase()
      .includes("blockhash");
    throw e;
  }

  return data as T;
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return res.json();
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
  return msg.includes("blockhash") || msg.includes("expired");
}

function clampSlippageBps(v: unknown, fallback = 50): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10_000, Math.floor(n)));
}

/* ───────── HOOK ───────── */

export function usePlusWithdraw() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<PlusWithdrawStatus>("idle");
  const [error, setError] = useState<PlusWithdrawError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // FX cache (5 min TTL)
  const fxCacheRef = useRef<{
    rate: number;
    target: string;
    at: number;
  } | null>(null);

  const selectedWallet = useMemo(() => wallets?.[0] ?? null, [wallets]);

  const connectedWallet58 = useMemo(() => {
    const addr = (selectedWallet as { address?: string })?.address;
    return typeof addr === "string" && addr.trim() ? addr.trim() : null;
  }, [selectedWallet]);

  // ───────── FX ─────────

  const getFx = useCallback(async (signal?: AbortSignal) => {
    const cached = fxCacheRef.current;
    const now = Date.now();
    if (cached && now - cached.at < 5 * 60 * 1000) return cached;

    const raw = await getJSON<FxResponse>(FX_URL, signal);
    const rate = Number(raw.rate);
    const target = String(raw.target || "USD")
      .toUpperCase()
      .trim();

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Invalid FX rate received");
    }

    const next = { rate, target, at: now };
    fxCacheRef.current = next;
    return next;
  }, []);

  // ───────── Sign ─────────

  const signWithWallet = useCallback(
    async (txBytes: Uint8Array): Promise<Uint8Array> => {
      if (!selectedWallet) throw new Error("No wallet connected");

      const { signedTransaction } = await signTransaction({
        wallet: selectedWallet as Parameters<
          typeof signTransaction
        >[0]["wallet"],
        transaction: txBytes,
      });

      return signedTransaction;
    },
    [selectedWallet, signTransaction]
  );

  // ───────── Main withdraw ─────────

  const withdraw = useCallback(
    async (params: PlusWithdrawParams): Promise<PlusWithdrawResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) {
        throw new Error("A withdrawal is already in progress");
      }

      if (!selectedWallet || !connectedWallet58) {
        const err: PlusWithdrawError = {
          message: "No wallet connected. Please connect your wallet.",
          code: "NO_WALLET",
        };
        setError(err);
        setStatus("error");
        throw new Error(err.message);
      }

      // Optional owner check
      if (params.owner58) {
        try {
          const expected = new PublicKey(params.owner58).toBase58();
          if (connectedWallet58 !== expected) {
            const err: PlusWithdrawError = {
              message: "Connected wallet doesn't match your account",
              code: "WALLET_MISMATCH",
            };
            setError(err);
            setStatus("error");
            throw new Error(err.message);
          }
        } catch (e) {
          if ((e as Error).message.includes("match")) throw e;
          const err: PlusWithdrawError = {
            message: "Invalid owner address",
            code: "INVALID_OWNER",
          };
          setError(err);
          setStatus("error");
          throw new Error(err.message);
        }
      }

      const isMax = Boolean(params.isMax);

      // Validate amount (unless max)
      const amountDisplay = Number(params.amountDisplay);
      if (!isMax) {
        if (!Number.isFinite(amountDisplay) || amountDisplay <= 0) {
          const err: PlusWithdrawError = {
            message: "Enter a valid positive amount",
            code: "INVALID_AMOUNT",
          };
          setError(err);
          setStatus("error");
          throw new Error(err.message);
        }
      }

      inFlightRef.current = true;
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      // reset per run
      setStatus("idle");
      setError(null);
      setSignature(null);

      try {
        /* ══════════ PHASE 1: BUILD ══════════ */
        setStatus("building");

        const fx = await getFx(signal);

        // Convert UI display -> base currency amount (6dp), same pattern as deposit hooks
        const amountBase = isMax ? 0 : floor6(amountDisplay / fx.rate);

        const slippageBps = clampSlippageBps(params.slippageBps, 50);

        let buildResp!: BuildResponse;

        // Retry once on blockhash issues
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            buildResp = await postJSON<BuildResponse>(
              BUILD_URL,
              {
                fromOwnerBase58: connectedWallet58,
                // build route accepts amountUi or amountUnits. We'll pass amountUi in base currency terms.
                ...(isMax ? { isMax: true } : { amountUi: amountBase }),
                slippageBps,
              },
              signal
            );
            break;
          } catch (e) {
            if (attempt === 2 || !isBlockhashError(e)) throw e;
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        if (!buildResp.transaction) {
          throw new Error("Failed to build withdraw transaction");
        }

        /* ══════════ PHASE 2: SIGN ══════════ */
        setStatus("signing");

        const unsignedBytes = new Uint8Array(
          Buffer.from(buildResp.transaction, "base64")
        );

        let signedBytes: Uint8Array;
        try {
          signedBytes = await signWithWallet(unsignedBytes);
        } catch (e) {
          if (isUserRejection(e)) throw new Error("Transaction cancelled");
          throw e;
        }

        /* ══════════ PHASE 3: SEND ══════════ */
        setStatus("sending");

        const signedTxB64 = Buffer.from(signedBytes).toString("base64");

        const sendResp = await postJSON<SendResponse>(
          SEND_URL,
          { transaction: signedTxB64 },
          signal
        );

        if (!sendResp.signature) {
          throw new Error("No signature returned from send");
        }

        setSignature(sendResp.signature);

        /* ══════════ PHASE 4: CONFIRM ══════════ */
        setStatus("confirming");
        await new Promise((r) => setTimeout(r, 1000));

        setStatus("done");

        const totalTime = Date.now() - startTime;

        return {
          signature: sendResp.signature,
          totalTimeMs: totalTime,
          traceId: buildResp.traceId,
          jupUsdWithdrawUnits: buildResp.jupUsdWithdrawUnits,
          slippageBps: buildResp.slippageBps ?? slippageBps,
          fx: {
            targetCurrency: fx.target,
            rateBaseToTarget: fx.rate,
            amountBase,
            amountDisplay,
          },
        };
      } catch (e) {
        const err = e as Error & {
          code?: string;
          retryable?: boolean;
          stage?: string;
        };
        const plusErr: PlusWithdrawError = {
          message: err.message || "Withdrawal failed",
          code: err.code,
          stage: err.stage,
          retryable: err.retryable || isBlockhashError(e),
        };

        setError(plusErr);
        setStatus("error");
        console.error("[PlusWithdraw] Failed:", plusErr);
        throw e;
      } finally {
        inFlightRef.current = false;
        abortRef.current = null;
      }
    },
    [connectedWallet58, getFx, selectedWallet, signWithWallet]
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
      withdraw,
      reset,
      status,
      error,
      signature,
      connectedWallet58,
      isBusy:
        inFlightRef.current || !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
    }),
    [withdraw, reset, status, error, signature, connectedWallet58]
  );
}
