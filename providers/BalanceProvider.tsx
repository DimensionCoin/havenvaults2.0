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
  undefined
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

// ✅ Plus API actually returns base units + decimals (per your logs)
type PlusBalanceResponse = {
  owner?: string;
  hasPosition?: boolean;

  // from your log:
  shares?: string; // base units string
  underlyingAssets?: string; // base units string
  decimals?: number; // e.g. 6

  // sometimes APIs also include ui string; accept if present
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

  const refreshInflight = useRef<Promise<void> | null>(null);

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
      0
    );
    return baseSum * fxRateState;
  }, [boosterPositions, fxRateState]);

  const totalUsd = useMemo(
    () => baseTotalUsdDisplay + boosterTakeHomeUsd,
    [baseTotalUsdDisplay, boosterTakeHomeUsd]
  );

  /* ───────── Refresh ───────── */

  const runRefresh = useCallback(
    async (opts?: { bypassUserLoading?: boolean }) => {
      if (refreshInflight.current) return refreshInflight.current;

      const p = (async () => {
        if (!opts?.bypassUserLoading && userLoading) return;

        const owner = user?.walletAddress || "";

        const flexSubdoc = user?.savingsAccounts?.find(
          (a: { type?: string }) => a?.type === "flex"
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

        // ✅ force UI to wait for fresh Plus response
        setPlusReady(false);
        setPlusError(null);

        try {
          const [walletRes, fxRes, flexRes, plusRes, boosterRes] =
            await Promise.all([
              fetch(
                `/api/user/wallet/balance?owner=${encodeURIComponent(owner)}`,
                { method: "GET", cache: "no-store" }
              ),
              fetch("/api/fx", {
                method: "GET",
                cache: "no-store",
                credentials: "include",
              }),
              hasLinkedFlexAccount
                ? fetch("/api/savings/flex/balance", {
                    method: "GET",
                    cache: "no-store",
                    credentials: "include",
                  })
                : Promise.resolve(null),
              fetch("/api/savings/plus/balance", {
                method: "GET",
                cache: "no-store",
                credentials: "include",
              }),
              fetch("/api/booster/positions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ownerBase58: owner }),
                cache: "no-store",
              }),
            ]);

          // ---------- Wallet ----------
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
            })
          );

          const usdcToken = mappedUsd.find((t) => t.mint === USDC_MINT);
          const usdcUsdWalletBase = safeNumber(usdcToken?.usdValue, 0);
          const usdcAmtWallet = safeNumber(usdcToken?.amount, 0);

          const nonUsdcTokensUsd = mappedUsd.filter(
            (t) => t.mint !== USDC_MINT
          );
          nonUsdcTokensUsd.sort(
            (a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0)
          );

          const walletTotalUsdBase = safeNumber(walletJson.totalUsd, 0);
          const walletChangeUsdBase = safeNumber(
            walletJson.totalChange24hUsd,
            0
          );

          // ---------- FX ----------
          let fxRate = 1;
          let fxTarget = "USD";

          if (fxRes.ok) {
            const fxData = (await fxRes.json().catch(() => ({}))) as FxResponse;
            const rateNum = safeNumber(fxData.rate, 1);
            fxRate = rateNum > 0 ? rateNum : 1;
            if (typeof fxData.target === "string" && fxData.target.trim()) {
              fxTarget = fxData.target.trim().toUpperCase();
            }
          }

          if (!Number.isFinite(fxRate) || fxRate <= 0) {
            fxRate = 1;
            fxTarget = "USD";
          }

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
                typeof flexJson.amountUi === "string" ? flexJson.amountUi : "0";
              flexAmount = safeNumber(amountUiStr, 0);
              flexUsdBase = flexAmount;
            }
          }

          // ---------- Plus (✅ definitive) ----------
          let plusBaseUi = 0;

          if (plusRes.ok) {
            const pj = (await plusRes
              .json()
              .catch(() => ({}))) as PlusBalanceResponse;

            // priority: underlyingAssetsUi if API provides it
            const uiStr = safeStr(pj.underlyingAssetsUi);
            if (uiStr) {
              plusBaseUi = clampNonNeg(safeNumber(uiStr, 0));
            } else {
              // else compute from base units + decimals (matches your logs)
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

          // ---------- Totals ----------
          const plusUsdBase = plusBaseUi;

          const combinedBaseUsd =
            walletTotalUsdBase +
            (hasLinkedFlexAccount ? flexUsdBase : 0) +
            plusUsdBase;

          const prevBaseUsd =
            walletTotalUsdBase -
            walletChangeUsdBase +
            (hasLinkedFlexAccount ? flexUsdBase : 0) +
            plusUsdBase;

          const changePct =
            prevBaseUsd > 0 ? walletChangeUsdBase / prevBaseUsd : 0;

          // ---------- Convert wallet tokens to display ----------
          const convertOpt = (n?: number): number | undefined =>
            typeof n === "number" && !Number.isNaN(n) ? n * fxRate : undefined;

          const nonUsdcTokensDisplay: WalletToken[] = nonUsdcTokensUsd.map(
            (t) => ({
              ...t,
              usdPrice: convertOpt(t.usdPrice),
              usdValue: convertOpt(t.usdValue),
              usdChange24h: convertOpt(t.usdChange24h),
            })
          );

          setTokens(nonUsdcTokensDisplay);

          setUsdcUsd(usdcUsdWalletBase * fxRate);
          setUsdcAmount(usdcAmtWallet);

          setSavingsFlexAmount(hasLinkedFlexAccount ? flexAmount : 0);
          setSavingsFlexUsd((hasLinkedFlexAccount ? flexUsdBase : 0) * fxRate);

          setBaseTotalUsdDisplay(combinedBaseUsd * fxRate);
          setTotalChange24hUsd(walletChangeUsdBase * fxRate);
          setTotalChange24hPct(changePct);
          setDisplayCurrency(fxTarget);
          setFxRateState(fxRate);
          setLastUpdated(Date.now());
        } catch {
          setLastUpdated(Date.now());
          setSavingsPlusAmount(0);
          setSavingsPlusUsd(0);
          setPlusError("Plus refresh error");
          setPlusReady(true);
        } finally {
          setLoading(false);
        }
      })();

      refreshInflight.current = p;
      try {
        await p;
      } finally {
        refreshInflight.current = null;
      }
    },
    [user, userLoading, priceMap]
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

  const value: BalanceContextValue = {
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
  };

  return (
    <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>
  );
};
