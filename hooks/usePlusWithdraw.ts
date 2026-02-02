// hooks/usePlusWithdraw.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { Buffer } from "buffer";
import { assertUserIsSigner } from "./assertUserIsSigner";

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}
if (typeof window !== "undefined") window.Buffer = window.Buffer || Buffer;

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTED TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

export type PlusWithdrawStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "done"
  | "error";

export type PlusWithdrawSubStatus =
  | null
  | "fetching_rate"
  | "getting_quote"
  | "building_transaction"
  | "awaiting_signature"
  | "broadcasting"
  | "confirming_onchain";

export type PlusWithdrawParams = {
  amountDisplay: number;
  owner58?: string;
  slippageBps?: number;
  withdrawAll?: boolean;
};

export type PlusWithdrawPreview = {
  amountUi: number; // gross (what leaves the vault/system)
  feeUi: number; // treasury fee
  netUi: number; // to user
  feeRate: number;
  slippageBps: number;
  priceImpactPct: string | null;
  jupUsdWithdrawUnits: string;
  usdcOutUnits: string;
  isFullWithdraw: boolean;
  quote: {
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
  };
};

export type PlusWithdrawResult = {
  signature: string;
  totalTimeMs: number;
  duplicate?: boolean;
  traceId?: string;

  jupUsdWithdrawUnits?: string;
  usdcOutUnits?: string;
  slippageBps?: number;
  isFullWithdraw?: boolean;

  // build-side numbers (best effort preview)
  amountUi: number;
  feeUi: number;
  netUi: number;
  feeRate?: number;

  fx: {
    targetCurrency: string;
    rateBaseToTarget: number;
    amountBase: number;
    amountDisplay: number;
  };

  // send-side accounting (source of truth; parsed on-chain)
  accounting?: {
    direction: "withdraw";
    accountType: "plus";
    netUi: string;
    feeUi: string;
    totalUi: string;
    principalUi: string;
    interestUi: string;
  };

  feeRecord?: { ok: boolean; recorded?: boolean; reason?: string };
};

export type PlusWithdrawError = {
  message: string;
  code?: string;
  stage?: string;
  retryable?: boolean;
  traceId?: string;
  logs?: string[];
  retryAfterSec?: number;
};

