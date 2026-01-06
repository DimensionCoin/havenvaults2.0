// hooks/useSavingsWithdraw.ts
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

export type WithdrawStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "done"
  | "error";

export type WithdrawParams = {
  amountDisplay: number;
  owner58?: string;
  withdrawAll?: boolean;
  marginfiAccountHint?: string;
};

export type WithdrawResult = {
  signature: string;
  amountUi: number;
  feeUi: number;
  netUi: number;
  totalTimeMs: number;
  fx: {
    targetCurrency: string;
    rateBaseToTarget: number;
    amountBase: number;
    amountDisplay: number;
  };
};

export type WithdrawError = {
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

type PrepareResponse = {
  ok: boolean;
  transaction: string;
  amountUi?: string | number;
  feeUi?: string | number;
  netUi?: string | number;
  marginfiAccount?: string;
  bank?: string;
};

type SendResponse = {
  ok: boolean;
  signature: string;
};

/* ───────── CONSTANTS ───────── */

const WITHDRAW_URL = "/api/savings/flex/withdraw";
const SEND_URL = "/api/savings/send";
const FX_URL = "/api/fx";

/* ───────── HELPERS ───────── */

function floor6(n: number): number {
  return Math.floor(n * 1e6) / 1e6;
}

function parseNumericField(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
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
    const d = data as JsonObject | null;
    const msg = d?.error || d?.message || `Request failed: ${res.status}`;
    const e = new Error(String(msg)) as Error & {
      code?: string;
      retryable?: boolean;
    };
    e.code = d?.code as string | undefined;
    e.retryable = String(msg).toLowerCase().includes("blockhash");
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

/* ───────── HOOK ───────── */

export function useSavingsWithdraw() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<WithdrawStatus>("idle");
  const [error, setError] = useState<WithdrawError | null>(null);
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

  // ───────── Get FX rate ─────────

  const getFx = useCallback(async (signal?: AbortSignal) => {
    const cached = fxCacheRef.current;
    const now = Date.now();

    if (cached && now - cached.at < 5 * 60 * 1000) {
      return cached;
    }

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

  // ───────── Sign with wallet ─────────

  const signWithWallet = useCallback(
    async (txBytes: Uint8Array): Promise<Uint8Array> => {
      if (!selectedWallet) {
        throw new Error("No wallet connected");
      }

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

  // ───────── Main withdraw function ─────────

  const withdraw = useCallback(
    async (params: WithdrawParams): Promise<WithdrawResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) {
        throw new Error("A withdrawal is already in progress");
      }

      const amountDisplay = Number(params.amountDisplay);
      if (!Number.isFinite(amountDisplay) || amountDisplay <= 0) {
        const err: WithdrawError = {
          message: "Enter a valid positive amount",
          code: "INVALID_AMOUNT",
        };
        setError(err);
        setStatus("error");
        throw new Error(err.message);
      }

      if (!selectedWallet || !connectedWallet58) {
        const err: WithdrawError = {
          message: "No wallet connected. Please connect your wallet.",
          code: "NO_WALLET",
        };
        setError(err);
        setStatus("error");
        throw new Error(err.message);
      }

      // Validate owner address matches
      if (params.owner58) {
        try {
          const expected = new PublicKey(params.owner58).toBase58();
          if (connectedWallet58 !== expected) {
            const err: WithdrawError = {
              message: "Connected wallet doesn't match your account",
              code: "WALLET_MISMATCH",
            };
            setError(err);
            setStatus("error");
            throw new Error(err.message);
          }
        } catch (e) {
          if ((e as Error).message.includes("match")) throw e;
          const err: WithdrawError = {
            message: "Invalid owner address",
            code: "INVALID_OWNER",
          };
          setError(err);
          setStatus("error");
          throw new Error(err.message);
        }
      }

      inFlightRef.current = true;
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      // Reset state
      setStatus("idle");
      setError(null);
      setSignature(null);

      try {
        /* ══════════ PHASE 1: BUILD ══════════ */
        setStatus("building");

        // Get FX rate
        const fx = await getFx(signal);
        const amountBase = floor6(amountDisplay / fx.rate);

        if (!Number.isFinite(amountBase) || amountBase <= 0) {
          throw new Error("Converted amount is invalid");
        }

        console.log("[Withdraw] FX conversion:", {
          amountDisplay,
          fxRate: fx.rate,
          amountBase,
          withdrawAll: params.withdrawAll,
        });

        // Build transaction
        const hint = params.marginfiAccountHint?.trim() || undefined;

        let prepResp: PrepareResponse;

        // Retry once for blockhash errors
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            prepResp = await postJSON<PrepareResponse>(
              WITHDRAW_URL,
              {
                amountUi: amountBase,
                withdrawAll: params.withdrawAll === true,
                ensureAta: true,
                ...(hint ? { marginfiAccount: hint } : {}),
              },
              signal
            );
            break;
          } catch (e) {
            if (attempt === 2 || !isBlockhashError(e)) throw e;
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        if (!prepResp!.transaction) {
          throw new Error("Failed to build withdraw transaction");
        }

        // Parse amounts from response
        const amountUi = parseNumericField(prepResp!.amountUi) || amountBase;
        const feeUi = parseNumericField(prepResp!.feeUi);
        const netUi = parseNumericField(prepResp!.netUi) || amountUi - feeUi;

        /* ══════════ PHASE 2: SIGN ══════════ */
        setStatus("signing");

        const unsignedBytes = new Uint8Array(
          Buffer.from(prepResp!.transaction, "base64")
        );

        let signedBytes: Uint8Array;
        try {
          signedBytes = await signWithWallet(unsignedBytes);
        } catch (e) {
          if (isUserRejection(e)) {
            throw new Error("Transaction cancelled");
          }
          throw e;
        }

        /* ══════════ PHASE 3: SEND ══════════ */
        setStatus("sending");

        const signedTxB64 = Buffer.from(signedBytes).toString("base64");

        const sendResp = await postJSON<SendResponse>(
          SEND_URL,
          {
            signedTxB64,
            accountType: "flex",
          },
          signal
        );

        if (!sendResp.signature) {
          throw new Error("No signature returned from send");
        }

        setSignature(sendResp.signature);

        /* ══════════ PHASE 4: CONFIRM ══════════ */
        setStatus("confirming");

        // Brief wait to let the network confirm
        await new Promise((r) => setTimeout(r, 1000));

        /* ══════════ DONE ══════════ */
        setStatus("done");

        const totalTime = Date.now() - startTime;
        console.log(
          `[Withdraw] ${sendResp.signature.slice(0, 8)}... ${totalTime}ms | gross=${amountUi} fee=${feeUi} net=${netUi}`
        );

        return {
          signature: sendResp.signature,
          amountUi,
          feeUi,
          netUi,
          totalTimeMs: totalTime,
          fx: {
            targetCurrency: fx.target,
            rateBaseToTarget: fx.rate,
            amountBase,
            amountDisplay,
          },
        };
      } catch (e) {
        const err = e as Error & { code?: string; retryable?: boolean };
        const withdrawError: WithdrawError = {
          message: err.message || "Withdraw failed",
          code: err.code,
          retryable: err.retryable || isBlockhashError(e),
        };

        setError(withdrawError);
        setStatus("error");

        console.error("[Withdraw] Failed:", withdrawError);
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
