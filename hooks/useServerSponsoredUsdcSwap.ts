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

/* env */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_SWAP_MINT || process.env.NEXT_PUBLIC_USDC_MINT;
const USDC_DECIMALS = 6;

/* types */
type JsonObject = Record<string, unknown>;

type HttpDebug = {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  durationMs: number;
  headers: Record<string, string>;
  rawText: string | null;
  json: unknown;
};

export type UsdcSwapBuyInput = {
  kind: "buy";
  fromOwnerBase58: string;
  outputMint: string;
  amountDisplay: number; // gross in display currency
  fxRate: number; // USD -> display
  slippageBps?: number;
  accessToken?: string | null;
};

export type UsdcSwapSellInput = {
  kind: "sell";
  fromOwnerBase58: string;
  inputMint: string;
  amountUi: number;
  inputDecimals: number;
  slippageBps?: number;
  accessToken?: string | null;
  isMax?: boolean;
  sweepNativeSolAfter?: boolean;
};

export type UsdcSwapInput = UsdcSwapBuyInput | UsdcSwapSellInput;

export type UsdcSwapAttemptDebug = {
  attemptId: string;
  startedAt: string;
  inputs: {
    kind: "buy" | "sell";
    fromOwnerBase58: string;
    inputMint: string;
    outputMint: string;
    amountUnits: number;
    slippageBps: number;
    isMax?: boolean;
  };
  build?: HttpDebug & { endpoint: "build" };
  send?: HttpDebug & { endpoint: "send" };
};

type State = {
  loading: boolean;
  signature: string | null;
  error: string | null;
  last?: UsdcSwapAttemptDebug;
};

type AugmentedError = Error & {
  __retryableSession?: boolean;
  __server?: unknown;
};

/* helpers */
function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null;
}
function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function readStringProp(obj: JsonObject, key: string): string | null {
  return readString(obj[key]);
}
function headersToRecord(h: Headers) {
  const rec: Record<string, string> = {};
  for (const [k, v] of h.entries()) rec[k.toLowerCase()] = v;
  return rec;
}
async function fetchWithDebug(url: string, init: RequestInit) {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const res = await fetch(url, init);
  const rawText = await res.text().catch(() => null);

  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {}

  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    res,
    url,
    method: (init.method || "GET").toUpperCase(),
    status: res.status,
    ok: res.ok,
    durationMs: Math.round(t1 - t0),
    headers: headersToRecord(res.headers),
    rawText,
    json,
  } as HttpDebug & { res: Response };
}
function extractUserMessage(obj: JsonObject): string | null {
  if (typeof obj.userMessage === "string") return obj.userMessage;
  if (typeof obj.error === "string") return obj.error;
  if (typeof obj.message === "string") return obj.message;
  return null;
}
function markError<T extends Error>(err: T, extra: Partial<AugmentedError>) {
  Object.assign(err as AugmentedError, extra);
  return err as AugmentedError;
}
function safeErrorMessage(http: HttpDebug, fallback: string) {
  const j = isJsonObject(http.json) ? http.json : null;
  const fromJson = j ? extractUserMessage(j) : null;
  if (fromJson) return fromJson;

  const raw = http.rawText?.trim();
  if (raw)
    return `HTTP ${http.status}: ${raw.replace(/\s+/g, " ").slice(0, 180)}`;
  return fallback;
}
function makeAttemptId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Pick a signing wallet:
 * 1) Prefer NON-embedded (standardWallet.name !== 'Privy') matching address
 * 2) Fallback to any wallet matching address
 */
function pickSigningWallet(
  wallets: ConnectedStandardSolanaWallet[],
  ownerBase58: string
) {
  const nonEmbedded = wallets.find(
    (w) => w.address === ownerBase58 && w.standardWallet?.name !== "Privy"
  );
  const byAddr = wallets.find((w) => w.address === ownerBase58);
  return nonEmbedded ?? byAddr ?? null;
}