/* ═══════════════════════════════════════════════════════════════════════════
   INTERNAL TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

type JsonObject = Record<string, unknown>;

type FxResponse = {
  base?: string;
  target?: string;
  rate?: number;
};

type BuildResponse = {
  transaction: string;

  traceId?: string;
  jupUsdWithdrawUnits?: string;
  usdcOutUnits?: string;
  slippageBps?: number;
  isFullWithdraw?: boolean;

  amountUi?: string | number;
  feeUi?: string | number;
  netUi?: string | number;
  feeRate?: number;

  quote?: {
    inAmount?: string;
    outAmount?: string;
    otherAmountThreshold?: string;
    priceImpactPct?: string;
  };
};

type SendResponse = {
  ok: boolean;
  signature: string;
  duplicate?: boolean;
  traceId?: string;
  recorded?: boolean;

  accounting?: {
    direction: string;
    accountType: string;
    netUi: string;
    feeUi: string;
    totalUi: string;
    principalUi: string;
    interestUi: string;
  };

  feeRecord?: {
    ok: boolean;
    recorded?: boolean;
    reason?: string;
  };

  ms?: number;
};

type ApiErrorShape = {
  error?: string;
  message?: string;
  userMessage?: string;
  code?: string;
  stage?: string;
  traceId?: string;
  logs?: string[];
};

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const BUILD_URL = "/api/savings/plus/withdraw/build";
const SEND_URL = "/api/savings/plus/withdraw/send";
const FX_URL = "/api/fx";

const MAX_BUILD_RETRIES = 2;
const MAX_SEND_RETRIES = 1; // keep low to avoid double-sends
const RETRY_BASE_DELAY_MS = 500;

const FX_CACHE_TTL_MS = 5 * 60 * 1000;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

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

function isUserRejection(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("declined")
  );
}

function isBlockhashError(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return msg.includes("blockhash") || msg.includes("expired");
}

function pickApiError(raw: unknown): ApiErrorShape | null {
  if (!raw) return null;
  if (isJsonObject(raw)) return raw as ApiErrorShape;
  return null;
}

function pickErrorMessage(e: unknown): string {
  const err = e as Record<string, unknown>;

  if (typeof err?.message === "string" && err.message.trim())
    return err.message;

  if (isJsonObject(err?.raw)) {
    const r = err.raw as Record<string, unknown>;
    if (typeof r?.userMessage === "string" && (r.userMessage as string).trim())
      return r.userMessage as string;
    if (typeof r?.error === "string" && (r.error as string).trim())
      return r.error as string;
    if (typeof r?.message === "string" && (r.message as string).trim())
      return r.message as string;
  }

  if (isJsonObject(err)) {
    if (
      typeof err?.userMessage === "string" &&
      (err.userMessage as string).trim()
    )
      return err.userMessage as string;
    if (typeof err?.error === "string" && (err.error as string).trim())
      return err.error as string;
  }

  return "Withdrawal failed";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getRetryAfterSec(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n) && n > 0) return n;
  return undefined;
}

async function postJSON<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
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
      retryAfterSec?: number;
    };

    e.status = res.status;
    e.url = url;
    e.raw = data ?? text ?? null;
    e.code = d?.code;
    e.stage = d?.stage;
    e.traceId = d?.traceId;
    e.logs = Array.isArray(d?.logs) ? d.logs : undefined;
    e.retryAfterSec = getRetryAfterSec(res);

    // Retry policy
    const retryable =
      res.status === 429 ||
      (res.status >= 500 && res.status < 600) ||
      isBlockhashError(e);
    e.retryable = retryable;

    throw e;
  }

  return (data ?? {}) as T;
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

/* ═══════════════════════════════════════════════════════════════════════════
   HOOK
   ═══════════════════════════════════════════════════════════════════════════ */

