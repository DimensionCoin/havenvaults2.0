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

/**
 * ✅ Booster position shape stored in context.
 * This includes everything needed to compute:
 * - per-position withdrawable (collateral + pnl)
 * - portfolio totalUsd (wallet + flex + booster take-home)
 * - lite UI (spotValueUsd, pnlUsd, sizeTokens)
 *
 * IMPORTANT:
 * - entryUsd/sizeUsd/collateralUsd are BASE USD.
 * - pnlUsd/spotValueUsd/takeHomeUsd are BASE USD derived from marks.
 */
type BoosterStaticPosition = {
  id: string; // publicKey
  publicKey: string;
  symbol: "SOL" | "ETH" | "BTC";
  isLong: boolean;
  createdAt: string;

  entryUsd: number; // base USD
  sizeUsd: number; // base USD (not take-home)
  collateralUsd: number; // base USD

  // ✅ Derived fields (base USD / tokens)
  sizeTokens: number; // sizeUsd / entryUsd
  pnlUsd: number; // raw P&L in USD
  spotValueUsd: number; // position value in USD (sizeUsd + pnlUsd)
  takeHomeUsd: number; // withdrawable in USD (collateralUsd + pnlUsd)
};

type BalanceContextValue = {
  loading: boolean;
  tokens: WalletToken[];

  // ✅ total portfolio value (includes boosted take-home)
  totalUsd: number; // display currency
  totalChange24hUsd: number; // display currency
  totalChange24hPct: number;

  lastUpdated: number | null;

  usdcUsd: number; // display currency
  usdcAmount: number;

  savingsFlexUsd: number; // display currency
  savingsFlexAmount: number;

  nativeSol: number;

  displayCurrency: string;
  fxRate: number; // display per 1 USD (same meaning you already use)

  // ✅ boosted positions
  boosterTakeHomeUsd: number; // display currency (SUM of withdrawables)
  boosterPositionsCount: number;
  boosterPositions: BoosterStaticPosition[]; // enriched list for UI anywhere

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
      openTime?: string; // seconds string
      price: string; // u64 1e6
      sizeUsd: string; // u64 1e6
      collateralUsd: string; // u64 1e6
    };
  }>;
};

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ----- pyth ids -----
const PYTH_PRICE_IDS: Record<"SOL" | "ETH" | "BTC", string> = {
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

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

/**
 * Hermes returns parsed price updates.
 * We only need a mark price per symbol.
 */
async function fetchHermesMarks(
  symbols: Array<"SOL" | "ETH" | "BTC">,
  signal?: AbortSignal
): Promise<Partial<Record<"SOL" | "ETH" | "BTC", number>>> {
  const uniq = Array.from(new Set(symbols)).filter(Boolean);
  const ids = uniq.map((s) => PYTH_PRICE_IDS[s]).filter(Boolean);
  if (!ids.length) return {};

  const qs = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");

  const res = await fetch(
    `https://hermes.pyth.network/v2/updates/price/latest?${qs}`,
    { cache: "no-store", signal }
  );

  if (!res.ok) return {};

  const body = (await res.json().catch(() => null)) as {
    parsed?: Array<{ id: string; price?: { price?: string; expo?: number } }>;
  } | null;

  const parsed = Array.isArray(body?.parsed) ? body!.parsed! : [];

  const idToPrice: Record<string, number> = {};
  for (const u of parsed) {
    const id = safeStr(u?.id);
    const rawStr = safeStr(u?.price?.price);
    const expo = Number(u?.price?.expo);
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

  return out;
}

export const BalanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading: userLoading } = useUser();

  const ownerAddress = user?.walletAddress || "";
  const ownerReady = Boolean(ownerAddress?.trim());

  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [nativeSol, setNativeSol] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const [usdcUsd, setUsdcUsd] = useState(0);
  const [usdcAmount, setUsdcAmount] = useState(0);

  const [savingsFlexUsd, setSavingsFlexUsd] = useState(0);
  const [savingsFlexAmount, setSavingsFlexAmount] = useState(0);

  const [displayCurrency, setDisplayCurrency] = useState<string>("USD");
  const [fxRateState, setFxRateState] = useState<number>(1);

  // base totals (wallet + flex) in display currency
  const [baseTotalUsdDisplay, setBaseTotalUsdDisplay] = useState(0);
  const [totalChange24hUsd, setTotalChange24hUsd] = useState(0);
  const [totalChange24hPct, setTotalChange24hPct] = useState(0);

  // booster positions: enriched list + withdrawable total
  const [boosterPositions, setBoosterPositions] = useState<
    BoosterStaticPosition[]
  >([]);
  const [boosterPositionsCount, setBoosterPositionsCount] = useState(0);

  // NOTE: "Take-home" is SUM of (collateral + pnl) across all booster positions.
  // Stored in DISPLAY currency for easy use throughout the UI.
  const [boosterTakeHomeUsd, setBoosterTakeHomeUsd] = useState(0); // display currency
  const boosterTakeHomeBaseRef = useRef(0); // base USD (for snapshots + recalcs)

  // total = base + booster take-home (both in display currency)
  const totalUsd = useMemo(
    () => baseTotalUsdDisplay + boosterTakeHomeUsd,
    [baseTotalUsdDisplay, boosterTakeHomeUsd]
  );

  // prevent refresh dogpile
  const refreshInflight = useRef<Promise<void> | null>(null);

  const runRefresh = useCallback(
    async (opts?: { bypassUserLoading?: boolean }) => {
      if (refreshInflight.current) return refreshInflight.current;

      const p = (async () => {
        if (!opts?.bypassUserLoading && userLoading) return;

        const owner = user?.walletAddress || "";

        // flex linked?
        const flexSubdoc = user?.savingsAccounts?.find(
          (a: any) => a?.type === "flex"
        );
        const flexMarginfiPk =
          typeof (flexSubdoc as any)?.marginfiAccountPk === "string" &&
          (flexSubdoc as any).marginfiAccountPk.trim()
            ? (flexSubdoc as any).marginfiAccountPk.trim()
            : null;

        const hasLinkedFlexAccount = Boolean(flexMarginfiPk);

        if (!owner) {
          setTokens([]);
          setNativeSol(0);
          setUsdcUsd(0);
          setUsdcAmount(0);
          setSavingsFlexUsd(0);
          setSavingsFlexAmount(0);

          setBaseTotalUsdDisplay(0);
          setTotalChange24hUsd(0);
          setTotalChange24hPct(0);

          setBoosterPositions([]);
          setBoosterPositionsCount(0);
          boosterTakeHomeBaseRef.current = 0;
          setBoosterTakeHomeUsd(0);

          setLastUpdated(Date.now());
          setDisplayCurrency("USD");
          setFxRateState(1);
          return;
        }

        setLoading(true);

        try {
          const walletUrl = `/api/user/wallet/balance?owner=${encodeURIComponent(
            owner
          )}`;

          const walletReq = fetch(walletUrl, {
            method: "GET",
            cache: "no-store",
          });

          const fxReq = fetch("/api/fx", {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          });

          const flexReq = hasLinkedFlexAccount
            ? fetch("/api/savings/flex/balance", {
                method: "GET",
                cache: "no-store",
                credentials: "include",
              })
            : Promise.resolve(null);

          // ✅ booster positions fetch happens HERE (once per refresh)
          const boosterReq = fetch("/api/booster/positions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ownerBase58: owner }),
            cache: "no-store",
          });

          const [walletRes, fxRes, flexRes, boosterRes] = await Promise.all([
            walletReq,
            fxReq,
            flexReq,
            boosterReq,
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

          const walletTotalUsdBase =
            typeof walletJson.totalUsd === "number" &&
            !Number.isNaN(walletJson.totalUsd)
              ? walletJson.totalUsd
              : 0;

          const walletChangeUsdBase =
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
              flexUsdBase = flexAmount; // USDC-like
            } else {
              const t = await flexRes.text().catch(() => "");
              console.warn(
                "[BalanceProvider] /api/savings/flex/balance failed:",
                flexRes.status,
                flexRes.statusText,
                t
              );
              flexAmount = 0;
              flexUsdBase = 0;
            }
          }

          // ---------- booster positions (fetch + compute withdrawable correctly) ----------
          // Step 1: parse raw booster positions (base fields)
          let boosterBase: Array<{
            id: string;
            publicKey: string;
            symbol: "SOL" | "ETH" | "BTC";
            isLong: boolean;
            createdAt: string;
            entryUsd: number;
            sizeUsd: number;
            collateralUsd: number;
          }> = [];

          if (boosterRes.ok) {
            const bj = (await boosterRes
              .json()
              .catch(() => null)) as BoosterApiResponse | null;
            const raw = Array.isArray(bj?.positions) ? bj!.positions! : [];

            boosterBase = raw
              .map((p) => {
                const symbol = safeSymbol(p?.symbol);
                if (!symbol) return null;

                const pk = safeStr(p?.publicKey);
                if (!pk) return null;

                const entryUsd = usdFrom6Str(p?.account?.price);
                const sizeUsd = usdFrom6Str(p?.account?.sizeUsd);
                const collateralUsd = usdFrom6Str(p?.account?.collateralUsd);
                if (!(sizeUsd > 0) || !(entryUsd > 0)) return null;

                const isLong = p?.side === "long";

                const openSecs = Number(safeStr(p?.account?.openTime || "0"));
                const createdAt =
                  Number.isFinite(openSecs) &&
                  openSecs > 0 &&
                  openSecs < 10_000_000_000
                    ? new Date(openSecs * 1000).toISOString()
                    : new Date().toISOString();

                return {
                  id: pk,
                  publicKey: pk,
                  symbol,
                  isLong,
                  createdAt,
                  entryUsd,
                  sizeUsd,
                  collateralUsd,
                };
              })
              .filter(Boolean) as any[];
          }

          // Step 2: fetch marks ONCE (no polling)
          let marks: Partial<Record<"SOL" | "ETH" | "BTC", number>> = {};
          if (boosterBase.length) {
            const controller = new AbortController();
            try {
              marks = await fetchHermesMarks(
                boosterBase.map((p) => p.symbol),
                controller.signal
              );
            } catch {
              marks = {};
            }
          }

          // Step 3: enrich + compute WITHDRAWABLE = collateralUsd + pnlUsd
          const boosterEnriched: BoosterStaticPosition[] = boosterBase.map(
            (p) => {
              const mark = marks[p.symbol];
              const markUsd =
                Number.isFinite(mark as number) && (mark as number) > 0
                  ? (mark as number)
                  : p.entryUsd;

              // raw P&L: sizeUsd * %move (same logic you already had in the polling effect)
              const pnlUsd =
                p.entryUsd > 0 && p.sizeUsd > 0
                  ? p.isLong
                    ? p.sizeUsd * ((markUsd - p.entryUsd) / p.entryUsd)
                    : p.sizeUsd * ((p.entryUsd - markUsd) / p.entryUsd)
                  : 0;

              const takeHomeUsd = p.collateralUsd + pnlUsd;

              // position "value" shown in UI: sizeUsd + pnl
              const spotValueUsd = p.sizeUsd + pnlUsd;

              // token qty: sizeUsd / entry
              const sizeTokens = p.entryUsd > 0 ? p.sizeUsd / p.entryUsd : 0;

              return {
                ...p,
                sizeTokens,
                pnlUsd,
                spotValueUsd,
                takeHomeUsd,
              };
            }
          );

          setBoosterPositions(boosterEnriched);
          setBoosterPositionsCount(boosterEnriched.length);

          // ✅ SUM withdrawable in BASE USD, store in ref for snapshots
          const boosterTakeHomeBase = boosterEnriched.reduce((sum, p) => {
            const net = Number.isFinite(p.takeHomeUsd) ? p.takeHomeUsd : 0;
            return sum + net;
          }, 0);

          boosterTakeHomeBaseRef.current = boosterTakeHomeBase;

          // ✅ store TAKE-HOME in DISPLAY currency (this is what you add to totalUsd)
          setBoosterTakeHomeUsd(boosterTakeHomeBase * fxRate);

          // ---------- totals (BASE USD, excluding booster; booster added via take-home state) ----------
          const combinedBaseUsd =
            walletTotalUsdBase + (hasLinkedFlexAccount ? flexUsdBase : 0);

          const prevBaseUsd =
            walletTotalUsdBase -
            walletChangeUsdBase +
            (hasLinkedFlexAccount ? flexUsdBase : 0);

          const changePct =
            prevBaseUsd > 0 ? walletChangeUsdBase / prevBaseUsd : 0;

          // ---------- convert to DISPLAY currency ----------
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

          // ---------- snapshot (BASE USD) ----------
          // snapshot uses booster take-home BASE (no loops)
          const snapshotTotalBase = combinedBaseUsd + boosterTakeHomeBase;

          if (snapshotTotalBase > 0) {
            try {
              await fetch("/api/user/balance/snapshot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  owner,
                  totalUsd: snapshotTotalBase,
                  breakdown: {
                    ...(hasLinkedFlexAccount
                      ? { savingsFlex: flexUsdBase }
                      : {}),
                    boosterTakeHome: boosterTakeHomeBase,
                  },
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
      })();

      refreshInflight.current = p;
      try {
        await p;
      } finally {
        refreshInflight.current = null;
      }
    },
    [user, userLoading]
  );

  const refresh = useCallback(async () => {
    await runRefresh({ bypassUserLoading: false });
  }, [runRefresh]);

  const refreshNow = useCallback(async () => {
    await runRefresh({ bypassUserLoading: true });
  }, [runRefresh]);

  // ✅ initial refresh only when owner becomes available / changes
  useEffect(() => {
    if (!ownerReady) return;
    void runRefresh({ bypassUserLoading: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerReady, ownerAddress]);

  // ✅ NO POLLING.
  // If you want updates, call refresh() explicitly (e.g., after trade/close).

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
