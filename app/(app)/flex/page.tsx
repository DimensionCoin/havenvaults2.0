"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, RefreshCw, PiggyBank } from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

import DepositFlex from "@/components/accounts/flex/Deposit";
import WithdrawFlex from "@/components/accounts/flex/Withdraw";

import { useFlexInterestFromBalance } from "@/hooks/useFlexInterest";

/* =========================
   CONSTANTS
========================= */

const APY_URL = "/api/savings/flex/apy";
const ACTIVITY_URL = "/api/savings/flex/activity";

const EXPLORER_TX_BASE = "https://orbmarkets.io/tx/";
const EXPLORER_ACCOUNT_BASE = "https://orbmarkets.io/address/";

/* =========================
   TYPES
========================= */

type DrawerMode = "deposit" | "withdraw" | null;

type TxRow = {
  signature: string;
  blockTime: number | null;
  status: "success" | "failed";
  kind?: "transfer";
  direction?: "out" | "in";
  amountUsdc?: number | null;
  source?: "onchain";
};

type ApyResponse = {
  ok?: boolean;
  apyPct?: number;
  apy?: number;
  error?: string;
};

type FxPayload = { rate?: number };

type OnchainTx = {
  id: string;
  signature: string;
  direction: "deposit" | "withdraw";
  amountUsdc: number; // UI units
  blockTime: number | null;
  status: "success" | "failed";
};

type OnchainTxResponse = {
  ok?: boolean;
  txs?: OnchainTx[];
  nextCursor?: string | null; // signature cursor
  exhausted?: boolean;
  error?: string;
};

/* =========================
   HELPERS
========================= */

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  const a = addr.trim();
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
};

