// providers/BalanceProvider.tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useUser } from "./UserProvider";

export type WalletToken = {
  mint: string;
  symbol?: string;
  name?: string;
  logoURI?: string | null;
  amount: number;
  decimals: number;

  // In the user's display currency (converted from USD by fxRate)
  usdPrice?: number;
  usdValue?: number;

  priceChange24h?: number; // fraction: 0.05 = +5%
  usdChange24h?: number; // value change in display currency
};

type BalanceContextValue = {
  loading: boolean;
  tokens: WalletToken[]; // non-USDC tokens only

  // In the user's display currency
  totalUsd: number; // combined: wallet tokens + wallet USDC + savings flex (only if linked)
  totalChange24hUsd: number;
  totalChange24hPct: number;

  lastUpdated: number | null;

  // Wallet USDC position
  usdcUsd: number; // in display currency
  usdcAmount: number; // in USDC

  // Savings Flex USDC position (0 if no linked account pk)
  savingsFlexUsd: number; // in display currency
  savingsFlexAmount: number; // in USDC

  // Native SOL (not shown as a token)
  nativeSol: number;

  // FX info
  displayCurrency: string; // e.g. "USD", "CAD", "EUR"
  fxRate: number; // USD -> displayCurrency

  refresh: () => Promise<void>;
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
  totalUsd: number; // wallet total in USD (includes USDC)
  totalChange24hUsd: number;
  totalChange24hPct: number;
  tokens: {
    mint: string;
    symbol?: string;
    name?: string;
    logoURI?: string | null;
    uiAmount: number;
    decimals: number;
    price?: number; // USD
    usdValue?: number; // USD
    priceChange24h?: number;
    usdChange24h?: number; // USD
  }[];
  count?: number;
  nativeSol?: number;
};

type FxResponse = {
  base?: string;
  target?: string;
  rate?: number; // USD -> target
};

