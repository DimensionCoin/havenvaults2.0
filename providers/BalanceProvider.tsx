"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUser } from "./UserProvider";

export type WalletToken = {
  mint: string;
  symbol?: string;
  name?: string;
  logoURI?: string | null;
  amount: number;
  decimals: number;
  usdPrice?: number;
  usdValue?: number;
  priceChange24h?: number;
  usdChange24h?: number;
};

type BoosterStaticPosition = {
  id: string;
  publicKey: string;
  symbol: "SOL" | "ETH" | "BTC";
  isLong: boolean;
  createdAt: string;

  entryUsd: number;
  sizeUsd: number;
  collateralUsd: number;

  sizeTokens: number;
  pnlUsd: number;
  spotValueUsd: number;
  takeHomeUsd: number;
};

type BalanceContextValue = {
  loading: boolean;
  tokens: WalletToken[];

  totalUsd: number;
  totalChange24hUsd: number;
  totalChange24hPct: number;

  lastUpdated: number | null;

  usdcUsd: number;
  usdcAmount: number;

  savingsFlexUsd: number;
  savingsFlexAmount: number;

  // ✅ Plus
  savingsPlusUsd: number; // display currency
  savingsPlusAmount: number; // base UI amount (USD-like)
  plusReady: boolean; // Plus request resolved
  plusError?: string | null;

  nativeSol: number;

  displayCurrency: string;
  fxRate: number;

  boosterTakeHomeUsd: number;
  boosterPositionsCount: number;
  boosterPositions: BoosterStaticPosition[];

  refresh: () => Promise<void>;
  refreshNow: () => Promise<void>;
};

const BalanceContext = createContext<BalanceContextValue | undefined>(
  undefined,
);

export const useBalance = () => {
  const ctx = useContext(BalanceContext);
  if (!ctx) throw new Error("useBalance must be used within BalanceProvider");
  return ctx;
};

type ApiBalanceResponse = {
  owner: string;
  totalUsd: number;
  totalChange24hUsd: number;
  totalChange24hPct: number;
  tokens: {
    mint: string;
    symbol?: string;
    name?: string;
    logoURI?: string | null;
    uiAmount: number;
    decimals: number;
    price?: number;
    usdValue?: number;
    priceChange24h?: number;
    usdChange24h?: number;
  }[];
  nativeSol?: number;
};

type FxResponse = {
  base?: string;
  target?: string;
  rate?: number;
};

type FlexBalanceResponse = {
  amountUi?: string;
  error?: string;
};

type BoosterApiResponse = {
  positions?: Array<{
    publicKey: string;
    symbol: "SOL" | "ETH" | "BTC";
    side: "long" | "short";
    account: {
      openTime?: string;
      price: string;
      sizeUsd: string;
      collateralUsd: string;
    };
  }>;
};

type PlusBalanceResponse = {
  owner?: string;
  hasPosition?: boolean;
  shares?: string;
  underlyingAssets?: string;
  decimals?: number;
  underlyingAssetsUi?: string;
  error?: string;
  code?: string;
};

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* ───────── HELPERS ───────── */

function safeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function safeSymbol(v: unknown): "SOL" | "ETH" | "BTC" | null {
  const s = safeStr(v).toUpperCase();
  if (s === "SOL" || s === "ETH" || s === "BTC") return s;
  return null;
}

function usdFrom6Str(x?: string | null): number {
  const n = typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) && n >= 0 ? n / 1e6 : 0;
}

function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ───────── PROVIDER ───────── */

