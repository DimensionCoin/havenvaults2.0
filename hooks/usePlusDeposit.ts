// hooks/usePlusDeposit.ts
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

export type PlusDepositStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "done"
  | "error";

export type PlusDepositParams = {
  /** Amount user enters in UI, in USD terms (USDC). */
  amountDisplay: number;
  /** Optional: enforce the connected wallet matches this owner58. */
  owner58?: string;
  /** Optional slippage for the USDC→JupUSD swap (bps). Default 50. */
  slippageBps?: number;
};

export type PlusDepositResult = {
  signature: string;
  totalTimeMs: number;

  traceId?: string;
  usdcInUnits?: number;
  jupUsdDepositUnits?: string;
  slippageBps?: number;

  fx: {
    targetCurrency: string;
    rateBaseToTarget: number;
    amountBase: number; // USDC UI amount (6dp)
    amountDisplay: number;
  };
};

export type PlusDepositError = {
  message: string;
  code?: string;
  stage?: string;
  retryable?: boolean;
  traceId?: string;
  logs?: string[];
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

  usdcInUnits?: number;
  jupUsdDepositUnits?: string;
  slippageBps?: number;

  // optional debug
  payer?: string;
  quote?: {
    inAmount?: string;
    outAmount?: string;
    otherAmountThreshold?: string;
    priceImpactPct?: string;
  };
};

type SendResponse = {
  signature: string;
  sendTimeMs?: number;
  traceId?: string;
};

type ApiErrorShape = {
  error?: string;
  message?: string;
  userMessage?: string;
  code?: string;
  stage?: string;
  traceId?: string;
  logs?: string[];
  details?: string;
};

/* ───────── CONSTANTS ───────── */

const BUILD_URL = "/api/savings/plus/deposit/build";
const SEND_URL = "/api/savings/plus/deposit/send";
const FX_URL = "/api/fx";

/* ───────── HELPERS ───────── */

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function floor6(n: number): number {
  return Math.floor(n * 1e6) / 1e6;
}

function isUserRejection(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("cancelled") ||
    msg.includes("user canceled") ||
    msg.includes("declined")
  );
}

function isBlockhashError(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return msg.includes("blockhash") || msg.includes("expired");
}

/** Prefer userMessage/code/traceId/logs if backend returns them. */
function pickApiError(raw: unknown): ApiErrorShape | null {
  if (!raw) return null;
  if (isJsonObject(raw)) return raw as ApiErrorShape;
  return null;
}

function pickErrorMessage(e: unknown): string {
  const err = e as any;

  // Error.message
  if (typeof err?.message === "string" && err.message.trim())
    return err.message;

  // Attached raw string
  if (typeof err?.raw === "string" && err.raw.trim()) return err.raw;

  // Attached raw json
  if (isJsonObject(err?.raw)) {
    const r = err.raw as any;
    if (typeof r?.userMessage === "string" && r.userMessage.trim())
      return r.userMessage;
    if (typeof r?.error === "string" && r.error.trim()) return r.error;
    if (typeof r?.message === "string" && r.message.trim()) return r.message;
  }

  // Plain object
  if (isJsonObject(err)) {
    const o = err as any;
    if (typeof o?.userMessage === "string" && o.userMessage.trim())
      return o.userMessage;
    if (typeof o?.error === "string" && o.error.trim()) return o.error;
    if (typeof o?.message === "string" && o.message.trim()) return o.message;
  }

  return "Deposit failed";
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
    const d = data && isJsonObject(data) ? (data as ApiErrorShape) : null;

    const msg =
      d?.userMessage ||
      d?.error ||
      d?.message ||
      (text && text.trim() ? text.trim() : null) ||
      `Request failed: ${res.status}`;

    const e = new Error(String(msg)) as Error & {
      status?: number;
      code?: string;
      stage?: string;
      retryable?: boolean;
      raw?: unknown;
      url?: string;
      traceId?: string;
      logs?: string[];
    };

    e.status = res.status;
    e.url = url;
    e.raw = data ?? text ?? null;

    e.code = d?.code;
    e.stage = d?.stage;
    e.traceId = d?.traceId;
    e.logs = Array.isArray(d?.logs) ? d!.logs : undefined;

    // heuristic
    e.retryable =
      Boolean(d?.code && String(d.code).toLowerCase().includes("blockhash")) ||
      String(msg).toLowerCase().includes("blockhash");

    throw e;
  }

  if (data === null) return {} as T;
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

  const text = await res.text().catch(() => "");
  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const d = data && isJsonObject(data) ? (data as ApiErrorShape) : null;
    const msg =
      d?.userMessage ||
      d?.error ||
      d?.message ||
      (text && text.trim() ? text.trim() : null) ||
      `Request failed: ${res.status}`;

    throw new Error(String(msg));
  }

  return (data ?? {}) as T;
}

/* ───────── HOOK ───────── */

