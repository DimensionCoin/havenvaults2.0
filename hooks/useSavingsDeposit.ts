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

type DepositParams = {
  amountDisplay: number; // amount in user's display currency
  owner58?: string; // optional UI guard (expected wallet address)

  /**
   * OPTIONAL: if you already know the user's flex marginfiAccountPk (from UserProvider),
   * pass it here so the server can reuse it (and you can debug mismatches).
   *
   * NOTE: your server should still be the source of truth (DB check).
   */
  marginfiAccountHint?: string;

  signerBytes?: (txBytes: Uint8Array) => Promise<Uint8Array>;
  signal?: AbortSignal;
};

type DepositResult = {
  signature: string;
  marginfiAccount: string;
  userTokenAccount: string;

  // Debug/telemetry that helps catch “why did it create a new account?”
  reusedExistingAccount?: boolean;

  // Whether PATCH successfully recorded + persisted accountPk/principal
  recorded?: boolean;
  recordError?: string | null;

  fx: {
    targetCurrency: string;
    rateBaseToTarget: number; // base -> display currency
    amountBase: number; // amount sent to prepare route
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

const PREP_URL = "/api/savings/flex/open-and-deposit";
const SEND_URL = "/api/savings/send";
const FX_URL = "/api/fx";

type FxResponse = {
  base?: string; // "USD"
  target?: string; // user's display currency
  rate?: number; // base -> target
};

function findTokenAccountFromPrep(prep: JsonObject): string | null {
  const direct =
    readStringProp(prep, "userTokenAccount") ||
    readStringProp(prep, "tokenAccount");
  if (direct) return direct;

  const key = Object.keys(prep).find((k) => {
    const lower = k.toLowerCase();
    return lower.endsWith("ata") || lower.includes("tokenaccount");
  });
  return key ? readStringProp(prep, key) : null;
}

export function useSavingsDeposit() {
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

  // keep last-known marginfiAccount in-memory (helps even if PATCH fails)
  const lastMarginfiAccountRef = useRef<string | null>(null);

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

  const deposit = useCallback(
    async ({
      amountDisplay,
      owner58,
      marginfiAccountHint,
      signerBytes,
      signal,
    }: DepositParams): Promise<DepositResult> => {
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

      const recordOnce = async (signature: string, marginfiAccount: string) => {
        const res = await fetch(PREP_URL, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          signal,
          body: JSON.stringify({ txSig: signature, marginfiAccount }),
        });

        const raw = await res.json().catch(() => ({}));
        const jsonObj = isJsonObject(raw) ? raw : {};
        if (!res.ok || readBoolProp(jsonObj, "ok") !== true) {
          const msg =
            extractErrorField(jsonObj) || `Record failed (HTTP ${res.status}).`;
          throw new Error(msg);
        }
      };

      const doOnce = async (): Promise<DepositResult> => {
        // 0) FX: convert display -> base
        const fx = await getFx(signal);
        const amountBase = floor6(amountLocal / fx.rate);
        if (!Number.isFinite(amountBase) || amountBase <= 0) {
          throw new Error("Converted amount is invalid.");
        }

        // 1) PREPARE
        const hint =
          (typeof marginfiAccountHint === "string" && marginfiAccountHint.trim()
            ? marginfiAccountHint.trim()
            : null) || lastMarginfiAccountRef.current;

        const prepRes = await fetch(PREP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          signal,
          body: JSON.stringify({
            amountUi: amountBase,
            ensureAta: true,
            // optional hint (server is still source of truth)
            ...(hint ? { marginfiAccount: hint } : {}),
          }),
        });

        const prepJsonRaw = await prepRes.json().catch(() => ({}));
        const prepJson = isJsonObject(prepJsonRaw) ? prepJsonRaw : {};

        const transactionB64 = readStringProp(prepJson, "transaction");
        const marginfiAccount = readStringProp(prepJson, "marginfiAccount");
        const tokenAccount = findTokenAccountFromPrep(prepJson);
        const reusedExistingAccount = readBoolProp(
          prepJson,
          "reusedExistingAccount"
        );

        if (
          !prepRes.ok ||
          !transactionB64 ||
          !marginfiAccount ||
          !tokenAccount
        ) {
          const msg =
            extractErrorField(prepJson) ||
            `Prepare failed (HTTP ${prepRes.status}).`;
          throw new Error(msg);
        }

        // cache the account we’re about to use (helps even if PATCH fails)
        lastMarginfiAccountRef.current = marginfiAccount;

        const unsignedBytes = new Uint8Array(
          Buffer.from(transactionB64, "base64")
        );

        // 2) SIGN
        const signedBytes = signerBytes
          ? await signerBytes(unsignedBytes)
          : (
              await signTransaction({
                wallet: selectedWallet as any,
                transaction: unsignedBytes,
              })
            ).signedTransaction;

        const signedTxB64 = Buffer.from(signedBytes).toString("base64");

        // 3) SEND
        const sendRes = await fetch(SEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          signal,
          body: JSON.stringify({
            signedTxB64,
            accountType: "flex",
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

        // 4) RECORD (DON’T SILENTLY SWALLOW)
        let recorded = false;
        let recordError: string | null = null;

        try {
          await recordOnce(signature, marginfiAccount);
          recorded = true;
        } catch (e1) {
          // retry once (DB race / transient errors)
          try {
            await recordOnce(signature, marginfiAccount);
            recorded = true;
          } catch (e2) {
            recordError = errorMessage(
              e2,
              "Deposit succeeded but we could not record/link your account."
            );
            // we do NOT throw here because funds already moved on-chain
            // but we DO surface this so you can see it in UI/logs
            console.warn("[useSavingsDeposit] record failed:", recordError);
          }
        }

        return {
          signature,
          marginfiAccount,
          userTokenAccount: tokenAccount,
          reusedExistingAccount: reusedExistingAccount ?? undefined,
          recorded,
          recordError,
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
        const msg = errorMessage(err, "Deposit failed.");
        const low = msg.toLowerCase();

        if (low.includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            const msg2 = errorMessage(e2, "Deposit failed after retry.");
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
    deposit,
    loading,
    error,
    connectedWallet58,
  };
}