export const BalanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading: userLoading } = useUser();

  const ownerAddress = user?.walletAddress || "";
  const ownerReady = Boolean(ownerAddress?.trim());

  /* ───────── Convex price subscription ───────── */
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

  /* ───────── State ───────── */

  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [nativeSol, setNativeSol] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const [usdcUsd, setUsdcUsd] = useState(0);
  const [usdcAmount, setUsdcAmount] = useState(0);

  const [savingsFlexUsd, setSavingsFlexUsd] = useState(0);
  const [savingsFlexAmount, setSavingsFlexAmount] = useState(0);

  // ✅ Plus
  const [savingsPlusUsd, setSavingsPlusUsd] = useState(0);
  const [savingsPlusAmount, setSavingsPlusAmount] = useState(0);
  const [plusReady, setPlusReady] = useState(false);
  const [plusError, setPlusError] = useState<string | null>(null);

  const [displayCurrency, setDisplayCurrency] = useState<string>("USD");
  const [fxRateState, setFxRateState] = useState<number>(1);

  const [baseTotalUsdDisplay, setBaseTotalUsdDisplay] = useState(0);
  const [totalChange24hUsd, setTotalChange24hUsd] = useState(0);
  const [totalChange24hPct, setTotalChange24hPct] = useState(0);

  const [boosterPositionsRaw, setBoosterPositionsRaw] = useState<
    Array<{
      id: string;
      publicKey: string;
      symbol: "SOL" | "ETH" | "BTC";
      isLong: boolean;
      createdAt: string;
      entryUsd: number;
      sizeUsd: number;
      collateralUsd: number;
    }>
  >([]);

  // Dedupe refreshes
  const refreshInflight = useRef<Promise<void> | null>(null);

  // Abort stale refreshes (so old responses don't overwrite newer ones)
  const abortRef = useRef<AbortController | null>(null);

  // Cache FX for a short period to avoid re-fetching every refresh
  const fxCacheRef = useRef<{
    ts: number;
    rate: number;
    target: string;
  } | null>(null);

  /* ───────── Booster computed ───────── */

  const boosterPositions = useMemo<BoosterStaticPosition[]>(() => {
    return boosterPositionsRaw.map((p) => {
      const markUsd = priceMap[p.symbol] > 0 ? priceMap[p.symbol] : p.entryUsd;

      const pnlUsd =
        p.entryUsd > 0 && p.sizeUsd > 0
          ? p.isLong
            ? p.sizeUsd * ((markUsd - p.entryUsd) / p.entryUsd)
            : p.sizeUsd * ((p.entryUsd - markUsd) / p.entryUsd)
          : 0;

      const takeHomeUsd = p.collateralUsd + pnlUsd;
      const spotValueUsd = p.sizeUsd + pnlUsd;
      const sizeTokens = p.entryUsd > 0 ? p.sizeUsd / p.entryUsd : 0;

      return {
        ...p,
        sizeTokens,
        pnlUsd,
        spotValueUsd,
        takeHomeUsd,
      };
    });
  }, [boosterPositionsRaw, priceMap]);

  const boosterPositionsCount = boosterPositions.length;

  const boosterTakeHomeUsd = useMemo(() => {
    const baseSum = boosterPositions.reduce(
      (sum, p) => sum + (Number.isFinite(p.takeHomeUsd) ? p.takeHomeUsd : 0),
      0,
    );
    return baseSum * fxRateState;
  }, [boosterPositions, fxRateState]);

  const totalUsd = useMemo(
    () => baseTotalUsdDisplay + boosterTakeHomeUsd,
    [baseTotalUsdDisplay, boosterTakeHomeUsd],
  );

  /* ───────── Refresh ───────── */

  const runRefresh = useCallback(
    async (opts?: { bypassUserLoading?: boolean }) => {
      if (refreshInflight.current) return refreshInflight.current;

      const p = (async () => {
        if (!opts?.bypassUserLoading && userLoading) return;

        // Abort any previous in-flight refresh so stale responses can't "win"
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        const owner = user?.walletAddress || "";

        const flexSubdoc = user?.savingsAccounts?.find(
          (a: { type?: string }) => a?.type === "flex",
        );
        const flexMarginfiPk =
          typeof (flexSubdoc as { marginfiAccountPk?: string })
            ?.marginfiAccountPk === "string" &&
          (
            flexSubdoc as { marginfiAccountPk?: string }
          ).marginfiAccountPk!.trim()
            ? (
                flexSubdoc as { marginfiAccountPk?: string }
              ).marginfiAccountPk!.trim()
            : null;

        const hasLinkedFlexAccount = Boolean(flexMarginfiPk);

        if (!owner) {
          setTokens([]);
          setNativeSol(0);
          setUsdcUsd(0);
          setUsdcAmount(0);
          setSavingsFlexUsd(0);
          setSavingsFlexAmount(0);

          setSavingsPlusUsd(0);
          setSavingsPlusAmount(0);
          setPlusReady(false);
          setPlusError(null);

          setBaseTotalUsdDisplay(0);
          setTotalChange24hUsd(0);
          setTotalChange24hPct(0);
          setBoosterPositionsRaw([]);
          setLastUpdated(Date.now());
          setDisplayCurrency("USD");
          setFxRateState(1);
          return;
        }

        setLoading(true);

        // Force Plus section to wait for a fresh response
        setPlusReady(false);
        setPlusError(null);

        try {
          // Start all requests immediately (parallel),
          // but we will APPLY wallet+fx first, and extras later.
          const walletP = fetch(
            `/api/user/wallet/balance?owner=${encodeURIComponent(owner)}`,
            { method: "GET", cache: "no-store", signal: ac.signal },
          );

          // FX: use short cache (e.g. 5 minutes) to reduce load
          const now = Date.now();
          const fxCached = fxCacheRef.current;
          const fxIsFresh = fxCached && now - fxCached.ts < 5 * 60 * 1000;

          const fxP = fxIsFresh
            ? Promise.resolve(null)
            : fetch("/api/fx", {
                method: "GET",
                cache: "no-store",
                credentials: "include",
                signal: ac.signal,
              });

          const flexP = hasLinkedFlexAccount
            ? fetch("/api/savings/flex/balance", {
                method: "GET",
                cache: "no-store",
                credentials: "include",
                signal: ac.signal,
              })
            : Promise.resolve(null);

          const plusP = fetch("/api/savings/plus/balance", {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            signal: ac.signal,
          });

          const boosterP = fetch("/api/booster/positions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerBase58: owner }),
            cache: "no-store",
            signal: ac.signal,
          });

          // 1) Apply WALLET first (fastest and most important)
          const walletRes = await walletP;
          if (ac.signal.aborted) return;

          if (!walletRes.ok) {
            setLastUpdated(Date.now());
            return;
          }

          const walletJson = (await walletRes.json()) as ApiBalanceResponse;
          setNativeSol(safeNumber(walletJson.nativeSol, 0));

          const mappedUsd: WalletToken[] = (walletJson.tokens ?? []).map(
            (t) => ({
              mint: t.mint,
              symbol: t.symbol,
              name: t.name,
              logoURI: t.logoURI ?? null,
              amount: safeNumber(t.uiAmount, 0),
              decimals: safeNumber(t.decimals, 0),
              usdPrice: typeof t.price === "number" ? t.price : undefined,
              usdValue: typeof t.usdValue === "number" ? t.usdValue : undefined,
              priceChange24h:
                typeof t.priceChange24h === "number"
                  ? t.priceChange24h
                  : undefined,
              usdChange24h:
                typeof t.usdChange24h === "number" ? t.usdChange24h : undefined,
            }),
          );

          const usdcToken = mappedUsd.find((t) => t.mint === USDC_MINT);
          const usdcUsdWalletBase = safeNumber(usdcToken?.usdValue, 0);
          const usdcAmtWallet = safeNumber(usdcToken?.amount, 0);

          const nonUsdcTokensUsd = mappedUsd.filter(
            (t) => t.mint !== USDC_MINT,
          );
          nonUsdcTokensUsd.sort(
            (a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0),
          );

          const walletTotalUsdBase = safeNumber(walletJson.totalUsd, 0);
          const walletChangeUsdBase = safeNumber(
            walletJson.totalChange24hUsd,
            0,
          );

          // 2) Apply FX next (or use cached)
          let fxRate = fxIsFresh ? fxCached!.rate : 1;
          let fxTarget = fxIsFresh ? fxCached!.target : "USD";

          if (!fxIsFresh && fxP) {
            const fxRes = await fxP;
            if (ac.signal.aborted) return;

            if (fxRes && fxRes.ok) {
              const fxData = (await fxRes
                .json()
                .catch(() => ({}))) as FxResponse;

              const rateNum = safeNumber(fxData.rate, 1);
              fxRate = rateNum > 0 ? rateNum : 1;

              if (typeof fxData.target === "string" && fxData.target.trim()) {
                fxTarget = fxData.target.trim().toUpperCase();
              }

              if (!Number.isFinite(fxRate) || fxRate <= 0) {
                fxRate = 1;
                fxTarget = "USD";
              }

              fxCacheRef.current = {
                ts: Date.now(),
                rate: fxRate,
                target: fxTarget,
              };
            }
          }

          if (!Number.isFinite(fxRate) || fxRate <= 0) {
            fxRate = 1;
            fxTarget = "USD";
          }

          const convertOpt = (n?: number): number | undefined =>
            typeof n === "number" && !Number.isNaN(n) ? n * fxRate : undefined;

          const nonUsdcTokensDisplay: WalletToken[] = nonUsdcTokensUsd.map(
            (t) => ({
              ...t,
              usdPrice: convertOpt(t.usdPrice),
              usdValue: convertOpt(t.usdValue),
              usdChange24h: convertOpt(t.usdChange24h),
            }),
          );

          // Apply wallet-derived state immediately (fast UI)
          setTokens(nonUsdcTokensDisplay);
          setUsdcUsd(usdcUsdWalletBase * fxRate);
          setUsdcAmount(usdcAmtWallet);

          // Keep totals "wallet-only" for the moment;
          // extras (flex/plus) will adjust baseTotalUsdDisplay once they arrive.
          setBaseTotalUsdDisplay(walletTotalUsdBase * fxRate);
          setTotalChange24hUsd(walletChangeUsdBase * fxRate);

          const prevWalletBaseUsd = walletTotalUsdBase - walletChangeUsdBase;
          const changePct =
            prevWalletBaseUsd > 0 ? walletChangeUsdBase / prevWalletBaseUsd : 0;
          setTotalChange24hPct(changePct);

          setDisplayCurrency(fxTarget);
          setFxRateState(fxRate);
          setLastUpdated(Date.now());

          // 3) Load EXTRAS (flex/plus/booster) without blocking the main UI
          void (async () => {
            try {
              const [flexRes, plusRes, boosterRes] = await Promise.all([
                flexP,
                plusP,
                boosterP,
              ]);
              if (ac.signal.aborted) return;

              // ---------- Flex ----------
              let flexAmount = 0;
              let flexUsdBase = 0;

              if (hasLinkedFlexAccount && flexRes) {
                if (flexRes.status === 204) {
                  flexAmount = 0;
                  flexUsdBase = 0;
                } else if (flexRes.ok) {
                  const flexJson = (await flexRes
                    .json()
                    .catch(() => ({}))) as FlexBalanceResponse;
                  const amountUiStr =
                    typeof flexJson.amountUi === "string"
                      ? flexJson.amountUi
                      : "0";
                  flexAmount = safeNumber(amountUiStr, 0);
                  flexUsdBase = flexAmount;
                }
              }

              // ---------- Plus ----------
              let plusBaseUi = 0;

              if (plusRes.ok) {
                const pj = (await plusRes
                  .json()
                  .catch(() => ({}))) as PlusBalanceResponse;

                const uiStr = safeStr(pj.underlyingAssetsUi);
                if (uiStr) {
                  plusBaseUi = clampNonNeg(safeNumber(uiStr, 0));
                } else {
                  const underlyingBase = safeNumber(pj.underlyingAssets, 0);
                  const decimals = Number.isFinite(pj.decimals as number)
                    ? Number(pj.decimals)
                    : 6;
                  plusBaseUi =
                    underlyingBase > 0
                      ? underlyingBase / Math.pow(10, Math.max(0, decimals))
                      : 0;
                  plusBaseUi = clampNonNeg(plusBaseUi);
                }

                setSavingsPlusAmount(plusBaseUi);
                setSavingsPlusUsd(plusBaseUi * fxRate);
                setPlusReady(true);
              } else {
                setSavingsPlusAmount(0);
                setSavingsPlusUsd(0);
                setPlusError(`Plus balance fetch failed: ${plusRes.status}`);
                setPlusReady(true);
              }

              // ---------- Booster raw ----------
              const boosterRaw: typeof boosterPositionsRaw = [];

              if (boosterRes.ok) {
                const bj = (await boosterRes
                  .json()
                  .catch(() => null)) as BoosterApiResponse | null;
                const raw = Array.isArray(bj?.positions) ? bj!.positions! : [];

                for (const p of raw) {
                  const symbol = safeSymbol(p?.symbol);
                  if (!symbol) continue;

                  const pk = safeStr(p?.publicKey);
                  if (!pk) continue;

                  const entryUsd = usdFrom6Str(p?.account?.price);
                  const sizeUsd = usdFrom6Str(p?.account?.sizeUsd);
                  const collateralUsd = usdFrom6Str(p?.account?.collateralUsd);

                  if (!(sizeUsd > 0) || !(entryUsd > 0)) continue;

                  const isLong = p?.side === "long";
                  const openSecs = Number(safeStr(p?.account?.openTime || "0"));
                  const createdAt =
                    Number.isFinite(openSecs) &&
                    openSecs > 0 &&
                    openSecs < 10_000_000_000
                      ? new Date(openSecs * 1000).toISOString()
                      : new Date().toISOString();

                  boosterRaw.push({
                    id: pk,
                    publicKey: pk,
                    symbol,
                    isLong,
                    createdAt,
                    entryUsd,
                    sizeUsd,
                    collateralUsd,
                  });
                }
              }

              setBoosterPositionsRaw(boosterRaw);

              // ---------- Totals recompute (wallet + extras) ----------
              // NOTE: totalChange24h is still sourced from wallet endpoint, same as before.
              const combinedBaseUsd =
                walletTotalUsdBase +
                (hasLinkedFlexAccount ? flexUsdBase : 0) +
                plusBaseUi;

              const prevBaseUsd =
                walletTotalUsdBase -
                walletChangeUsdBase +
                (hasLinkedFlexAccount ? flexUsdBase : 0) +
                plusBaseUi;

              const combinedChangePct =
                prevBaseUsd > 0 ? walletChangeUsdBase / prevBaseUsd : 0;

              setSavingsFlexAmount(hasLinkedFlexAccount ? flexAmount : 0);
              setSavingsFlexUsd(
                (hasLinkedFlexAccount ? flexUsdBase : 0) * fxRate,
              );

              setBaseTotalUsdDisplay(combinedBaseUsd * fxRate);
              setTotalChange24hPct(combinedChangePct);

              setLastUpdated(Date.now());
            } catch {
              if (ac.signal.aborted) return;
              // Do not nuke wallet state; only mark plus as resolved with an error like before
              setLastUpdated(Date.now());
              setSavingsPlusAmount(0);
              setSavingsPlusUsd(0);
              setPlusError("Plus refresh error");
              setPlusReady(true);
            }
          })();
        } catch {
          if (ac.signal.aborted) return;
          setLastUpdated(Date.now());
          setSavingsPlusAmount(0);
          setSavingsPlusUsd(0);
          setPlusError("Plus refresh error");
          setPlusReady(true);
        } finally {
          // loading represents "wallet/primary" load; extras continue in background
          if (!ac.signal.aborted) setLoading(false);
        }
      })();

      refreshInflight.current = p;
      try {
        await p;
      } finally {
        refreshInflight.current = null;
      }
    },
    [user, userLoading],
  );

  const refresh = useCallback(async () => {
    await runRefresh({ bypassUserLoading: false });
  }, [runRefresh]);

  const refreshNow = useCallback(async () => {
    await runRefresh({ bypassUserLoading: true });
  }, [runRefresh]);

  useEffect(() => {
    if (!ownerReady) return;
    void runRefresh({ bypassUserLoading: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerReady, ownerAddress]);

  const value: BalanceContextValue = useMemo(
    () => ({
      loading,
      tokens,

      totalUsd,
      totalChange24hUsd,
      totalChange24hPct,

      lastUpdated,

      usdcUsd,
      usdcAmount,

      savingsFlexUsd,
      savingsFlexAmount,

      savingsPlusUsd,
      savingsPlusAmount,
      plusReady,
      plusError,

      nativeSol,

      displayCurrency,
      fxRate: fxRateState,

      boosterTakeHomeUsd,
      boosterPositionsCount,
      boosterPositions,

      refresh,
      refreshNow,
    }),
    [
      loading,
      tokens,
      totalUsd,
      totalChange24hUsd,
      totalChange24hPct,
      lastUpdated,
      usdcUsd,
      usdcAmount,
      savingsFlexUsd,
      savingsFlexAmount,
      savingsPlusUsd,
      savingsPlusAmount,
      plusReady,
      plusError,
      nativeSol,
      displayCurrency,
      fxRateState,
      boosterTakeHomeUsd,
      boosterPositionsCount,
      boosterPositions,
      refresh,
      refreshNow,
    ],
  );

  return (
    <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>
  );
};
