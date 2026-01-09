// hooks/useBundleSwap.ts
// Dedicated hook for bundle purchases
// - Sequential execution with confirmation
// - Single fee charge for entire bundle
// - Lower priority fees (cheaper, more reliable)
// - Automatic retry on transient failures

import { useCallback, useRef, useState } from "react";
import { useWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { Buffer } from "buffer";

/* ───────── TYPES ───────── */

export type BundleItemStatus =
  | "pending"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "confirmed"
  | "failed";

export type BundleItem = {
  symbol: string;
  outputMint: string;
  amountUsdcUnits: number;
  status: BundleItemStatus;
  signature?: string;
  error?: string;
};

export type BundleState = {
  items: BundleItem[];
  phase: "idle" | "executing" | "complete" | "failed";
  currentIndex: number;
  totalFeeUnits: number;
  error?: string;
};

type BuildResponse = {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  traceId: string;
  feeUnits: number;
};

type SendResponse = {
  signature: string;
  confirmed: boolean;
  traceId: string;
};

/* ───────── CONSTANTS ───────── */

const USDC_DECIMALS = 6;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

/* ───────── HELPERS ───────── */

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.userMessage || data.error || `Request failed: ${res.status}`
    );
  }

  return data as T;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("blockhash") ||
    lower.includes("expired") ||
    lower.includes("timeout") ||
    lower.includes("rate limit") ||
    lower.includes("try again")
  );
}

/* ───────── HOOK ───────── */