export function usePlusDeposit() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<PlusDepositStatus>("idle");
  const [error, setError] = useState<PlusDepositError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // FX cache (5 min TTL) — only for metadata; deposits treat amountDisplay as USD/USDC.
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

  // ───────── FX (optional metadata) ─────────

  const getFx = useCallback(async (signal?: AbortSignal) => {
    const cached = fxCacheRef.current;
    const now = Date.now();
    if (cached && now - cached.at < 5 * 60 * 1000) return cached;

    try {
      const raw = await getJSON<FxResponse>(FX_URL, signal);
      const rate = Number(raw.rate);
      const target = String(raw.target || "USD")
        .toUpperCase()
        .trim();

      if (!Number.isFinite(rate) || rate <= 0)
        throw new Error("Invalid FX rate");
      const next = { rate, target, at: now };
      fxCacheRef.current = next;
      return next;
    } catch {
      const next = { rate: 1, target: "USD", at: now };
      fxCacheRef.current = next;
      return next;
    }
  }, []);

  // ───────── Sign ─────────

  const signWithWallet = useCallback(
    async (txBytes: Uint8Array): Promise<Uint8Array> => {
      if (!selectedWallet) throw new Error("No wallet connected");

      // Privy expects tx bytes; returns signed bytes
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

  // ───────── Main deposit ─────────

  const deposit = useCallback(
    async (params: PlusDepositParams): Promise<PlusDepositResult> => {
      const startTime = Date.now();

      if (inFlightRef.current)
        throw new Error("A deposit is already in progress");

      const amountDisplay = Number(params.amountDisplay);
      if (!Number.isFinite(amountDisplay) || amountDisplay <= 0) {
        const err: PlusDepositError = {
          message: "Enter a valid positive amount",
          code: "INVALID_AMOUNT",
        };
        setError(err);
        setStatus("error");
        throw new Error(err.message);
      }

      if (!selectedWallet || !connectedWallet58) {
        const err: PlusDepositError = {
          message: "No wallet connected. Please connect your wallet.",
          code: "NO_WALLET",
        };
        setError(err);
        setStatus("error");
        throw new Error(err.message);
      }

      // Optional owner validation
      if (params.owner58) {
        const expected = new PublicKey(params.owner58).toBase58();
        if (connectedWallet58 !== expected) {
          const err: PlusDepositError = {
            message: "Connected wallet doesn't match your account",
            code: "WALLET_MISMATCH",
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

        // Treat amountDisplay as USD/USDC UI amount. Keep 6dp.
        const amountBase = floor6(amountDisplay);
        if (!Number.isFinite(amountBase) || amountBase <= 0) {
          throw new Error("Amount too small. Increase the deposit amount.");
        }

        const fx = await getFx(signal);

        const slippageBps = Number.isFinite(params.slippageBps)
          ? Math.max(1, Math.min(10_000, Number(params.slippageBps)))
          : 50;

        let buildResp!: BuildResponse;

        // retry once on blockhash-ish failures (rare on build, but safe)
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            buildResp = await postJSON<BuildResponse>(
              BUILD_URL,
              {
                fromOwnerBase58: connectedWallet58,
                // send as string to avoid any float serialization surprises
                amountUi: amountBase.toFixed(6),
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

        if (!buildResp?.transaction)
          throw new Error("Failed to build deposit transaction");

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

        if (!sendResp?.signature)
          throw new Error("No signature returned from send");
        setSignature(sendResp.signature);

        /* ══════════ PHASE 4: CONFIRM (UI-only) ══════════ */
        setStatus("confirming");
        await new Promise((r) => setTimeout(r, 800));
        setStatus("done");

        const totalTime = Date.now() - startTime;

        return {
          signature: sendResp.signature,
          totalTimeMs: totalTime,
          traceId: buildResp.traceId ?? sendResp.traceId,
          usdcInUnits: buildResp.usdcInUnits,
          jupUsdDepositUnits: buildResp.jupUsdDepositUnits,
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
          status?: number;
          raw?: unknown;
          url?: string;
          traceId?: string;
          logs?: string[];
        };

        const api = pickApiError(err.raw);

        const plusErr: PlusDepositError = {
          message: api?.userMessage || pickErrorMessage(e),
          code: api?.code || err.code,
          stage: api?.stage || err.stage,
          traceId: api?.traceId || err.traceId,
          logs: api?.logs || err.logs,
          retryable: Boolean(err.retryable || isBlockhashError(e)),
        };

        setError(plusErr);
        setStatus("error");

        console.error("[PlusDeposit] Failed:", {
          plusErr,
          status: err.status,
          url: err.url,
          raw: err.raw,
        });

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
      deposit,
      reset,
      status,
      error,
      signature,
      connectedWallet58,

      // convenience
      isBusy:
        inFlightRef.current || !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
    }),
    [deposit, reset, status, error, signature, connectedWallet58]
  );
}
