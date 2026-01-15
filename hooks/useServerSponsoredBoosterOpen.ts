"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import {
  useWallets,
  useSignTransaction,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { Buffer } from "buffer";

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}
if (typeof window !== "undefined") window.Buffer = window.Buffer || Buffer;

/* ───────── EXPORTED TYPES ───────── */

export type BoosterStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "waiting-for-refund"
  | "sweeping"
  | "done"
  | "error";

export type RunArgs = {
  ownerBase58: string;
  symbol: "BTC" | "ETH" | "SOL";
  side: "long" | "short";
  leverage: 1.5 | 2;
  marginUnits: number;
  priceSlippageBps?: number;
  autoSweep?: boolean;
  sweepMaxAttempts?: number;
};

export type RunResult = {
  openSignature: string;
  openTraceId: string;
  openConfirmed: boolean;
  sweepAttempted: boolean;
  sweepSuccess: boolean;
  sweepSignature: string | null;
  sweepTraceId: string | null;
  sweepSkippedReason?: string;
  ownerLamportsAfterOpen: number | null;
  ownerLamportsFinal: number | null;
  totalTimeMs: number;
  warnings?: string[];
};

/* ───────── INTERNAL TYPES ───────── */

type BoosterOpenBuildResponse = {
  transaction: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  meta?: {
    symbol?: string;
    side?: string;
    leverage?: number;
    marginUnits?: string;
    collateralUnits?: string;
    sizeUsdUnits?: string;
    feeUnits?: string;
    position?: string;
    positionRequest?: string;
    requestCounter?: string;
    priceSlippageBps?: number;
    custody?: string;
    collateralCustody?: string;
    ownerLamportsBefore?: number;
    topUpLamports?: number;
    predictedOwnerRentNeed?: number;
    keepDustLamports?: number;
    jupMinWalletLamports?: number;
    safeSolBufferLamports?: number;
    buildTimeMs?: number;
  };
};

type BoosterSweepBuildResponse = {
  transaction: string | null;
  traceId: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  meta?: {
    reason?: string;
    ownerLamports?: number;
    keepLamports?: number;
    drainLamports?: number;
    userMessage?: string;
  };
};

type BoosterSendResponse = {
  signature: string;
  traceId: string;
  confirmed?: boolean;
  owner?: string | null;
  ownerLamportsAfter?: number | null;
  dustExceeded?: boolean;
};

/* ───────── CONSTANTS ───────── */

const KEEP_DUST_LAMPORTS = 900_000;
const DUST_TOLERANCE = 100_000;
const MAX_ALLOWED_LAMPORTS = KEEP_DUST_LAMPORTS + DUST_TOLERANCE;

const KEEPER_INITIAL_WAIT_MS = 3_000;
const KEEPER_POLL_INTERVAL_MS = 2_000;
const KEEPER_MAX_WAIT_MS = 30_000;
const SWEEP_RETRY_DELAY_MS = 2_000;
const EXPECTED_REFUND_MIN = 3_000_000;

// USDC mint for fee tracking
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "";
const USDC_DECIMALS = 6;

/* ───────── HELPERS ───────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toB64 = (tx: VersionedTransaction) =>
  Buffer.from(tx.serialize()).toString("base64");

const fromB64 = (b64: string) =>
  VersionedTransaction.deserialize(new Uint8Array(Buffer.from(b64, "base64")));

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
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
      d?.userMessage ||
      d?.error ||
      d?.message ||
      `Request failed: ${res.status}`;
    const e = new Error(String(msg)) as Error & {
      code?: string;
      raw?: unknown;
      status?: number;
    };
    e.code = d?.code as string | undefined;
    e.raw = data;
    e.status = res.status;
    throw e;
  }

  return data as T;
}

function findWallet(
  wallets: ConnectedStandardSolanaWallet[] | undefined,
  address: string
): ConnectedStandardSolanaWallet | null {
  if (!address || !wallets?.length) return null;
  return wallets.find((w) => w.address?.trim() === address.trim()) ?? null;
}

function isBlockhashError(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return msg.includes("blockhash") || msg.includes("expired");
}

function isUserRejection(e: unknown): boolean {
  const msg = String((e as Error)?.message || "").toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("cancelled")
  );
}

/* ───────── HOOK ───────── */

