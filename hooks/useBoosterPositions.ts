// hooks/useBoosterPositions.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BN } from "@coral-xyz/anchor";

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */

type EmptyObj = Record<string, never>;
type ApiSide = { long?: EmptyObj; short?: EmptyObj; none?: EmptyObj };

type RawApiPosition = {
  publicKey: string;
  symbol: "SOL" | "ETH" | "BTC";
  side: "long" | "short";
  account: {
    custody: string;
    openTime?: string;
    price: string; // 6-dec fixed (micro-USD) string from program
    collateralUsd: string; // 6-dec fixed string
    sizeUsd: string; // 6-dec fixed string
    side?: ApiSide; // optional; present in some decoded payloads
  };
};

export type BoosterRow = {
  id: string;
  symbol: "SOL" | "ETH" | "BTC";
  isLong: boolean;
  createdAt: string;

  entryUsd: number;
  markUsd: number;

  sizeUsd: number;
  collateralUsd: number;
  sizeTokens: number;
  spotValueUsd: number;

  pnlUsd: number;
  netUsd: number;
  liqUsd: number | null;

  publicKey: string;
};

type UseBoosterPositionsArgs = {
  ownerBase58?: string;
  refreshKey?: number;
  enabled?: boolean;
};

type ApiResponse = { positions?: RawApiPosition[] };

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */

function usdFrom6Str(x: string | BN | undefined | null): number {
  try {
    if (x === null || x === undefined) return 0;
    const s = typeof x === "string" ? x : x.toString(10);
    if (!s) return 0;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n / 1e6;
  } catch {
    return 0;
  }
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function safeSymbol(v: unknown): "SOL" | "ETH" | "BTC" | null {
  const s = safeStr(v).toUpperCase();
  if (s === "SOL" || s === "ETH" || s === "BTC") return s;
  return null;
}

function estimateLiqPrice(
  entry: number,
  collateral: number,
  sizeUsd: number,
  isLong: boolean,
): number | null {
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(collateral) ||
    !Number.isFinite(sizeUsd)
  ) {
    return null;
  }
  if (sizeUsd <= 0 || entry <= 0) return null;

  const ratio = collateral / sizeUsd;
  if (!Number.isFinite(ratio)) return null;

  // simple approximation (you already know it’s an estimate)
  return isLong ? entry * (1 - ratio) : entry * (1 + ratio);
}

/* ─────────────────────────────────────────────────────────────
   POLLING CONSTANTS
───────────────────────────────────────────────────────────── */

const STEADY_POLL_MS = 60_000; // 1 minute (normal)
const BURST_POLL_MS = 5_000; // 5 seconds (after action)
const BURST_DURATION_MS = 30_000; // burst lasts 30 seconds

/* ─────────────────────────────────────────────────────────────
   HOOK
───────────────────────────────────────────────────────────── */