export function useServerSponsoredUsdcSwap() {
  const [{ loading, signature, error, last }, setState] = useState<State>({
    loading: false,
    signature: null,
    error: null,
    last: undefined,
  });

  const { login, getAccessToken } = usePrivy();

  // ✅ This already includes Phantom/etc and embedded wallets
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction(); // returns { signedTransaction: Uint8Array } :contentReference[oaicite:1]{index=1}

  const inflight = useRef<AbortController | null>(null);
  const cleanupInflight = () => {
    inflight.current?.abort();
    inflight.current = null;
  };

  const doOnce = useCallback(
    async (payload: {
      attemptId: string;
      accessToken?: string | null;
      fromOwnerBase58: string;
      inputMint: string;
      outputMint: string;
      amountUnits: number;
      slippageBps: number;
      isMax?: boolean;
    }) => {
      const attempt: UsdcSwapAttemptDebug = {
        attemptId: payload.attemptId,
        startedAt: new Date().toISOString(),
        inputs: {
          kind: payload.outputMint === USDC_MINT ? "sell" : "buy",
          fromOwnerBase58: payload.fromOwnerBase58,
          inputMint: payload.inputMint,
          outputMint: payload.outputMint,
          amountUnits: payload.amountUnits,
          slippageBps: payload.slippageBps,
          isMax: payload.isMax,
        },
      };

      setState((s) => ({ ...s, last: attempt }));

      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(payload.accessToken
          ? { Authorization: `Bearer ${payload.accessToken}` }
          : {}),
      };

      inflight.current = new AbortController();

      // 1) BUILD: server builds tx with fee payer = HAVEN, user must be required signer
      const build = await fetchWithDebug("/api/jup/build", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fromOwnerBase58: payload.fromOwnerBase58,
          inputMint: payload.inputMint,
          outputMint: payload.outputMint,
          amountUnits: payload.amountUnits,
          slippageBps: payload.slippageBps,
          isMax: payload.isMax === true,
        }),
        cache: "no-store",
        credentials: "include",
        signal: inflight.current.signal,
      });

      attempt.build = { ...build, endpoint: "build" };
      setState((s) => ({
        ...s,
        last: { ...(s.last || attempt), build: attempt.build },
      }));

      const buildJson = isJsonObject(build.json) ? build.json : {};
      const txB64 = readStringProp(buildJson, "transaction");

      if (!build.ok || !txB64) {
        throw markError(new Error(safeErrorMessage(build, "Build failed.")), {
          __server: build.json ?? build.rawText,
        });
      }

      // 2) USER SIGN: prompts Phantom/etc (or embedded if that’s all they have)
      const unsignedBytes = Buffer.from(txB64, "base64");
      const unsignedTx = VersionedTransaction.deserialize(unsignedBytes);

      // sanity: user must be required signer
      const msgAny = unsignedTx.message as unknown as {
        header?: { numRequiredSignatures?: number };
        staticAccountKeys?: PublicKey[];
      };
      const required = Number(msgAny.header?.numRequiredSignatures ?? 0);
      const staticKeys = Array.isArray(msgAny.staticAccountKeys)
        ? msgAny.staticAccountKeys
        : [];
      const signerKeys = staticKeys
        .slice(0, required)
        .map((k) => (k instanceof PublicKey ? k : new PublicKey(k)));
      if (!signerKeys.some((k) => k.toBase58() === payload.fromOwnerBase58)) {
        throw new Error("Built transaction is missing the user as a signer.");
      }

      const userWallet = pickSigningWallet(wallets, payload.fromOwnerBase58);
      if (!userWallet) {
        throw new Error(
          "No connected wallet matches this address (connect Phantom/etc first)."
        );
      }

      const { signedTransaction } = await signTransaction({
        transaction: unsignedBytes,
        wallet: userWallet,
      });

      const userSignedB64 = Buffer.from(signedTransaction).toString("base64");

      // 3) SEND: server co-signs as HAVEN fee payer and broadcasts
      const send = await fetchWithDebug("/api/jup/send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          transaction: userSignedB64,
          ownerBase58: payload.fromOwnerBase58,
        }),
        cache: "no-store",
        credentials: "include",
        signal: inflight.current.signal,
      });

      attempt.send = { ...send, endpoint: "send" };
      setState((s) => ({
        ...s,
        last: { ...(s.last || attempt), send: attempt.send },
      }));

      if (send.status === 440) {
        throw markError(new Error(safeErrorMessage(send, "Session expired.")), {
          __retryableSession: true,
          __server: send.json ?? send.rawText,
        });
      }

      const sendJson = isJsonObject(send.json) ? send.json : {};
      const sig = readStringProp(sendJson, "signature");

      if (!send.ok || !sig) {
        throw markError(
          new Error(safeErrorMessage(send, "We couldn’t complete this trade.")),
          { __server: send.json ?? send.rawText }
        );
      }

      return sig;
    },
    [signTransaction, wallets]
  );

  const swap = useCallback(
    async (input: UsdcSwapInput) => {
      cleanupInflight();
      setState({
        loading: true,
        signature: null,
        error: null,
        last: undefined,
      });

      const attemptId = makeAttemptId();

      try {
        if (!RPC) throw new Error("Missing NEXT_PUBLIC_SOLANA_RPC.");
        if (!USDC_MINT) throw new Error("Missing NEXT_PUBLIC_USDC_MINT.");

        const slippageBps = input.slippageBps ?? 50;

        let inputMint = "";
        let outputMint = "";
        let amountUnits = 0;
        let isMax: boolean | undefined;

        if (input.kind === "buy") {
          const notionalUsd =
            Number.isFinite(input.amountDisplay) && input.amountDisplay > 0
              ? input.amountDisplay / (input.fxRate || 1)
              : 0;
          if (notionalUsd <= 0) throw new Error("Amount must be > 0.");

          amountUnits = Math.floor(notionalUsd * 10 ** USDC_DECIMALS);
          if (!Number.isFinite(amountUnits) || amountUnits <= 0)
            throw new Error("Amount is too small.");

          inputMint = USDC_MINT;
          outputMint = input.outputMint;
        } else {
          amountUnits = Math.floor(input.amountUi * 10 ** input.inputDecimals);
          if (!Number.isFinite(amountUnits) || amountUnits <= 0)
            throw new Error("Amount is too small.");

          inputMint = input.inputMint;
          outputMint = USDC_MINT;
          isMax = input.isMax === true;
        }

        try {
          const sig = await doOnce({
            attemptId,
            accessToken: input.accessToken ?? null,
            fromOwnerBase58: input.fromOwnerBase58,
            inputMint,
            outputMint,
            amountUnits,
            slippageBps,
            isMax,
          });

          setState((s) => ({ ...s, loading: false, signature: sig }));
          return sig;
        } catch (err: unknown) {
          const e = err as AugmentedError;
          if (e.__retryableSession) {
            await login();
            const fresh = await getAccessToken();

            const sig = await doOnce({
              attemptId: attemptId + "-retry",
              accessToken: fresh,
              fromOwnerBase58: input.fromOwnerBase58,
              inputMint,
              outputMint,
              amountUnits,
              slippageBps,
              isMax,
            });

            setState((s) => ({ ...s, loading: false, signature: sig }));
            return sig;
          }
          throw err;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, loading: false, error: message }));
        console.error(
          "[useServerSponsoredUsdcSwap] failed:",
          message,
          (e as any)?.__server
        );
        throw e;
      } finally {
        cleanupInflight();
      }
    },
    [doOnce, getAccessToken, login]
  );

  const reset = useCallback(() => {
    cleanupInflight();
    setState({ loading: false, signature: null, error: null, last: undefined });
  }, []);

  return useMemo(
    () => ({ swap, reset, loading, signature, error, last }),
    [swap, reset, loading, signature, error, last]
  );
}