export function useServerSponsoredBoosterOpen() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [status, setStatus] = useState<BoosterStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [openSig, setOpenSig] = useState<string | null>(null);
  const [sweepSig, setSweepSig] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortedRef = useRef(false);

  // ───────── Wallet Signing ─────────

  const signWithWallet = useCallback(
    async (address: string, tx: VersionedTransaction) => {
      const wallet = findWallet(wallets, address);
      if (!wallet) {
        throw new Error("Wallet not connected. Please reconnect.");
      }
      const txBytes = new Uint8Array(tx.serialize());
      const resp = await signTransaction({ transaction: txBytes, wallet });
      return VersionedTransaction.deserialize(
        new Uint8Array(resp.signedTransaction)
      );
    },
    [wallets, signTransaction]
  );

  // ───────── Balance Check ─────────

  const getBalance = useCallback(async (address: string) => {
    try {
      const resp = await postJSON<{ ok: boolean; lamports?: number }>(
        "/api/booster/balance-sol",
        { ownerBase58: address }
      );
      return resp.ok ? (resp.lamports ?? null) : null;
    } catch {
      return null;
    }
  }, []);

  // ───────── API Calls ─────────

  const buildOpenTx = useCallback(async (args: RunArgs) => {
    return postJSON<BoosterOpenBuildResponse>("/api/booster/open", {
      ownerBase58: args.ownerBase58,
      symbol: args.symbol,
      side: args.side,
      leverage: args.leverage,
      marginUnits: args.marginUnits,
      priceSlippageBps: args.priceSlippageBps ?? 500,
    });
  }, []);

  const buildSweepTx = useCallback(async (address: string) => {
    return postJSON<BoosterSweepBuildResponse>("/api/booster/sweep-sol", {
      ownerBase58: address,
      keepLamports: KEEP_DUST_LAMPORTS,
    });
  }, []);

  const sendTx = useCallback(
    async (
      signedTx: VersionedTransaction,
      feeInfo?: {
        feeUnits: number;
        feeMint: string;
        feeDecimals: number;
        feeKind: string;
      }
    ) => {
      return postJSON<BoosterSendResponse>("/api/booster/send", {
        transaction: toB64(signedTx),
        // Fee tracking info (optional)
        ...(feeInfo && {
          feeUnits: feeInfo.feeUnits,
          feeMint: feeInfo.feeMint,
          feeDecimals: feeInfo.feeDecimals,
          feeKind: feeInfo.feeKind,
        }),
      });
    },
    []
  );

  // ───────── Wait for Jupiter Keeper ─────────

  const waitForKeeperRefund = useCallback(
    async (address: string, balanceAfterOpen: number | null) => {
      const startTime = Date.now();
      const baseline = balanceAfterOpen ?? 0;

      // Initial wait for keeper to pick up request
      await sleep(KEEPER_INITIAL_WAIT_MS);

      let lastBalance = baseline;
      let refundDetected = false;

      while (Date.now() - startTime < KEEPER_MAX_WAIT_MS) {
        if (abortedRef.current) break;

        const currentBalance = await getBalance(address);

        if (currentBalance !== null) {
          lastBalance = currentBalance;

          // Check for significant balance increase (rent refund)
          if (currentBalance - baseline >= EXPECTED_REFUND_MIN) {
            refundDetected = true;
            console.log(
              `[Keeper] Refund: +${currentBalance - baseline} lamports`
            );
            break;
          }

          // Or if balance is sweepable
          if (currentBalance > MAX_ALLOWED_LAMPORTS) {
            await sleep(KEEPER_POLL_INTERVAL_MS);
            const confirm = await getBalance(address);
            if (confirm !== null && confirm > MAX_ALLOWED_LAMPORTS) {
              lastBalance = confirm;
              refundDetected = true;
              break;
            }
          }
        }

        await sleep(KEEPER_POLL_INTERVAL_MS);
      }

      const finalBalance = await getBalance(address);
      return {
        refundReceived: refundDetected,
        finalBalance: finalBalance ?? lastBalance,
        waitedMs: Date.now() - startTime,
      };
    },
    [getBalance]
  );

  // ───────── Sweep with Retries ─────────

  const executeSweep = useCallback(
    async (address: string, maxAttempts: number) => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (abortedRef.current) {
          return {
            success: false,
            signature: null,
            traceId: null,
            skippedReason: "Cancelled",
            finalBalance: null,
          };
        }

        try {
          // Check if sweep needed
          const balance = await getBalance(address);
          if (balance !== null && balance <= MAX_ALLOWED_LAMPORTS) {
            return {
              success: true,
              signature: null,
              traceId: null,
              skippedReason: "Balance already at target",
              finalBalance: balance,
            };
          }

          // Build sweep tx
          const sweepBuild = await buildSweepTx(address);

          if (!sweepBuild.transaction) {
            const reason = sweepBuild.meta?.reason;
            if (reason === "NOTHING_TO_SWEEP" || reason === "BELOW_MINIMUM") {
              return {
                success: true,
                signature: null,
                traceId: sweepBuild.traceId,
                skippedReason: sweepBuild.meta?.userMessage || reason,
                finalBalance: sweepBuild.meta?.ownerLamports ?? null,
              };
            }
            throw new Error("Sweep returned null transaction");
          }

          // Sign and send (no fee tracking for sweep)
          const signedSweep = await signWithWallet(
            address,
            fromB64(sweepBuild.transaction)
          );
          const sendResp = await sendTx(signedSweep);

          setSweepSig(sendResp.signature);
          console.log(`[Sweep] Success: ${sendResp.signature.slice(0, 8)}...`);

          await sleep(1000);
          const finalBalance = await getBalance(address);

          return {
            success: true,
            signature: sendResp.signature,
            traceId: sendResp.traceId,
            finalBalance,
          };
        } catch (e) {
          console.warn(
            `[Sweep ${attempt}/${maxAttempts}]`,
            (e as Error)?.message
          );

          if (isUserRejection(e)) {
            return {
              success: false,
              signature: null,
              traceId: null,
              skippedReason: "User cancelled sweep",
              finalBalance: await getBalance(address),
            };
          }

          if (attempt >= maxAttempts) {
            return {
              success: false,
              signature: null,
              traceId: null,
              skippedReason: `Sweep failed: ${(e as Error)?.message}`,
              finalBalance: await getBalance(address),
            };
          }

          await sleep(SWEEP_RETRY_DELAY_MS);
        }
      }

      return {
        success: false,
        signature: null,
        traceId: null,
        skippedReason: "Exhausted retries",
        finalBalance: await getBalance(address),
      };
    },
    [getBalance, buildSweepTx, signWithWallet, sendTx]
  );

  // ───────── Main Run Function ─────────

  const run = useCallback(
    async (args: RunArgs): Promise<RunResult> => {
      const startTime = Date.now();

      if (inFlightRef.current) {
        throw new Error("A trade is already in progress");
      }

      // Validate
      if (args.leverage !== 1.5 && args.leverage !== 2) {
        throw new Error("Leverage must be 1.5 or 2");
      }
      if (!args.ownerBase58 || args.marginUnits <= 0) {
        throw new Error("Invalid trade parameters");
      }

      inFlightRef.current = true;
      abortedRef.current = false;

      const autoSweep = args.autoSweep !== false;
      const sweepMaxAttempts = Math.max(1, args.sweepMaxAttempts ?? 5);

      // Reset state
      setError(null);
      setOpenSig(null);
      setSweepSig(null);

      const warnings: string[] = [];

      try {
        /* ══════════ PHASE 1: BUILD & SIGN ══════════ */
        setStatus("building");

        let openBuild!: BoosterOpenBuildResponse;
        let signedOpenTx!: VersionedTransaction;

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            openBuild = await buildOpenTx(args);
            setStatus("signing");
            signedOpenTx = await signWithWallet(
              args.ownerBase58,
              fromB64(openBuild.transaction)
            );
            break;
          } catch (e) {
            if (isUserRejection(e)) throw new Error("Transaction cancelled");
            if (attempt === 1 && isBlockhashError(e)) {
              warnings.push("Refreshing transaction...");
              continue;
            }
            throw e;
          }
        }

        /* ══════════ PHASE 2: SEND WITH FEE TRACKING ══════════ */
        setStatus("sending");

        // Extract fee info from build response
        const feeUnitsStr = openBuild.meta?.feeUnits;
        const feeUnits = feeUnitsStr ? parseInt(feeUnitsStr, 10) : 0;

        // Build fee info object for send
        const feeInfo =
          feeUnits > 0 && USDC_MINT
            ? {
                feeUnits,
                feeMint: USDC_MINT,
                feeDecimals: USDC_DECIMALS,
                feeKind: "perp_open",
              }
            : undefined;

        const openResp = await sendTx(signedOpenTx, feeInfo);
        setOpenSig(openResp.signature);

        setStatus("confirming");
        const openConfirmed = openResp.confirmed ?? false;
        const balanceAfterOpen = openResp.ownerLamportsAfter ?? null;

        console.log(
          `[Open] ${openResp.signature.slice(0, 8)}... confirmed=${openConfirmed}` +
            (feeUnits > 0 ? ` fee=${feeUnits / 10 ** USDC_DECIMALS} USDC` : "")
        );

        /* ══════════ PHASE 3: WAIT FOR KEEPER ══════════ */
        let sweepAttempted = false;
        let sweepSuccess = false;
        let sweepSignature: string | null = null;
        let sweepTraceId: string | null = null;
        let sweepSkippedReason: string | undefined;
        let finalBalance = balanceAfterOpen;

        if (autoSweep && openConfirmed) {
          setStatus("waiting-for-refund");

          const refund = await waitForKeeperRefund(
            args.ownerBase58,
            balanceAfterOpen
          );

          console.log(
            `[Keeper] refund=${refund.refundReceived} balance=${refund.finalBalance} waited=${refund.waitedMs}ms`
          );

          finalBalance = refund.finalBalance;

          /* ══════════ PHASE 4: SWEEP ══════════ */
          const needsSweep =
            refund.finalBalance !== null &&
            refund.finalBalance > MAX_ALLOWED_LAMPORTS;

          if (needsSweep) {
            setStatus("sweeping");
            sweepAttempted = true;

            const sweep = await executeSweep(
              args.ownerBase58,
              sweepMaxAttempts
            );

            sweepSuccess = sweep.success;
            sweepSignature = sweep.signature;
            sweepTraceId = sweep.traceId;
            sweepSkippedReason = sweep.skippedReason;
            finalBalance = sweep.finalBalance ?? finalBalance;

            if (!sweep.success && sweep.skippedReason) {
              warnings.push(sweep.skippedReason);
            }
          } else {
            sweepSuccess = true;
            sweepSkippedReason = "No sweep needed";
          }
        } else if (autoSweep && !openConfirmed) {
          sweepSkippedReason = "Open not confirmed";
          warnings.push("Position may not have opened.");
        }

        /* ══════════ DONE ══════════ */
        setStatus("done");

        return {
          openSignature: openResp.signature,
          openTraceId: openResp.traceId,
          openConfirmed,
          sweepAttempted,
          sweepSuccess,
          sweepSignature,
          sweepTraceId,
          sweepSkippedReason,
          ownerLamportsAfterOpen: balanceAfterOpen,
          ownerLamportsFinal: finalBalance,
          totalTimeMs: Date.now() - startTime,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      } catch (e) {
        const msg =
          (e as Error)?.message ||
          (e as { raw?: { userMessage?: string } })?.raw?.userMessage ||
          "Trade failed";
        setError(msg);
        setStatus("error");
        throw e;
      } finally {
        inFlightRef.current = false;
      }
    },
    [buildOpenTx, signWithWallet, sendTx, waitForKeeperRefund, executeSweep]
  );

  // ───────── Manual Sweep ─────────

  const manualSweep = useCallback(
    async (ownerBase58: string) => {
      if (inFlightRef.current) throw new Error("Operation in progress");

      inFlightRef.current = true;
      abortedRef.current = false;

      try {
        setStatus("sweeping");
        const result = await executeSweep(ownerBase58, 3);
        setStatus(result.success ? "done" : "error");
        return {
          success: result.success,
          signature: result.signature,
          finalBalance: result.finalBalance,
        };
      } catch (e) {
        setError((e as Error)?.message || "Sweep failed");
        setStatus("error");
        throw e;
      } finally {
        inFlightRef.current = false;
      }
    },
    [executeSweep]
  );

  // ───────── Reset & Abort ─────────

  const reset = useCallback(() => {
    abortedRef.current = true;
    setStatus("idle");
    setError(null);
    setOpenSig(null);
    setSweepSig(null);
  }, []);

  const abort = useCallback(() => {
    abortedRef.current = true;
  }, []);

  // ───────── Return ─────────

  return useMemo(
    () => ({
      status,
      error,
      openSig,
      sweepSig,
      isBusy:
        inFlightRef.current || !["idle", "done", "error"].includes(status),
      isIdle: status === "idle",
      isDone: status === "done",
      isError: status === "error",
      run,
      manualSweep,
      reset,
      abort,
    }),
    [status, error, openSig, sweepSig, run, manualSweep, reset, abort]
  );
}