const formatDayTime = (unixSeconds?: number | null) => {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function clamp0(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function SavingsAvatar() {
  return (
    <span className="h-7 w-7 rounded-full border border-white/10 bg-white/[0.06] inline-flex items-center justify-center shrink-0">
      <PiggyBank className="h-4 w-4 text-foreground/80" />
    </span>
  );
}

/**
 * On-chain tx -> UI row
 * deposit => direction "out"
 * withdraw => direction "in"
 */
function onchainToTxRow(row: OnchainTx): TxRow {
  const isDeposit = row.direction === "deposit";
  return {
    signature: row.signature,
    blockTime: typeof row.blockTime === "number" ? row.blockTime : null,
    status: row.status,
    kind: "transfer",
    direction: isDeposit ? "out" : "in",
    amountUsdc: row.amountUsdc ?? 0,
    source: "onchain",
  };
}

/* =========================
   PAGE
========================= */

export default function FlexAccountPage() {
  const router = useRouter();
  const { user, loading: userLoading, savingsFlex } = useUser();

  const {
    loading: balanceLoading,
    savingsFlexUsd, // already converted to display currency by provider
    savingsFlexAmount, // on-chain USDC balance (UI)
  } = useBalance();

  const walletAddress = user?.walletAddress || "";

  const linkedMarginfiPk =
    typeof savingsFlex?.marginfiAccountPk === "string" &&
    savingsFlex.marginfiAccountPk.trim()
      ? savingsFlex.marginfiAccountPk.trim()
      : null;

  const hasAccount = Boolean(linkedMarginfiPk);

  const displayCurrency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const [rate, setRate] = useState<number>(1);

  const loadFx = useCallback(async () => {
    if (displayCurrency === "USD") {
      setRate(1);
      return;
    }
    try {
      const r = await fetch(
        `/api/fx?currency=${encodeURIComponent(displayCurrency)}&amount=1`,
        {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      const j = (await r.json().catch(() => ({}))) as FxPayload;
      const fx = r.ok ? Number(j?.rate) : 1;
      setRate(Number.isFinite(fx) && fx > 0 ? fx : 1);
    } catch {
      setRate(1);
    }
  }, [displayCurrency]);

  /* -------- APY -------- */
  const [apyPctLive, setApyPctLive] = useState<number | null>(null);
  const [apyLoading, setApyLoading] = useState(false);

  useEffect(() => {
    if (!hasAccount) return;

    let cancelled = false;

    const run = async () => {
      try {
        setApyLoading(true);

        const cacheKey = "flex_apy_cache_v1";
        const cachedRaw =
          typeof window !== "undefined"
            ? sessionStorage.getItem(cacheKey)
            : null;

        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as {
            at: number;
            apyPct: number;
          };
          if (
            cached &&
            typeof cached.at === "number" &&
            typeof cached.apyPct === "number" &&
            Number.isFinite(cached.apyPct) &&
            Date.now() - cached.at < 5 * 60 * 1000
          ) {
            if (!cancelled) setApyPctLive(cached.apyPct);
            return;
          }
        }

        const res = await fetch(APY_URL, { method: "GET", cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as ApyResponse;

        const pct =
          typeof data.apyPct === "number" && Number.isFinite(data.apyPct)
            ? data.apyPct
            : typeof data.apy === "number" && Number.isFinite(data.apy)
              ? data.apy * 100
              : 0;

        if (!cancelled) setApyPctLive(pct);

        if (typeof window !== "undefined") {
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({ at: Date.now(), apyPct: pct })
          );
        }
      } catch {
        if (!cancelled) setApyPctLive(null);
      } finally {
        if (!cancelled) setApyLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [hasAccount]);

  /* -------- Balance (display currency) -------- */
  const effectiveBalance = useMemo(() => {
    const n = Number(savingsFlexUsd);
    return Number.isFinite(n) ? n : 0;
  }, [savingsFlexUsd]);

  const balanceDisplay = useMemo(() => {
    return formatCurrency(effectiveBalance, displayCurrency);
  }, [effectiveBalance, displayCurrency]);

  const loading = userLoading || balanceLoading;

  /* -------- On-chain balance in USDC (from provider, no API hit) -------- */
  const onchainFlexUsdc = useMemo(() => {
    const n = Number(savingsFlexAmount);
    return Number.isFinite(n) ? n : 0;
  }, [savingsFlexAmount]);

  /* -------- ✅ Interest (DB principal + provider onchain balance) -------- */
  const {
    loading: interestLoading,
    principalNet,
    unrealizedInterest,
    // lifetimeInterestEarned,
    // interestWithdrawn,
    error: interestError,
  } = useFlexInterestFromBalance({
    enabled: hasAccount,
    onchainBalanceUsdc: onchainFlexUsdc,
  });

  const interestEarnedDisplay = useMemo(() => {
    // unrealizedInterest is USDC; convert to display currency with FX rate
    return formatCurrency(unrealizedInterest * rate, displayCurrency);
  }, [unrealizedInterest, rate, displayCurrency]);

  /* -------- Activity (paginate) - ONCHAIN ONLY -------- */
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const fetchTxsPage = useCallback(
    async (reset = false) => {
      if (!walletAddress) return;
      if (!linkedMarginfiPk) return;

      try {
        setTxLoading(true);
        setTxError(null);

        const cursor =
          !reset && nextCursor
            ? `&cursor=${encodeURIComponent(nextCursor)}`
            : "";

        const url = `${ACTIVITY_URL}?account=${encodeURIComponent(
          linkedMarginfiPk
        )}&limit=30${cursor}`;

        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        const data = (await res.json().catch(() => ({}))) as OnchainTxResponse;

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `Failed (${res.status})`);
        }

        const pageOnchain = Array.isArray(data?.txs) ? data.txs : [];
        const page = pageOnchain.map(onchainToTxRow);

        setTxs((prev) => {
          if (reset) return page;
          const seen = new Set(prev.map((p) => p.signature));
          const merged = [...prev];
          for (const row of page) {
            if (!seen.has(row.signature)) merged.push(row);
          }
          return merged;
        });

        const newCursor =
          typeof data?.nextCursor === "string" && data.nextCursor.trim()
            ? data.nextCursor.trim()
            : null;

        setNextCursor(newCursor);
        if (data?.exhausted === true || !newCursor) setExhausted(true);
      } catch (e) {
        setTxError(e instanceof Error ? e.message : "Failed to load activity");
        if (reset) setTxs([]);
        setNextCursor(null);
        setExhausted(true);
      } finally {
        setTxLoading(false);
      }
    },
    [walletAddress, linkedMarginfiPk, nextCursor]
  );

  // Load FX + first activity page
  useEffect(() => {
    if (!user) return;
    if (!linkedMarginfiPk) return;

    loadFx();
    setTxs([]);
    setNextCursor(null);
    setExhausted(false);
    fetchTxsPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, linkedMarginfiPk]);

  const flexActivity = useMemo(() => {
    const rows = txs
      .filter((t) => t.kind === "transfer")
      .filter((t) => (t.amountUsdc ?? 0) > 0)
      .slice();

    rows.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
    return rows;
  }, [txs]);

  const hasMore = !exhausted;

  /* -------- Drawer (Deposit/Withdraw) -------- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  const openDrawer = (mode: Exclude<DrawerMode, null>) => {
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

  const openExplorerTx = useCallback((sig: string) => {
    window.open(
      `${EXPLORER_TX_BASE}${encodeURIComponent(sig)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }, []);

  const openExplorerAccount = useCallback((address: string) => {
    window.open(
      `${EXPLORER_ACCOUNT_BASE}${encodeURIComponent(address)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }, []);

  /* -------- Guards -------- */

  if (!user && !userLoading) {
    return (
      <div className="haven-app px-4 py-6">
        <div className="haven-card p-5">
          <p className="text-sm text-muted-foreground">Please sign in.</p>
        </div>
      </div>
    );
  }

  if (user && !userLoading && !hasAccount) {
    return (
      <div className="haven-app px-4 py-6">
        <div className="mx-auto w-full max-w-[560px] space-y-4">
          <div className="relative flex items-start justify-center">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Back"
              className="haven-icon-btn absolute left-0 top-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            <div className="text-center">
              <p className="haven-kicker">Flex Account</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Earn yield with flexible access
              </p>
            </div>
          </div>

          <div className="haven-card p-5">
            <p className="text-sm text-muted-foreground">
              You don&apos;t have a Flex account yet.
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Open one to start earning on idle USDC.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* -------- Render -------- */

  return (
    <div className="px-4 py-6">
      <div className="mx-auto w-full max-w-[560px] space-y-4">
        {/* Header */}
        <div className="relative flex items-start justify-center">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="haven-icon-btn absolute left-0 top-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="text-center">
            <p className="haven-kicker">Flex Account</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Account #{shortAddress(linkedMarginfiPk)}
            </p>
          </div>
        </div>

        {/* Balance card */}
        <div className="haven-card p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="haven-kicker">Flex balance</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-foreground">
                {loading ? "…" : balanceDisplay}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Yield accrues daily, withdraw anytime
              </p>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span className="haven-pill">
                {apyLoading ? (
                  "APY …"
                ) : apyPctLive == null ? (
                  "APY —"
                ) : (
                  <>APY {apyPctLive.toFixed(2)}%</>
                )}
              </span>

              <p className="text-[11px] text-muted-foreground">
                {loading || interestLoading
                  ? "Interest earned —"
                  : `Interest earned ${interestEarnedDisplay}`}
              </p>

              {/* Optional: tiny debug line (remove later) */}
              {/* <p className="text-[10px] text-muted-foreground">
                Principal {principalNet.toFixed(6)} • On-chain {onchainFlexUsdc.toFixed(6)}
              </p> */}

              {interestError ? (
                <p className="text-[11px] text-muted-foreground">
                  Interest unavailable
                </p>
              ) : null}

              <button
                type="button"
                disabled={!linkedMarginfiPk}
                onClick={() =>
                  linkedMarginfiPk && openExplorerAccount(linkedMarginfiPk)
                }
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-foreground/80 hover:text-foreground disabled:opacity-40"
              >
                View account <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => openDrawer("deposit")}
              className="haven-btn-primary flex-1 text-[#0b3204]"
            >
              Deposit
            </button>

            <button
              type="button"
              onClick={() => openDrawer("withdraw")}
              className="haven-btn-primary flex-1 text-[#0b3204]"
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Activity */}
        <div className="haven-card p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <p className="haven-kicker">Activity</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Flex deposits & withdrawals (on-chain)
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setTxs([]);
                setNextCursor(null);
                setExhausted(false);
                fetchTxsPage(true);
              }}
              className="haven-icon-btn"
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3">
            {txLoading && txs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : txError ? (
              <p className="text-sm text-muted-foreground">{txError}</p>
            ) : flexActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Flex activity yet.
              </p>
            ) : (
              <div className="space-y-2">
                {flexActivity.map((tx) => {
                  const isFlexDeposit = tx.direction === "out";
                  const title = isFlexDeposit
                    ? "Flex deposit"
                    : "Flex withdrawal";

                  const amtUsdc = tx.amountUsdc ?? 0;
                  const amtLocal = amtUsdc * rate;

                  const rightTop = isFlexDeposit
                    ? `+${formatCurrency(amtLocal, displayCurrency)}`
                    : `-${formatCurrency(amtLocal, displayCurrency)}`;

                  return (
                    <div
                      key={tx.signature}
                      className="haven-row hover:bg-accent transition flex items-start gap-3"
                    >
                      <div className="pt-0.5">
                        <SavingsAvatar />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {title}
                        </p>

                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDayTime(tx.blockTime)}
                        </p>

                        <button
                          type="button"
                          onClick={() => openExplorerTx(tx.signature)}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-foreground/70 hover:text-foreground"
                        >
                          View tx <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="text-right shrink-0 pl-2">
                        <p className="text-sm font-semibold text-foreground tabular-nums">
                          {rightTop}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {hasMore && flexActivity.length > 0 && (
              <button
                type="button"
                onClick={() => fetchTxsPage(false)}
                disabled={txLoading}
                className="haven-btn-primary w-full mt-3 text-[#0b3204] disabled:opacity-60"
              >
                {txLoading ? "Loading…" : "Load more"}
              </button>
            )}

            {exhausted && flexActivity.length > 0 && (
              <p className="mt-3 text-[11px] text-muted-foreground text-center">
                You&apos;ve reached the end of the available history.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {drawerMode === "deposit" && (
        <DepositFlex
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setDrawerMode(null);
          }}
          hasAccount={hasAccount}
        />
      )}

      {drawerMode === "withdraw" && (
        <WithdrawFlex
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setDrawerMode(null);
          }}
          availableBalance={effectiveBalance}
        />
      )}
    </div>
  );
}
