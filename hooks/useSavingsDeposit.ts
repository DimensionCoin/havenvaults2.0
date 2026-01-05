// hooks/useSavingsDeposit.ts
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

export type DepositStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "recording"
  | "done"
  | "error";

export type DepositParams = {
  amountDisplay: number;
  owner58?: string;
  marginfiAccountHint?: string;
};

export type DepositResult = {
  signature: string;
  marginfiAccount: string;
  userTokenAccount: string;
  reusedExistingAccount?: boolean;
  recorded?: boolean;
  recordError?: string | null;
  totalTimeMs: number;
  fx: {
    targetCurrency: string;
    rateBaseToTarget: number;
    amountBase: number;
    amountDisplay: number;
  };
};

export type DepositError = {
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
  marginfiAccount: string;
  userTokenAccount: string;
  reusedExistingAccount?: boolean;
};

type SendResponse = {
  ok: boolean;
  signature: string;
};

/* ───────── CONSTANTS ───────── */

const PREP_URL = "/api/savings/flex/open-and-deposit";
const SEND_URL = "/api/savings/send";
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

export function useSavingsDeposit() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<DepositStatus>("idle");
  const [error, setError] = useState<DepositError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // FX cache (5 min TTL)
  const fxCacheRef = useRef<{
    rate: number;
    target: string;
    at: number;
  } | null>(null);

  // Last known marginfi account (helps if PATCH fails)
  const lastMarginfiAccountRef = useRef<string | null>(null);

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

  // ───────── Main deposit function ─────────

  const deposit = useCallback(
    async (params: DepositParams): Promise<DepositResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) {
        throw new Error("A deposit is already in progress");
      }

      const amountDisplay = Number(params.amountDisplay);
      if (!Number.isFinite(amountDisplay) || amountDisplay <= 0) {
        const err: DepositError = {
          message: "Enter a valid positive amount",
          code: "INVALID_AMOUNT",
        };
        setError(err);
        setStatus("error");
        throw new Error(err.message);
      }

      if (!selectedWallet || !connectedWallet58) {
        const err: DepositError = {
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
            const err: DepositError = {
              message: "Connected wallet doesn't match your account",
              code: "WALLET_MISMATCH",
            };
            setError(err);
            setStatus("error");
            throw new Error(err.message);
          }
        } catch (e) {
          if ((e as Error).message.includes("match")) throw e;
          const err: DepositError = {
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

        console.log("[Deposit] FX conversion:", {
          amountDisplay,
          fxRate: fx.rate,
          amountBase,
        });

        // Build transaction
        const hint =
          params.marginfiAccountHint?.trim() || lastMarginfiAccountRef.current;

        let prepResp: PrepareResponse;

        // Retry once for blockhash errors
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            prepResp = await postJSON<PrepareResponse>(
              PREP_URL,
              {
                amountUi: amountBase,
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

        if (!prepResp!.transaction || !prepResp!.marginfiAccount) {
          throw new Error("Failed to build deposit transaction");
        }

        // Cache the marginfi account
        lastMarginfiAccountRef.current = prepResp!.marginfiAccount;

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

        /* ══════════ PHASE 5: RECORD ══════════ */
        setStatus("recording");

        let recorded = false;
        let recordError: string | null = null;

        // Use PATCH method for recording (with retry)
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const patchRes = await fetch(PREP_URL, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              cache: "no-store",
              signal,
              body: JSON.stringify({
                txSig: sendResp.signature,
                marginfiAccount: prepResp!.marginfiAccount,
              }),
            });

            if (patchRes.ok) {
              recorded = true;
              break;
            }

            const errData = await patchRes.json().catch(() => ({}));
            throw new Error(
              errData.error || `Record failed: ${patchRes.status}`
            );
          } catch (e) {
            if (attempt === 2) {
              recordError = (e as Error).message || "Failed to record deposit";
              console.warn("[Deposit] Record failed:", recordError);
            } else {
              // Brief delay before retry
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }

        setStatus("done");

        const totalTime = Date.now() - startTime;
        console.log(
          `[Deposit] ${sendResp.signature.slice(0, 8)}... ${totalTime}ms`
        );

        return {
          signature: sendResp.signature,
          marginfiAccount: prepResp!.marginfiAccount,
          userTokenAccount: prepResp!.userTokenAccount,
          reusedExistingAccount: prepResp!.reusedExistingAccount,
          recorded,
          recordError,
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
        const depositError: DepositError = {
          message: err.message || "Deposit failed",
          code: err.code,
          retryable: err.retryable || isBlockhashError(e),
        };

        setError(depositError);
        setStatus("error");

        console.error("[Deposit] Failed:", depositError);
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
      isBusy:
        inFlightRef.current || !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
    }),
    [deposit, reset, status, error, signature, connectedWallet58]
  );
}
