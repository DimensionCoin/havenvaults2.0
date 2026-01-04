// hooks/useBoosterPositions.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BN } from "@coral-xyz/anchor";

type EmptyObj = Record<string, never>;
type ApiSide = { long?: EmptyObj; short?: EmptyObj; none?: EmptyObj };

type RawApiPosition = {
  publicKey: string;
  symbol: "SOL" | "ETH" | "BTC";
  side: "long" | "short";
  account: {
    custody: string;
    openTime?: string; // i64 (seconds) as string
    price: string; // u64, 1e6 (string)
    collateralUsd: string; // u64, 1e6 (string)
    sizeUsd: string; // u64, 1e6 (string)
    side?: ApiSide; // ⚠️ some APIs omit nested objects when empty
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

/**
 * ✅ SAFETY FIX: BN.toNumber() can overflow for big ints and throw.
 * We convert via string -> number, and clamp to 0 on bad input.
 */
function usdFrom6Str(x: string | BN | undefined | null): number {
  try {
    if (x === null || x === undefined) return 0;
    const s = typeof x === "string" ? x : x.toString(10);
    if (!s) return 0;

    // BN may be huge; Number(s) could be Infinity. Guard it.
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
) {
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(collateral) ||
    !Number.isFinite(sizeUsd)
  )
    return null;
  if (sizeUsd <= 0 || entry <= 0) return null;

  const ratio = collateral / sizeUsd;
  if (!Number.isFinite(ratio)) return null;

  // crude model: liquidation when loss eats collateral
  return isLong ? entry * (1 - ratio) : entry * (1 + ratio);
}

const PYTH_PRICE_IDS: Record<"SOL" | "ETH" | "BTC", string> = {
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

async function fetchHermesMarks(
  symbols: Array<"SOL" | "ETH" | "BTC">,
  signal?: AbortSignal
) {
  const uniq = Array.from(new Set(symbols)).filter(Boolean);
  const ids = uniq.map((s) => PYTH_PRICE_IDS[s]).filter(Boolean);

  if (!ids.length) return {} as Record<"SOL" | "ETH" | "BTC", number>;

  const qs = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");

  const res = await fetch(
    `https://hermes.pyth.network/v2/updates/price/latest?${qs}`,
    { cache: "no-store", signal }
  );

  if (!res.ok) {
    // don’t throw hard—return empty so UI still renders using entry price fallback
    return {} as Record<"SOL" | "ETH" | "BTC", number>;
  }

  const body = (await res.json().catch(() => null)) as {
    parsed?: Array<{ id: string; price?: { price?: string; expo?: number } }>;
  } | null;

  const parsed = Array.isArray(body?.parsed) ? body!.parsed! : [];

  const idToPrice: Record<string, number> = {};
  for (const u of parsed) {
    const id = safeStr(u?.id);
    const rawStr = safeStr(u?.price?.price);
    const expo = Number(u?.price?.expo);

    // rawStr is int string; expo is negative usually
    const raw = Number.parseInt(rawStr, 10);

    if (!id) continue;
    if (!Number.isFinite(raw) || !Number.isFinite(expo)) continue;

    const px = raw * Math.pow(10, expo);
    if (!Number.isFinite(px) || px <= 0) continue;

    idToPrice[id] = px;
  }

  const out: Partial<Record<"SOL" | "ETH" | "BTC", number>> = {};
  for (const s of uniq) {
    const id = PYTH_PRICE_IDS[s];
    const px = idToPrice[id];
    if (Number.isFinite(px) && px! > 0) out[s] = px!;
  }

  return out as Record<"SOL" | "ETH" | "BTC", number>;
}

export function useBoosterPositions(args: {
  ownerBase58?: string;
  refreshKey?: number;
  enabled?: boolean;
}) {
  const { ownerBase58, refreshKey, enabled = true } = args;

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<BoosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ✅ prevent setState after unmount / stale request races
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchAll = useCallback(async () => {
    // ✅ hard gate
    if (!enabled) {
      if (!aliveRef.current) return;
      setLoading(false);
      setError(null);
      setRows([]);
      return;
    }

    const owner = safeStr(ownerBase58).trim();
    if (!owner) {
      if (!aliveRef.current) return;
      setRows([]);
      setError(null);
      setLoading(false);
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
      if (!positionsRaw.length) {
        if (!aliveRef.current || myReqId !== reqIdRef.current) return;
        setRows([]);
        return;
      }

      // ✅ sanitize positions to prevent random undefined access downstream
      const positions: RawApiPosition[] = positionsRaw
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

      if (!positions.length) {
        if (!aliveRef.current || myReqId !== reqIdRef.current) return;
        setRows([]);
        return;
      }

      const marks = await fetchHermesMarks(
        positions.map((p) => p.symbol),
        controller.signal
      );

      const computed: BoosterRow[] = positions.map((p) => {
        const entryUsd = usdFrom6Str(p.account.price);
        const sizeUsd = usdFrom6Str(p.account.sizeUsd);
        const collateralUsd = usdFrom6Str(p.account.collateralUsd);

        // ✅ FIX: your original `!!p.account.side.long` can explode if side is undefined.
        // Also, API includes both `side: "long"|"short"` AND `account.side`.
        // We'll trust the explicit field first, fallback to account.side flags.
        const accountSide = p.account.side ?? {};
        const isLong =
          p.side === "long"
            ? true
            : p.side === "short"
              ? false
              : safeBool(accountSide.long);

        const m = marks[p.symbol];
        const markUsd = Number.isFinite(m) && m > 0 ? m : entryUsd;

        const sizeTokens = entryUsd > 0 ? sizeUsd / entryUsd : 0;
        const spotValueUsd = markUsd * sizeTokens;

        const pnlUsd =
          entryUsd > 0 && sizeUsd > 0
            ? isLong
              ? sizeUsd * ((markUsd - entryUsd) / entryUsd)
              : sizeUsd * ((entryUsd - markUsd) / entryUsd)
            : 0;

        const netUsd = collateralUsd + pnlUsd;

        const liqUsd = estimateLiqPrice(
          entryUsd,
          collateralUsd,
          sizeUsd,
          isLong
        );

        // openTime is i64 seconds string; Number() can be NaN, huge, etc.
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

      if (!aliveRef.current || myReqId !== reqIdRef.current) return;
      setRows(computed);
    } catch (e: any) {
      // Abort is not an “error” the user should see
      const msg = safeStr(e?.name) === "AbortError" ? "" : safeStr(e?.message);
      if (!aliveRef.current || myReqId !== reqIdRef.current) return;
      setError(msg || "Failed to fetch boosted positions.");
      setRows([]);
    } finally {
      if (!aliveRef.current || myReqId !== reqIdRef.current) return;
      setLoading(false);
    }

    return () => controller.abort();
  }, [enabled, ownerBase58]);

  // ✅ fetch on mount / refreshKey only if enabled + has owner
  useEffect(() => {
    if (!enabled || !ownerBase58?.trim()) return;
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ownerBase58, refreshKey, fetchAll]);

  // ✅ polling only if enabled + has owner
  useEffect(() => {
    if (!enabled || !ownerBase58?.trim()) return;
    const iv = setInterval(() => void fetchAll(), 10_000);
    return () => clearInterval(iv);
  }, [enabled, ownerBase58, fetchAll]);

  return useMemo(
    () => ({ loading, rows, error, refetch: fetchAll }),
    [loading, rows, error, fetchAll]
  );
}