type FlexBalanceResponse = {
  ok?: boolean;
  marginfiAccountPk?: string;
  accountPkSource?: string;
  amountUi?: string; // USDC UI units
  amountBase?: string;
  decimals?: number;
  source?: string;
  error?: string;
};

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function safeNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const BalanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading: userLoading } = useUser();

  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [totalUsd, setTotalUsd] = useState(0);
  const [totalChange24hUsd, setTotalChange24hUsd] = useState(0);
  const [totalChange24hPct, setTotalChange24hPct] = useState(0);

  const [usdcUsd, setUsdcUsd] = useState(0);
  const [usdcAmount, setUsdcAmount] = useState(0);

  const [savingsFlexUsd, setSavingsFlexUsd] = useState(0);
  const [savingsFlexAmount, setSavingsFlexAmount] = useState(0);

  const [nativeSol, setNativeSol] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const [displayCurrency, setDisplayCurrency] = useState<string>("USD");
  const [fxRateState, setFxRateState] = useState<number>(1);

  const refresh = useCallback(async () => {
    if (userLoading) return;

    const ownerAddress = user?.walletAddress || "";

    // ✅ STRICT: only fetch/count flex if user has a saved marginfiAccountPk
    const flexSubdoc = user?.savingsAccounts?.find(
      (a: any) => a?.type === "flex"
    );
    const flexMarginfiPk =
      typeof (flexSubdoc as any)?.marginfiAccountPk === "string" &&
      (flexSubdoc as any).marginfiAccountPk.trim()
        ? (flexSubdoc as any).marginfiAccountPk.trim()
        : null;

    const hasLinkedFlexAccount = Boolean(flexMarginfiPk);

    if (!ownerAddress) {
      setTokens([]);
      setTotalUsd(0);
      setTotalChange24hUsd(0);
      setTotalChange24hPct(0);
      setUsdcUsd(0);
      setUsdcAmount(0);
      setSavingsFlexUsd(0);
      setSavingsFlexAmount(0);
      setNativeSol(0);
      setLastUpdated(Date.now());
      setDisplayCurrency("USD");
      setFxRateState(1);
      return;
    }

    setLoading(true);

    try {
      const walletUrl = `/api/user/wallet/balance?owner=${encodeURIComponent(
        ownerAddress
      )}`;

      const walletReq = fetch(walletUrl, { method: "GET", cache: "no-store" });
      const fxReq = fetch("/api/fx", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });

      // ✅ only call flex balance if we have a linked pk saved
      const flexReq = hasLinkedFlexAccount
        ? fetch("/api/savings/flex/balance", {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          })
        : Promise.resolve(null);

      const [walletRes, fxRes, flexRes] = await Promise.all([
        walletReq,
        fxReq,
        flexReq,
      ]);

      // ---------- wallet ----------
      if (!walletRes.ok) {
        const text = await walletRes.text().catch(() => "");
        console.error(
          "[BalanceProvider] /api/user/wallet/balance failed:",
          walletRes.status,
          walletRes.statusText,
          text
        );
        setLastUpdated(Date.now());
        return;
      }

      const walletJson = (await walletRes.json()) as ApiBalanceResponse;

      const nativeSolRaw = safeNumber(walletJson.nativeSol, 0);
      setNativeSol(nativeSolRaw);

      const mappedUsd: WalletToken[] = (walletJson.tokens ?? []).map((t) => ({
        mint: t.mint,
        symbol: t.symbol,
        name: t.name,
        logoURI: t.logoURI ?? null,
        amount: safeNumber(t.uiAmount, 0),
        decimals: safeNumber(t.decimals, 0),
        usdPrice: typeof t.price === "number" ? t.price : undefined,
        usdValue: typeof t.usdValue === "number" ? t.usdValue : undefined,
        priceChange24h:
          typeof t.priceChange24h === "number" ? t.priceChange24h : undefined,
        usdChange24h:
          typeof t.usdChange24h === "number" ? t.usdChange24h : undefined,
      }));

      const usdcToken = mappedUsd.find((t) => t.mint === USDC_MINT);
      const usdcUsdWallet = safeNumber(usdcToken?.usdValue, 0); // USD
      const usdcAmtWallet = safeNumber(usdcToken?.amount, 0);

      const nonUsdcTokensUsd = mappedUsd.filter((t) => t.mint !== USDC_MINT);
      nonUsdcTokensUsd.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

      const walletTotalUsd =
        typeof walletJson.totalUsd === "number" &&
        !Number.isNaN(walletJson.totalUsd)
          ? walletJson.totalUsd
          : 0;

      const walletChangeUsd =
        typeof walletJson.totalChange24hUsd === "number" &&
        !Number.isNaN(walletJson.totalChange24hUsd)
          ? walletJson.totalChange24hUsd
          : 0;

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
      } else {
        console.warn("[BalanceProvider] /api/fx failed:", fxRes.status);
      }

      if (!Number.isFinite(fxRate) || fxRate <= 0) {
        fxRate = 1;
        fxTarget = "USD";
      }

      // ---------- flex savings ----------
      // Only count flex if linked pk exists in user schema
      let flexAmount = 0; // USDC
      let flexUsd = 0; // USD

      if (hasLinkedFlexAccount && flexRes) {
        // ✅ your new API can return 204 when no pk exists (or if it treats it as missing)
        if (flexRes.status === 204) {
          flexAmount = 0;
          flexUsd = 0;
        } else if (flexRes.ok) {
          const flexJson = (await flexRes
            .json()
            .catch(() => ({}))) as FlexBalanceResponse;

          const amountUiStr =
            typeof flexJson.amountUi === "string" ? flexJson.amountUi : "0";

          flexAmount = safeNumber(amountUiStr, 0);
          flexUsd = flexAmount; // USDC assumed 1:1 USD
        } else {
          const t = await flexRes.text().catch(() => "");
          console.warn(
            "[BalanceProvider] /api/savings/flex/balance failed:",
            flexRes.status,
            flexRes.statusText,
            t
          );
          flexAmount = 0;
          flexUsd = 0;
        }
      }

      // ---------- totals ----------
      // ✅ flex only included if linked
      const combinedTotalUsd =
        walletTotalUsd + (hasLinkedFlexAccount ? flexUsd : 0);

      // Flex treated as “flat” for 24h change
      const combinedPrevUsd =
        walletTotalUsd - walletChangeUsd + (hasLinkedFlexAccount ? flexUsd : 0);

      const combinedChangeUsd = walletChangeUsd;
      const combinedChangePct =
        combinedPrevUsd > 0 ? combinedChangeUsd / combinedPrevUsd : 0;

      // ---------- convert to display currency ----------
      const convertOpt = (n?: number): number | undefined =>
        typeof n === "number" && !Number.isNaN(n) ? n * fxRate : undefined;

      const nonUsdcTokensDisplay: WalletToken[] = nonUsdcTokensUsd.map((t) => ({
        ...t,
        usdPrice: convertOpt(t.usdPrice),
        usdValue: convertOpt(t.usdValue),
        usdChange24h: convertOpt(t.usdChange24h),
      }));

      const combinedTotalDisplay = combinedTotalUsd * fxRate;
      const usdcDisplayWallet = usdcUsdWallet * fxRate;

      const flexDisplay = (hasLinkedFlexAccount ? flexUsd : 0) * fxRate;
      const totalChangeDisplay = combinedChangeUsd * fxRate;

      // ---------- commit ----------
      setTokens(nonUsdcTokensDisplay);

      setUsdcUsd(usdcDisplayWallet);
      setUsdcAmount(usdcAmtWallet);

      // ✅ if not linked, these stay 0
      setSavingsFlexAmount(hasLinkedFlexAccount ? flexAmount : 0);
      setSavingsFlexUsd(hasLinkedFlexAccount ? flexDisplay : 0);

      setTotalUsd(combinedTotalDisplay);
      setTotalChange24hUsd(totalChangeDisplay);
      setTotalChange24hPct(combinedChangePct);

      setDisplayCurrency(fxTarget);
      setFxRateState(fxRate);

      setLastUpdated(Date.now());

      // ---------- snapshot ----------
      if (combinedTotalUsd > 0) {
        try {
          await fetch("/api/user/balance/snapshot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              owner: ownerAddress,
              totalUsd: combinedTotalUsd,
              breakdown: hasLinkedFlexAccount ? { savingsFlex: flexUsd } : {},
            }),
          });
        } catch (e) {
          console.error("[BalanceProvider] snapshot failed:", e);
        }
      }
    } catch (err) {
      console.error("[BalanceProvider] refresh failed:", err);
      setLastUpdated(Date.now());
    } finally {
      setLoading(false);
    }
  }, [user, userLoading]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

    nativeSol,

    displayCurrency,
    fxRate: fxRateState,

    refresh,
  };

  return (
    <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>
  );
};