export function useBoosterPositions(args: UseBoosterPositionsArgs) {
  const { ownerBase58, refreshKey, enabled = true } = args;

  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<RawApiPosition[]>([]);
  const [error, setError] = useState<string | null>(null);

  // keep last good result on transient network errors
  const lastGoodRef = useRef<RawApiPosition[] | null>(null);

  // stale request protection + aborts
  const reqIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  // burst polling state
  const burstUntilRef = useRef(0);
  const [burstTick, setBurstTick] = useState(0);

  // mounted guard
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  /* ───────── Convex prices (real-time updates) ───────── */

  const convexPrices = useQuery(api.prices.getLatest);

  const priceMap = useMemo(() => {
    const map: Record<"SOL" | "ETH" | "BTC", number> = {
      SOL: 0,
      ETH: 0,
      BTC: 0,
    };

    if (!convexPrices) return map;

    for (const row of convexPrices) {
      const sym = row.symbol as "SOL" | "ETH" | "BTC";
      if (sym === "SOL" || sym === "ETH" || sym === "BTC") {
        map[sym] = row.lastPrice;
      }
    }
    return map;
  }, [convexPrices]);

  /* ───────── Fetch positions from backend ───────── */

  const fetchPositions = useCallback(async () => {
    // disabled: hard reset
    if (!enabled) {
      controllerRef.current?.abort();
      controllerRef.current = null;

      if (aliveRef.current) {
        setLoading(false);
        setError(null);
        setPositions([]);
        lastGoodRef.current = null;
      }
      return;
    }

    const owner = safeStr(ownerBase58).trim();
    if (!owner) {
      // owner missing: treat as "no data" without error
      controllerRef.current?.abort();
      controllerRef.current = null;

      if (aliveRef.current) {
        setLoading(false);
        setError(null);
        setPositions([]);
        lastGoodRef.current = null;
      }
      return;
    }

    // abort previous request and start a new one
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const myReqId = ++reqIdRef.current;

    if (aliveRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const res = await fetch("/api/booster/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerBase58: owner }),
        cache: "no-store",
        signal: controller.signal,
      });

      // ignore if stale/unmounted
      if (!aliveRef.current || myReqId !== reqIdRef.current) return;

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const data = (await res.json().catch(() => null)) as ApiResponse | null;

      const positionsRaw = Array.isArray(data?.positions)
        ? data!.positions!
        : [];

      const sanitized: RawApiPosition[] = positionsRaw
        .map((p) => {
          const symbol = safeSymbol(p?.symbol);
          const pk = safeStr(p?.publicKey);
          const acct = p?.account;

          if (!symbol || !pk || !acct) return null;

          return {
            publicKey: pk,
            symbol,
            // normalize to a strict union; default long if malformed
            side: p?.side === "short" ? "short" : "long",
            account: {
              custody: safeStr(acct.custody),
              openTime: safeStr(acct.openTime),
              price: safeStr(acct.price),
              collateralUsd: safeStr(acct.collateralUsd),
              sizeUsd: safeStr(acct.sizeUsd),
              side: (acct.side ?? {}) as ApiSide,
            },
          };
        })
        .filter(Boolean) as RawApiPosition[];

      if (!aliveRef.current || myReqId !== reqIdRef.current) return;

      lastGoodRef.current = sanitized;
      setPositions(sanitized);
    } catch (e: unknown) {
      const err = e as Error & { name?: string };
      const isAbort = err?.name === "AbortError";

      // ignore abort/stale
      if (!aliveRef.current || myReqId !== reqIdRef.current) return;
      if (isAbort) return;

      const msg = safeStr(err?.message);

      // keep last good data on transient network issues
      if (lastGoodRef.current) {
        setPositions(lastGoodRef.current);
      } else {
        setPositions([]);
      }

      setError(msg || "Failed to fetch positions.");
    } finally {
      if (!aliveRef.current || myReqId !== reqIdRef.current) return;

      setLoading(false);

      // clear controller if it’s still ours
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [enabled, ownerBase58]);

  /* ───────── Compute rows with live prices ───────── */

  const rows = useMemo<BoosterRow[]>(() => {
    if (!positions.length) return [];

    return positions.map((p) => {
      const entryUsd = usdFrom6Str(p.account.price);
      const sizeUsd = usdFrom6Str(p.account.sizeUsd);
      const collateralUsd = usdFrom6Str(p.account.collateralUsd);

      // ✅ clean + build-safe: side is always "long" | "short" after sanitize
      const isLong = p.side === "long";

      const convexPrice = priceMap[p.symbol];
      const markUsd =
        Number.isFinite(convexPrice) && convexPrice > 0
          ? convexPrice
          : entryUsd;

      const sizeTokens = entryUsd > 0 ? sizeUsd / entryUsd : 0;
      const spotValueUsd = markUsd * sizeTokens;

      const pnlUsd =
        entryUsd > 0 && sizeUsd > 0
          ? isLong
            ? sizeUsd * ((markUsd - entryUsd) / entryUsd)
            : sizeUsd * ((entryUsd - markUsd) / entryUsd)
          : 0;

      const netUsd = collateralUsd + pnlUsd;
      const liqUsd = estimateLiqPrice(entryUsd, collateralUsd, sizeUsd, isLong);

      const openSecs = Number(safeStr(p.account.openTime || "0"));
      const createdAt =
        Number.isFinite(openSecs) && openSecs > 0 && openSecs < 10_000_000_000
          ? new Date(openSecs * 1000).toISOString()
          : new Date().toISOString();

      return {
        id: p.publicKey,
        publicKey: p.publicKey,
        symbol: p.symbol,
        isLong,
        createdAt,
        entryUsd,
        markUsd,
        sizeUsd,
        collateralUsd,
        sizeTokens,
        spotValueUsd,
        pnlUsd,
        netUsd,
        liqUsd,
      };
    });
  }, [positions, priceMap]);

  /* ───────── Burst mode trigger ───────── */

  const burst = useCallback(() => {
    burstUntilRef.current = Date.now() + BURST_DURATION_MS;
    void fetchPositions();
    setBurstTick((t) => t + 1);
  }, [fetchPositions]);

  /* ───────── Unified fetch + poll (dynamic interval) ───────── */

  useEffect(() => {
    if (!enabled || !ownerBase58?.trim()) return;

    // Enter burst mode when refreshKey changes (backward compat)
    if (refreshKey !== undefined && refreshKey > 0) {
      burstUntilRef.current = Math.max(
        burstUntilRef.current,
        Date.now() + BURST_DURATION_MS,
      );
    }

    // Immediate fetch on mount / dep change
    void fetchPositions();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const scheduleNext = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      const delay =
        Date.now() < burstUntilRef.current ? BURST_POLL_MS : STEADY_POLL_MS;
      timer = setTimeout(() => {
        if (stopped) return;
        void fetchPositions();
        scheduleNext();
      }, delay);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        void fetchPositions();
        scheduleNext();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    scheduleNext();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controllerRef.current?.abort();
      controllerRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, ownerBase58, refreshKey, burstTick, fetchPositions]);

  return useMemo(
    () => ({
      loading,
      rows,
      error,
      refetch: fetchPositions,
      burst,
      pricesLoading: convexPrices === undefined,
    }),
    [loading, rows, error, fetchPositions, burst, convexPrices],
  );
}