export function useBundleSwap() {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const abortRef = useRef(false);

  const [state, setState] = useState<BundleState>({
    items: [],
    phase: "idle",
    currentIndex: -1,
    totalFeeUnits: 0,
  });

  // Find wallet by address
  const getWallet = useCallback(
    (address: string) => {
      // Prefer non-embedded wallet
      const nonEmbedded = wallets.find(
        (w) => w.address === address && w.standardWallet?.name !== "Privy"
      );
      return nonEmbedded ?? wallets.find((w) => w.address === address) ?? null;
    },
    [wallets]
  );

  // Sign a transaction
  const signTx = useCallback(
    async (txBase64: string, ownerAddress: string): Promise<string> => {
      const wallet = getWallet(ownerAddress);
      if (!wallet) throw new Error("Wallet not connected");

      const txBytes = Buffer.from(txBase64, "base64");

      const { signedTransaction } = await signTransaction({
        transaction: txBytes,
        wallet,
      });

      return Buffer.from(signedTransaction).toString("base64");
    },
    [getWallet, signTransaction]
  );

  // Execute a single swap with retry
  const executeSwap = useCallback(
    async (
      item: BundleItem,
      index: number,
      ownerAddress: string,
      isFirst: boolean,
      totalBundleUsdcUnits: number,
      retryCount = 0
    ): Promise<{ success: boolean; signature?: string; error?: string }> => {
      try {
        // Update status: building
        setState((prev) => ({
          ...prev,
          items: prev.items.map((it, i) =>
            i === index ? { ...it, status: "building" } : it
          ),
        }));

        // Build transaction
        const buildResp = await postJSON<BuildResponse>("/api/bundle/build", {
          fromOwnerBase58: ownerAddress,
          outputMint: item.outputMint,
          amountUsdcUnits: item.amountUsdcUnits,
          slippageBps: 150, // 1.5% slippage for reliability
          includeFee: isFirst, // Only charge fee on first swap
          totalBundleUsdcUnits: isFirst ? totalBundleUsdcUnits : undefined,
        });

        if (abortRef.current) {
          return { success: false, error: "Cancelled" };
        }

        // Update fee info on first swap
        if (isFirst && buildResp.feeUnits > 0) {
          setState((prev) => ({ ...prev, totalFeeUnits: buildResp.feeUnits }));
        }

        // Update status: signing
        setState((prev) => ({
          ...prev,
          items: prev.items.map((it, i) =>
            i === index ? { ...it, status: "signing" } : it
          ),
        }));

        // Sign transaction
        let signedTx: string;
        try {
          signedTx = await signTx(buildResp.transaction, ownerAddress);
        } catch (e) {
          const msg = String(e);
          if (
            msg.toLowerCase().includes("rejected") ||
            msg.toLowerCase().includes("cancelled")
          ) {
            return { success: false, error: "User cancelled" };
          }
          throw e;
        }

        if (abortRef.current) {
          return { success: false, error: "Cancelled" };
        }

        // Update status: sending
        setState((prev) => ({
          ...prev,
          items: prev.items.map((it, i) =>
            i === index ? { ...it, status: "sending" } : it
          ),
        }));

        // Send transaction
        const sendResp = await postJSON<SendResponse>("/api/bundle/send", {
          transaction: signedTx,
          blockhash: buildResp.blockhash,
          lastValidBlockHeight: buildResp.lastValidBlockHeight,
        });

        // Update status: confirming
        setState((prev) => ({
          ...prev,
          items: prev.items.map((it, i) =>
            i === index ? { ...it, status: "confirming" } : it
          ),
        }));

        // Small delay to show confirming state
        await sleep(500);

        return { success: true, signature: sendResp.signature };
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);

        // Check if retryable
        if (isRetryableError(errorMsg) && retryCount < MAX_RETRIES) {
          console.log(
            `[Bundle] Retrying ${item.symbol} (attempt ${retryCount + 1})`
          );
          await sleep(RETRY_DELAY_MS);
          return executeSwap(
            item,
            index,
            ownerAddress,
            isFirst,
            totalBundleUsdcUnits,
            retryCount + 1
          );
        }

        return { success: false, error: errorMsg };
      }
    },
    [signTx]
  );

  // Main execute function
  const execute = useCallback(
    async (
      ownerAddress: string,
      swaps: Array<{ symbol: string; outputMint: string; amountUsd: number }>
    ): Promise<{ success: boolean; completedCount: number }> => {
      if (state.phase === "executing") {
        return { success: false, completedCount: 0 };
      }

      abortRef.current = false;

      // Convert USD amounts to USDC units
      const items: BundleItem[] = swaps.map((s) => ({
        symbol: s.symbol,
        outputMint: s.outputMint,
        amountUsdcUnits: Math.floor(s.amountUsd * 10 ** USDC_DECIMALS),
        status: "pending",
      }));

      const totalBundleUsdcUnits = items.reduce(
        (sum, it) => sum + it.amountUsdcUnits,
        0
      );

      setState({
        items,
        phase: "executing",
        currentIndex: 0,
        totalFeeUnits: 0,
      });

      let completedCount = 0;

      // Execute sequentially
      for (let i = 0; i < items.length; i++) {
        if (abortRef.current) {
          // Mark remaining as failed
          setState((prev) => ({
            ...prev,
            phase: "failed",
            items: prev.items.map((it, idx) =>
              idx >= i ? { ...it, status: "failed", error: "Cancelled" } : it
            ),
          }));
          break;
        }

        setState((prev) => ({ ...prev, currentIndex: i }));

        const result = await executeSwap(
          items[i],
          i,
          ownerAddress,
          i === 0, // First swap includes fee
          totalBundleUsdcUnits
        );

        if (result.success) {
          completedCount++;
          setState((prev) => ({
            ...prev,
            items: prev.items.map((it, idx) =>
              idx === i
                ? { ...it, status: "confirmed", signature: result.signature }
                : it
            ),
          }));

          // Wait between swaps to avoid rate limits
          if (i < items.length - 1) {
            await sleep(500);
          }
        } else {
          setState((prev) => ({
            ...prev,
            items: prev.items.map((it, idx) =>
              idx === i ? { ...it, status: "failed", error: result.error } : it
            ),
          }));

          // If user cancelled, stop everything
          if (
            result.error === "User cancelled" ||
            result.error === "Cancelled"
          ) {
            abortRef.current = true;
            setState((prev) => ({
              ...prev,
              phase: "failed",
              error: "Cancelled by user",
              items: prev.items.map((it, idx) =>
                idx > i ? { ...it, status: "failed", error: "Cancelled" } : it
              ),
            }));
            break;
          }

          // Continue with next swap even if this one failed
          // (partial success is better than stopping entirely)
        }
      }

      // Final state
      const finalItems = state.items;
      const allSucceeded = completedCount === items.length;
      const anySucceeded = completedCount > 0;

      setState((prev) => ({
        ...prev,
        phase: allSucceeded ? "complete" : anySucceeded ? "complete" : "failed",
        currentIndex: -1,
      }));

      return { success: allSucceeded, completedCount };
    },
    [state.phase, executeSwap]
  );

  // Retry failed items
  const retryFailed = useCallback(
    async (
      ownerAddress: string
    ): Promise<{ success: boolean; completedCount: number }> => {
      const failedItems = state.items.filter(
        (it) =>
          it.status === "failed" &&
          it.error !== "Cancelled" &&
          it.error !== "User cancelled"
      );

      if (failedItems.length === 0) {
        return { success: true, completedCount: 0 };
      }

      abortRef.current = false;

      setState((prev) => ({
        ...prev,
        phase: "executing",
        items: prev.items.map((it) =>
          it.status === "failed" &&
          it.error !== "Cancelled" &&
          it.error !== "User cancelled"
            ? { ...it, status: "pending", error: undefined }
            : it
        ),
      }));

      let completedCount = 0;

      for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        if (item.status !== "pending") continue;

        if (abortRef.current) break;

        setState((prev) => ({ ...prev, currentIndex: i }));

        // Don't charge fee on retry (already charged on first attempt)
        const result = await executeSwap(item, i, ownerAddress, false, 0);

        if (result.success) {
          completedCount++;
          setState((prev) => ({
            ...prev,
            items: prev.items.map((it, idx) =>
              idx === i
                ? { ...it, status: "confirmed", signature: result.signature }
                : it
            ),
          }));
        } else {
          setState((prev) => ({
            ...prev,
            items: prev.items.map((it, idx) =>
              idx === i ? { ...it, status: "failed", error: result.error } : it
            ),
          }));
        }

        // Wait between swaps
        await sleep(500);
      }

      const allDone = state.items.every(
        (it) =>
          it.status === "confirmed" ||
          (it.status === "failed" && it.error === "Cancelled")
      );

      setState((prev) => ({
        ...prev,
        phase: allDone ? "complete" : "failed",
        currentIndex: -1,
      }));

      return { success: allDone, completedCount };
    },
    [state.items, executeSwap]
  );

  // Cancel execution
  const cancel = useCallback(() => {
    abortRef.current = true;
  }, []);

  // Reset state
  const reset = useCallback(() => {
    abortRef.current = true;
    setState({
      items: [],
      phase: "idle",
      currentIndex: -1,
      totalFeeUnits: 0,
    });
  }, []);

  return {
    state,
    execute,
    retryFailed,
    cancel,
    reset,
    isExecuting: state.phase === "executing",
    isComplete: state.phase === "complete",
    hasFailed: state.items.some((it) => it.status === "failed"),
    completedCount: state.items.filter((it) => it.status === "confirmed")
      .length,
    failedCount: state.items.filter((it) => it.status === "failed").length,
  };
}
