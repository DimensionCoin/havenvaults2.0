// hooks/useBoosterPositions.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BN } from "@coral-xyz/anchor";

type EmptyObj = Record<string, never>;
type ApiSide = { long?: EmptyObj; short?: EmptyObj; none?: EmptyObj };

type RawApiPosition = {
  publicKey: string;
  symbol: "SOL" | "ETH" | "BTC";
  side: "long" | "short";
  account: {
    custody: string;
    openTime?: string;
    price: string;
    collateralUsd: string;
    sizeUsd: string;
    side?: ApiSide;
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

/* ───────── HELPERS ───────── */

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

function safeBool(v: unknown): boolean {
  return v === true;
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
  isLong: boolean
): number | null {
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(collateral) ||
    !Number.isFinite(sizeUsd)
  )
    return null;
  if (sizeUsd <= 0 || entry <= 0) return null;

  const ratio = collateral / sizeUsd;
  if (!Number.isFinite(ratio)) return null;

  return isLong ? entry * (1 - ratio) : entry * (1 + ratio);
}

/* ───────── HOOK ───────── */

export function useBoosterPositions(args: {
  ownerBase58?: string;
  refreshKey?: number;
  enabled?: boolean;
}) {
  const { ownerBase58, refreshKey, enabled = true } = args;

  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<RawApiPosition[]>([]);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /* ───────── Convex price subscriptions (real-time updates!) ───────── */

  // Subscribe to all prices at once - Convex handles the real-time updates
  const convexPrices = useQuery(api.prices.getLatest);

  // Convert Convex prices to a lookup map
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
    if (!enabled) {
      if (aliveRef.current) {
        setLoading(false);
        setError(null);
        setPositions([]);
      }
      return;
    }

    const owner = safeStr(ownerBase58).trim();
    if (!owner) {
      if (aliveRef.current) {
        setPositions([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    const myReqId = ++reqIdRef.current;
    const controller = new AbortController();

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

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const data = (await res.json().catch(() => null)) as {
        positions?: RawApiPosition[];
      } | null;

      const positionsRaw = Array.isArray(data?.positions)
        ? data!.positions!
        : [];

      // Sanitize positions
      const sanitized: RawApiPosition[] = positionsRaw
        .map((p) => {
          const symbol = safeSymbol(p?.symbol);
          const pk = safeStr(p?.publicKey);
          const acct = p?.account;

          if (!symbol || !pk || !acct) return null;

          return {
            publicKey: pk,
            symbol,
            side: p?.side === "short" ? "short" : "long",
            account: {
              custody: safeStr(acct.custody),
              openTime: safeStr(acct.openTime),
              price: safeStr(acct.price),
              collateralUsd: safeStr(acct.collateralUsd),
              sizeUsd: safeStr(acct.sizeUsd),
              side: acct.side ?? {},
            },
          } as RawApiPosition;
        })
        .filter(Boolean) as RawApiPosition[];

      if (!aliveRef.current || myReqId !== reqIdRef.current) return;
      setPositions(sanitized);
    } catch (e: unknown) {
      const err = e as Error & { name?: string };
      const msg = err?.name === "AbortError" ? "" : safeStr(err?.message);
      if (!aliveRef.current || myReqId !== reqIdRef.current) return;
      setError(msg || "Failed to fetch positions.");
      setPositions([]);
    } finally {
      if (!aliveRef.current || myReqId !== reqIdRef.current) return;
      setLoading(false);
    }

    return () => controller.abort();
  }, [enabled, ownerBase58]);

  /* ───────── Compute rows with live prices ───────── */

  const rows = useMemo<BoosterRow[]>(() => {
    if (!positions.length) return [];

    return positions.map((p) => {
      const entryUsd = usdFrom6Str(p.account.price);
      const sizeUsd = usdFrom6Str(p.account.sizeUsd);
      const collateralUsd = usdFrom6Str(p.account.collateralUsd);

      const accountSide = p.account.side ?? {};
      const isLong =
        p.side === "long"
          ? true
          : p.side === "short"
            ? false
            : safeBool(accountSide.long);

      // Use Convex price, fallback to entry price
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

  /* ───────── Fetch positions on mount and refresh ───────── */

  useEffect(() => {
    if (!enabled || !ownerBase58?.trim()) return;
    void fetchPositions();
  }, [enabled, ownerBase58, refreshKey, fetchPositions]);

  /* ───────── Poll positions (not prices!) every 30 seconds ───────── */
  // Prices update in real-time via Convex subscription
  // Positions only change when user opens/closes, so 30s is fine

  useEffect(() => {
    if (!enabled || !ownerBase58?.trim()) return;

    // Pause polling when tab is hidden
    let iv: NodeJS.Timeout | null = null;

    const start = () => {
      if (iv) return;
      iv = setInterval(() => void fetchPositions(), 30_000);
    };

    const stop = () => {
      if (iv) clearInterval(iv);
      iv = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void fetchPositions(); // Refresh when tab becomes visible
        start();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, ownerBase58, fetchPositions]);

  return useMemo(
    () => ({
      loading,
      rows,
      error,
      refetch: fetchPositions,
      // Expose price loading state
      pricesLoading: convexPrices === undefined,
    }),
    [loading, rows, error, fetchPositions, convexPrices]
  );
}
