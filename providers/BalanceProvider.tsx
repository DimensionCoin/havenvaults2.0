// providers/BalanceProvider.tsx
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
import { useUser } from "./UserProvider";
import { useBoosterPositions } from "@/hooks/useBoosterPositions";

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

  // ✅ Booster (source of truth = hook)
  boosterTakeHomeUsd: number; // display currency
  boosterPositionsCount: number;
  boosterPositions: BoosterStaticPosition[];
  boosterReady: boolean;
  boosterError?: string | null;
  refetchBooster: () => void;

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

  // ✅ Booster hook is now the ONLY thing that fetches booster positions
  // (BalanceProvider no longer calls /api/booster/positions)
  const booster = useBoosterPositions({
    ownerBase58: ownerReady ? ownerAddress : undefined,
    enabled: ownerReady,
    refreshKey: undefined, // optional: pass lastUpdated if you want
  });

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

  // ✅ Snapshot dedupe (minimal, non-invasive)
  const snapshotInflightRef = useRef<Promise<void> | null>(null);
  const lastSnapshotKeyRef = useRef<string>("");

  const callBalanceSnapshot = useCallback(
    (owner: string, combinedBaseUsd: number) => {
      if (!owner?.trim()) return;
      if (!Number.isFinite(combinedBaseUsd) || combinedBaseUsd < 0) return;

      // Dedupe: owner + daily + cents (prevents spam on repeated refreshes)
      const day = new Date().toISOString().slice(0, 10); // UTC day
      const cents = Math.round(combinedBaseUsd * 100) / 100;
      const key = `${owner}:${day}:${cents}`;
      if (lastSnapshotKeyRef.current === key) return;
      lastSnapshotKeyRef.current = key;

      if (snapshotInflightRef.current) return;

      snapshotInflightRef.current = (async () => {
        try {
          await fetch("/api/user/balance/snapshot", {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner, totalUsd: cents }),
          });
        } catch {
          // snapshot must never break UI
        } finally {
          snapshotInflightRef.current = null;
        }
      })();
    },
    [],
  );

  /* ───────── Booster derived from hook (computed already) ───────── */

  const boosterPositions = useMemo<BoosterStaticPosition[]>(() => {
    // hook rows are in USD-base numbers
    return booster.rows.map((r) => ({
      id: r.id,
      publicKey: r.publicKey,
      symbol: r.symbol,
      isLong: r.isLong,
      createdAt: r.createdAt,

      entryUsd: r.entryUsd,
      sizeUsd: r.sizeUsd,
      collateralUsd: r.collateralUsd,

      sizeTokens: r.sizeTokens,
      pnlUsd: r.pnlUsd,
      spotValueUsd: r.spotValueUsd,
      takeHomeUsd: r.netUsd, // ✅ use netUsd as take-home
    }));
  }, [booster.rows]);

  const boosterPositionsCount = boosterPositions.length;

  // display currency
  const boosterTakeHomeUsd = useMemo(() => {
    const baseSum = booster.rows.reduce(
      (sum, r) => sum + (Number.isFinite(r.netUsd) ? r.netUsd : 0),
      0,
    );
    return baseSum * fxRateState;
  }, [booster.rows, fxRateState]);

  const boosterReady = useMemo(() => {
    // when owner isn't ready, treat as resolved (no infinite spinners)
    if (!ownerReady) return true;
    return !booster.loading && booster.pricesLoading === false;
  }, [ownerReady, booster.loading, booster.pricesLoading]);

  const boosterError = booster.error ?? null;

  /* ───────── Total (wallet+flex+plus) + booster (multiplied) ───────── */

  const totalUsd = useMemo(
    () => baseTotalUsdDisplay + boosterTakeHomeUsd,
    [baseTotalUsdDisplay, boosterTakeHomeUsd],
  );

  /* ───────── Refresh (wallet/fx/flex/plus only) ───────── */

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
          // Start requests (parallel)
          const walletP = fetch(
            `/api/user/wallet/balance?owner=${encodeURIComponent(owner)}`,
            { method: "GET", cache: "no-store", signal: ac.signal },
          );

          // FX cache (5 min)
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

          // 1) WALLET first
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

          // 2) FX next (or cached)
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

          setTokens(nonUsdcTokensDisplay);
          setUsdcUsd(usdcUsdWalletBase * fxRate);
          setUsdcAmount(usdcAmtWallet);

          setBaseTotalUsdDisplay(walletTotalUsdBase * fxRate);
          setTotalChange24hUsd(walletChangeUsdBase * fxRate);

          const prevWalletBaseUsd = walletTotalUsdBase - walletChangeUsdBase;
          const changePct =
            prevWalletBaseUsd > 0 ? walletChangeUsdBase / prevWalletBaseUsd : 0;
          setTotalChange24hPct(changePct);

          setDisplayCurrency(fxTarget);
          setFxRateState(fxRate);
          setLastUpdated(Date.now());

          // 3) EXTRAS (flex/plus) without blocking
          void (async () => {
            try {
              const [flexRes, plusRes] = await Promise.all([flexP, plusP]);
              if (ac.signal.aborted) return;

              // Flex
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

              // Plus
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

              // Totals recompute (wallet + flex + plus) — booster stays separate via hook
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

              // snapshot AFTER full totals (wallet+flex+plus) are known
              callBalanceSnapshot(owner, combinedBaseUsd);
            } catch {
              if (ac.signal.aborted) return;
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
    [user, userLoading, callBalanceSnapshot],
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

      // ✅ Booster from hook
      boosterTakeHomeUsd,
      boosterPositionsCount,
      boosterPositions,
      boosterReady,
      boosterError,
      refetchBooster: () => void booster.refetch(),

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
      boosterReady,
      boosterError,
      booster.refetch,
      refresh,
      refreshNow,
    ],
  );

  return (
    <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>
  );
};
