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

type WithdrawParams = {
  amountDisplay: number; // amount in user's display currency (gross leaving savings)
  owner58?: string; // optional UI guard (expected wallet address)
  withdrawAll?: boolean; // if user pressed "Max"

  /**
   * Optional: if you already know user's marginfiAccountPk, you can pass it
   * but server should still be source of truth.
   */
  marginfiAccountHint?: string;

  signerBytes?: (txBytes: Uint8Array) => Promise<Uint8Array>;
  signal?: AbortSignal;
};

type WithdrawResult = {
  signature: string;

  // from withdraw prepare route
  amountUi: number; // gross in USDC (base)
  feeUi: number; // fee in USDC (base)
  netUi: number; // net user keeps after fee transfer (base)

  // debug/telemetry
  feePpm?: number;
  feePayer?: string;
  treasuryOwner?: string;
  userUsdcAta?: string;
  treasuryUsdcAta?: string;
  lastValidBlockHeight?: number;

  fx: {
    targetCurrency: string;
    rateBaseToTarget: number; // base -> display currency
    amountBase: number; // amount sent to withdraw route
    amountDisplay: number; // user input
  };
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function readStringProp(obj: JsonObject, key: string): string | null {
  return readString(obj[key]);
}
function readBoolProp(obj: JsonObject, key: string): boolean | null {
  return typeof obj[key] === "boolean" ? (obj[key] as boolean) : null;
}
function readNumProp(obj: JsonObject, key: string): number | null {
  const v = (obj as any)?.[key];
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
function readLogsTail(obj: JsonObject, max = 12): string | null {
  const raw = (obj as any)?.logs;
  if (!Array.isArray(raw)) return null;
  const logs = raw.filter(
    (entry: unknown): entry is string => typeof entry === "string"
  );
  return logs.length ? logs.slice(-max).join("\n") : null;
}
function extractErrorField(obj: JsonObject): string | null {
  const raw = (obj as any)?.error;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const maybe = (raw as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return null;
}
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return fallback;
}

const floor6 = (n: number) => Math.floor(n * 1e6) / 1e6;

// Your new route name (you said you named it "withdraw")
const WITHDRAW_URL = "/api/savings/flex/withdraw";
const SEND_URL = "/api/savings/send";
const FX_URL = "/api/fx";

type FxResponse = {
  base?: string; // "USD"
  target?: string; // user's display currency
  rate?: number; // base -> target
};

function readUiStringAsNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function useSavingsWithdraw() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWallet = useMemo(() => wallets?.[0] ?? null, [wallets]);

  const connectedWallet58 = useMemo(() => {
    const addr = (selectedWallet as any)?.address;
    return typeof addr === "string" && addr.trim() ? addr.trim() : null;
  }, [selectedWallet]);

  // cache FX for 5 minutes
  const fxCache = useRef<{ rate: number; target: string; at: number } | null>(
    null
  );

  const getFx = useCallback(async (signal?: AbortSignal) => {
    const cached = fxCache.current;
    const now = Date.now();
    if (cached && now - cached.at < 5 * 60 * 1000) return cached;

    const res = await fetch(FX_URL, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `FX failed (HTTP ${res.status}).`);
    }

    const raw = (await res.json().catch(() => ({}))) as FxResponse;
    const rate = Number(raw.rate);
    const target = String(raw.target || "USD")
      .toUpperCase()
      .trim();

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("FX returned an invalid rate.");
    }

    const next = { rate, target, at: now };
    fxCache.current = next;
    return next;
  }, []);

  const withdraw = useCallback(
    async ({
      amountDisplay,
      owner58,
      withdrawAll,
      marginfiAccountHint,
      signerBytes,
      signal,
    }: WithdrawParams): Promise<WithdrawResult> => {
      setLoading(true);
      setError(null);

      const amountLocal = Number(amountDisplay);
      if (!Number.isFinite(amountLocal) || amountLocal <= 0) {
        const msg = "Enter a valid positive amount.";
        setError(msg);
        throw new Error(msg);
      }

      if (!selectedWallet || !connectedWallet58) {
        const msg =
          "No wallet is available. Please finish setting up your wallet.";
        setError(msg);
        throw new Error(msg);
      }

      if (owner58) {
        try {
          const expected = new PublicKey(owner58).toBase58();
          if (connectedWallet58 !== expected) {
            const msg =
              "Your active wallet does not match your account wallet.";
            setError(msg);
            throw new Error(msg);
          }
        } catch {
          const msg = "Invalid owner address provided.";
          setError(msg);
          throw new Error(msg);
        }
      }

      const doOnce = async (): Promise<WithdrawResult> => {
        // 0) FX convert display -> base (USDC)
        const fx = await getFx(signal);
        const amountBase = floor6(amountLocal / fx.rate);
        if (!Number.isFinite(amountBase) || amountBase <= 0) {
          throw new Error("Converted amount is invalid.");
        }

        // 1) PREPARE WITHDRAW TX (server builds sponsored tx + fee transfer ix)
        const hint =
          typeof marginfiAccountHint === "string" && marginfiAccountHint.trim()
            ? marginfiAccountHint.trim()
            : null;

        const prepRes = await fetch(WITHDRAW_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          signal,
          body: JSON.stringify({
            amountUi: amountBase,
            withdrawAll: withdrawAll === true,
            ensureAta: true,
            ...(hint ? { marginfiAccount: hint } : {}),
            decimals: 6,
          }),
        });

        const prepJsonRaw = await prepRes.json().catch(() => ({}));
        const prepJson = isJsonObject(prepJsonRaw) ? prepJsonRaw : {};

        const transactionB64 = readStringProp(prepJson, "transaction");
        if (!prepRes.ok || !transactionB64) {
          const msg =
            extractErrorField(prepJson) ||
            `Withdraw prepare failed (HTTP ${prepRes.status}).`;
          throw new Error(msg);
        }

        // parse amounts returned by prepare route (strings often)
        const amountUiOut =
          readUiStringAsNumber((prepJson as any).amountUi) ?? amountBase;
        const feeUiOut = readUiStringAsNumber((prepJson as any).feeUi) ?? 0;
        const netUiOut =
          readUiStringAsNumber((prepJson as any).netUi) ??
          Math.max(0, amountUiOut - feeUiOut);

        const feePpm = readNumProp(prepJson, "feePpm") ?? undefined;
        const feePayer = readStringProp(prepJson, "feePayer") ?? undefined;
        const treasuryOwner =
          readStringProp(prepJson, "treasuryOwner") ?? undefined;
        const userUsdcAta =
          readStringProp(prepJson, "userUsdcAta") ?? undefined;
        const treasuryUsdcAta =
          readStringProp(prepJson, "treasuryUsdcAta") ?? undefined;
        const lastValidBlockHeight =
          readNumProp(prepJson, "lastValidBlockHeight") ?? undefined;

        const unsignedBytes = new Uint8Array(
          Buffer.from(transactionB64, "base64")
        );

        // 2) SIGN (user)
        const signedBytes = signerBytes
          ? await signerBytes(unsignedBytes)
          : (
              await signTransaction({
                wallet: selectedWallet as any,
                transaction: unsignedBytes,
              })
            ).signedTransaction;

        const signedTxB64 = Buffer.from(signedBytes).toString("base64");

        // 3) SEND (server cosigns fee payer + records DB)
        const sendRes = await fetch(SEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          signal,
          body: JSON.stringify({
            signedTxB64,
            accountType: "flex",
            // IMPORTANT: if your send route needs this for withdraw_all/amount=0,
            // you can pass it every time (harmless):
            amountUi: amountUiOut,
            decimals: 6,
          }),
        });

        const sendJsonRaw = await sendRes.json().catch(() => ({}));
        const sendJson = isJsonObject(sendJsonRaw) ? sendJsonRaw : {};
        const sendOk = readBoolProp(sendJson, "ok") === true;
        const signature = readStringProp(sendJson, "signature");

        if (!sendRes.ok || !sendOk || !signature) {
          const parts: string[] = [];
          const errMsg = extractErrorField(sendJson);
          if (errMsg) parts.push(errMsg);
          const logs = readLogsTail(sendJson);
          if (logs) parts.push(logs);
          const msg =
            parts.join("\n\n") || `Submission failed (HTTP ${sendRes.status}).`;
          throw new Error(msg);
        }

        return {
          signature,
          amountUi: amountUiOut,
          feeUi: feeUiOut,
          netUi: netUiOut,
          feePpm,
          feePayer,
          treasuryOwner,
          userUsdcAta,
          treasuryUsdcAta,
          lastValidBlockHeight,
          fx: {
            targetCurrency: fx.target,
            rateBaseToTarget: fx.rate,
            amountBase,
            amountDisplay: amountLocal,
          },
        };
      };

      try {
        return await doOnce();
      } catch (err: unknown) {
        const msg = errorMessage(err, "Withdraw failed.");
        const low = msg.toLowerCase();

        // same retry rule you used for deposits
        if (low.includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            const msg2 = errorMessage(e2, "Withdraw failed after retry.");
            setError(msg2);
            throw e2;
          }
        }

        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [connectedWallet58, getFx, selectedWallet, signTransaction]
  );

  return {
    withdraw,
    loading,
    error,
    connectedWallet58,
  };
}