export function usePlusWithdraw() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<PlusWithdrawStatus>("idle");
  const [subStatus, setSubStatus] = useState<PlusWithdrawSubStatus>(null);
  const [error, setError] = useState<PlusWithdrawError | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlusWithdrawPreview | null>(null);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fxCacheRef = useRef<{
    rate: number;
    target: string;
    at: number;
  } | null>(null);

  // Prefer the first connected wallet (Privy standard wallet)
  const selectedWallet = useMemo(() => wallets?.[0] ?? null, [wallets]);

  const connectedWallet58 = useMemo(() => {
    const addr = (selectedWallet as { address?: string })?.address;
    return typeof addr === "string" && addr.trim() ? addr.trim() : null;
  }, [selectedWallet]);

  const getFx = useCallback(async (signal?: AbortSignal) => {
    const now = Date.now();
    const cached = fxCacheRef.current;
    if (cached && now - cached.at < FX_CACHE_TTL_MS) return cached;

    try {
      const raw = await getJSON<FxResponse>(FX_URL, signal);
      const rate = Number(raw.rate);
      const target = String(raw.target || "USD")
        .toUpperCase()
        .trim();
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("Bad FX rate");

      const next = { rate, target: target || "USD", at: now };
      fxCacheRef.current = next;
      return next;
    } catch {
      const next = { rate: 1, target: "USD", at: now };
      fxCacheRef.current = next;
      return next;
    }
  }, []);

  const signWithWallet = useCallback(
    async (unsignedTxBytes: Uint8Array): Promise<Uint8Array> => {
      if (!selectedWallet) throw new Error("No wallet connected");

      // Ensure it's a valid VersionedTransaction (helps catch bad build payloads)
      try {
        VersionedTransaction.deserialize(unsignedTxBytes);
      } catch {
        throw new Error("Invalid transaction payload");
      }

      const resp = await signTransaction({
        wallet: selectedWallet as Parameters<
          typeof signTransaction
        >[0]["wallet"],
        transaction: unsignedTxBytes,
      });

      // Privy returns Uint8Array here
      return resp.signedTransaction;
    },
    [selectedWallet, signTransaction],
  );

  const previewWithdraw = useCallback(
    async (params: Omit<PlusWithdrawParams, "owner58">) => {
      if (!connectedWallet58) throw new Error("No wallet connected");

      const amountDisplay = Number(params.amountDisplay);
      if (!Number.isFinite(amountDisplay) || amountDisplay <= 0)
        throw new Error("Enter a valid positive amount");

      const aborter = new AbortController();
      const signal = aborter.signal;

      setError(null);
      setPreview(null);

      setStatus("building");
      setSubStatus("getting_quote");

      const amountBase = floor6(amountDisplay);

      const buildResp = await postJSON<BuildResponse>(
        BUILD_URL,
        {
          fromOwnerBase58: connectedWallet58,
          amountUi: amountBase.toFixed(6),
          slippageBps: params.slippageBps,
          withdrawAll: params.withdrawAll ?? false,
        },
        signal,
      );

      if (!buildResp?.transaction) throw new Error("Failed to get preview");

      const amountUi = parseNumericField(buildResp.amountUi) || amountBase;
      const feeUi = parseNumericField(buildResp.feeUi);
      const netUi =
        parseNumericField(buildResp.netUi) || Math.max(0, amountUi - feeUi);

      const out: PlusWithdrawPreview = {
        amountUi,
        feeUi,
        netUi,
        feeRate: Number.isFinite(buildResp.feeRate as number)
          ? (buildResp.feeRate as number)
          : 0,
        slippageBps: buildResp.slippageBps ?? params.slippageBps ?? 0,
        priceImpactPct: buildResp.quote?.priceImpactPct ?? null,
        jupUsdWithdrawUnits: buildResp.jupUsdWithdrawUnits ?? "0",
        usdcOutUnits: buildResp.usdcOutUnits ?? "0",
        isFullWithdraw: buildResp.isFullWithdraw ?? false,
        quote: {
          inAmount: buildResp.quote?.inAmount ?? "0",
          outAmount: buildResp.quote?.outAmount ?? "0",
          otherAmountThreshold: buildResp.quote?.otherAmountThreshold ?? "0",
        },
      };

      setPreview(out);
      setStatus("idle");
      setSubStatus(null);

      return out;
    },
    [connectedWallet58],
  );

  const withdraw = useCallback(
    async (params: PlusWithdrawParams): Promise<PlusWithdrawResult> => {
      const startTime = Date.now();

      if (inFlightRef.current)
        throw new Error("A withdrawal is already in progress");

      const amountDisplay = Number(params.amountDisplay);
      if (!Number.isFinite(amountDisplay) || amountDisplay <= 0) {
        const pe: PlusWithdrawError = {
          message: "Enter a valid positive amount",
          code: "INVALID_AMOUNT",
        };
        setError(pe);
        setStatus("error");
        throw new Error(pe.message);
      }

      if (!selectedWallet || !connectedWallet58) {
        const pe: PlusWithdrawError = {
          message: "No wallet connected. Please connect your wallet.",
          code: "NO_WALLET",
        };
        setError(pe);
        setStatus("error");
        throw new Error(pe.message);
      }

      if (params.owner58) {
        const expected = new PublicKey(params.owner58).toBase58();
        if (connectedWallet58 !== expected) {
          const pe: PlusWithdrawError = {
            message: "Connected wallet doesn't match your account",
            code: "WALLET_MISMATCH",
          };
          setError(pe);
          setStatus("error");
          throw new Error(pe.message);
        }
      }

      inFlightRef.current = true;
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      setStatus("idle");
      setSubStatus(null);
      setError(null);
      setSignature(null);

      try {
        // Phase 1: FX (for metadata)
        setStatus("building");
        setSubStatus("fetching_rate");
        const fx = await getFx(signal);

        // Phase 2: Build (retry)
        setSubStatus("building_transaction");

        const amountBase = floor6(amountDisplay);
        let buildResp: BuildResponse | null = null;

        for (let attempt = 0; attempt <= MAX_BUILD_RETRIES; attempt++) {
          try {
            if (attempt > 0) setSubStatus("building_transaction");

            buildResp = await postJSON<BuildResponse>(
              BUILD_URL,
              {
                fromOwnerBase58: connectedWallet58,
                amountUi: amountBase.toFixed(6),
                slippageBps: params.slippageBps,
                withdrawAll: params.withdrawAll ?? false,
              },
              signal,
            );
            break;
          } catch (e) {
            const err = e as Error & {
              retryable?: boolean;
              retryAfterSec?: number;
            };
            const isLast = attempt === MAX_BUILD_RETRIES;

            if (isLast || !err.retryable) throw e;

            const waitMs = err.retryAfterSec
              ? err.retryAfterSec * 1000
              : RETRY_BASE_DELAY_MS * (attempt + 1);

            await sleep(waitMs);
          }
        }

        if (!buildResp?.transaction)
          throw new Error("Failed to build withdrawal transaction");

        // Build-side numbers (preview)
        const buildAmountUi =
          parseNumericField(buildResp.amountUi) || amountBase;
        const buildFeeUi = parseNumericField(buildResp.feeUi);
        const buildNetUi =
          parseNumericField(buildResp.netUi) ||
          Math.max(0, buildAmountUi - buildFeeUi);

        setPreview({
          amountUi: buildAmountUi,
          feeUi: buildFeeUi,
          netUi: buildNetUi,
          feeRate: Number.isFinite(buildResp.feeRate as number)
            ? (buildResp.feeRate as number)
            : 0,
          slippageBps: buildResp.slippageBps ?? params.slippageBps ?? 0,
          priceImpactPct: buildResp.quote?.priceImpactPct ?? null,
          jupUsdWithdrawUnits: buildResp.jupUsdWithdrawUnits ?? "0",
          usdcOutUnits: buildResp.usdcOutUnits ?? "0",
          isFullWithdraw: buildResp.isFullWithdraw ?? false,
          quote: {
            inAmount: buildResp.quote?.inAmount ?? "0",
            outAmount: buildResp.quote?.outAmount ?? "0",
            otherAmountThreshold: buildResp.quote?.otherAmountThreshold ?? "0",
          },
        });

        // Phase 3: Sign
        setStatus("signing");
        setSubStatus("awaiting_signature");

        const unsignedBytes = new Uint8Array(
          Buffer.from(buildResp.transaction, "base64"),
        );
        assertUserIsSigner(unsignedBytes, connectedWallet58);

        let signedBytes: Uint8Array;
        try {
          signedBytes = await signWithWallet(unsignedBytes);
        } catch (e) {
          if (isUserRejection(e)) throw new Error("Transaction cancelled");
          throw e;
        }

        // Phase 4: Send (retry ONLY on 429/5xx once; server has dedupe)
        setStatus("sending");
        setSubStatus("broadcasting");

        const signedTxB64 = Buffer.from(signedBytes).toString("base64");

        let sendResp: SendResponse | null = null;

        for (let attempt = 0; attempt <= MAX_SEND_RETRIES; attempt++) {
          try {
            sendResp = await postJSON<SendResponse>(
              SEND_URL,
              {
                transaction: signedTxB64,
                expectedUserBase58: connectedWallet58,
              },
              signal,
            );
            break;
          } catch (e) {
            const err = e as Error & {
              retryable?: boolean;
              retryAfterSec?: number;
            };
            const isLast = attempt === MAX_SEND_RETRIES;

            if (isLast || !err.retryable) throw e;

            const waitMs = err.retryAfterSec
              ? err.retryAfterSec * 1000
              : RETRY_BASE_DELAY_MS * (attempt + 1);

            await sleep(waitMs);
          }
        }

        if (!sendResp?.signature)
          throw new Error("No signature returned from send");

        setSignature(sendResp.signature);

        // Phase 5: Confirming (UI-only; server already did best-effort)
        setStatus("confirming");
        setSubStatus("confirming_onchain");
        await sleep(650);

        setStatus("done");
        setSubStatus(null);

        const totalTimeMs = Date.now() - startTime;

        const accounting =
          sendResp.accounting &&
          sendResp.accounting.direction === "withdraw" &&
          sendResp.accounting.accountType === "plus"
            ? {
                direction: "withdraw" as const,
                accountType: "plus" as const,
                netUi: sendResp.accounting.netUi,
                feeUi: sendResp.accounting.feeUi,
                totalUi: sendResp.accounting.totalUi,
                principalUi: sendResp.accounting.principalUi,
                interestUi: sendResp.accounting.interestUi,
              }
            : undefined;

        return {
          signature: sendResp.signature,
          totalTimeMs,
          duplicate: Boolean(sendResp.duplicate),
          traceId: buildResp.traceId ?? sendResp.traceId,

          jupUsdWithdrawUnits: buildResp.jupUsdWithdrawUnits,
          usdcOutUnits: buildResp.usdcOutUnits,
          slippageBps: buildResp.slippageBps,
          isFullWithdraw: buildResp.isFullWithdraw,

          amountUi: buildAmountUi,
          feeUi: buildFeeUi,
          netUi: buildNetUi,
          feeRate: buildResp.feeRate,

          fx: {
            targetCurrency: fx.target,
            rateBaseToTarget: fx.rate,
            amountBase,
            amountDisplay,
          },

          accounting,
          feeRecord: sendResp.feeRecord ?? undefined,
        };
      } catch (e) {
        const err = e as Error & {
          status?: number;
          code?: string;
          stage?: string;
          retryable?: boolean;
          raw?: unknown;
          traceId?: string;
          logs?: string[];
          retryAfterSec?: number;
        };

        const api = pickApiError((err as any)?.raw);
        const plusErr: PlusWithdrawError = {
          message: api?.userMessage || pickErrorMessage(e),
          code: api?.code || err.code,
          stage: api?.stage || err.stage,
          traceId: api?.traceId || err.traceId,
          logs: api?.logs || err.logs,
          retryable: Boolean(err.retryable),
          retryAfterSec: err.retryAfterSec,
        };

        setError(plusErr);
        setStatus("error");
        setSubStatus(null);

        throw new Error(plusErr.message);
      } finally {
        inFlightRef.current = false;
        abortRef.current = null;
      }
    },
    [connectedWallet58, getFx, selectedWallet, signWithWallet],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setStatus("idle");
    setSubStatus(null);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    inFlightRef.current = false;
    setStatus("idle");
    setSubStatus(null);
    setError(null);
    setSignature(null);
    setPreview(null);
  }, []);

  return useMemo(
    () => ({
      // actions
      withdraw,
      previewWithdraw,
      cancel,
      reset,

      // state
      status,
      subStatus,
      error,
      signature,
      preview,
      connectedWallet58,

      // convenience
      isBusy: !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
      statusMessage: getStatusMessage(status, subStatus),
    }),
    [
      withdraw,
      previewWithdraw,
      cancel,
      reset,
      status,
      subStatus,
      error,
      signature,
      preview,
      connectedWallet58,
    ],
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATUS MESSAGE
   ═══════════════════════════════════════════════════════════════════════════ */

function getStatusMessage(
  status: PlusWithdrawStatus,
  subStatus: PlusWithdrawSubStatus,
): string {
  if (status === "idle") return "";
  if (status === "done") return "Withdrawal complete!";
  if (status === "error") return "Withdrawal failed";

  switch (subStatus) {
    case "fetching_rate":
      return "Fetching exchange rate...";
    case "getting_quote":
      return "Getting withdrawal quote...";
    case "building_transaction":
      return "Building transaction...";
    case "awaiting_signature":
      return "Waiting for signature...";
    case "broadcasting":
      return "Broadcasting transaction...";
    case "confirming_onchain":
      return "Confirming on-chain...";
    default:
      switch (status) {
        case "building":
          return "Preparing withdrawal...";
        case "signing":
          return "Please sign the transaction";
        case "sending":
          return "Sending transaction...";
        case "confirming":
          return "Confirming...";
        default:
          return "Processing...";
      }
  }
}
