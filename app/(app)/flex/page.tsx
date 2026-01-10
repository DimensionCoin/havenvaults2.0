"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, PiggyBank } from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

import DepositFlex from "@/components/accounts/flex/Deposit";
import WithdrawFlex from "@/components/accounts/flex/Withdraw";

/* =========================
   CONSTANTS
========================= */

// ✅ Flex savings vault address (the counterparty for deposits/withdrawals)
const FLEX_SAVINGS_ADDR = "3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG";

// APY endpoint you already use in the card
const APY_URL = "/api/savings/flex/apy";

/* =========================
   TYPES
========================= */

type DrawerMode = "deposit" | "withdraw" | null;

type TxRow = {
  signature: string;
  blockTime: number | null;
  status: "success" | "failed";

  kind?: "transfer" | "swap";
  direction?: "in" | "out" | "neutral";

  amountUsdc?: number | null;

  counterparty?: string | null;
  counterpartyLabel?: string | null;

  source?: string | null;
};

type ApyResponse = {
  ok?: boolean;
  apyPct?: number;
  apy?: number;
  error?: string;
};

/* =========================
   HELPERS
========================= */

const normAddr = (a?: string | null) => (a || "").trim();

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  const a = addr.trim();
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
};

const formatTime = (unixSeconds?: number | null) => {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function formatUsd(n?: number | null) {
  const v = n == null || Number.isNaN(n) ? 0 : Number(n);
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function SavingsAvatar() {
  return (
    <span className="h-7 w-7 rounded-full border border-white/10 bg-white/[0.06] inline-flex items-center justify-center">
      <PiggyBank className="h-4 w-4 text-foreground/80" />
    </span>
  );
}

/* =========================
   PAGE
========================= */

export default function FlexAccountPage() {
  const router = useRouter();
  const { user, loading: userLoading, savingsFlex } = useUser();
  const { loading: balanceLoading, savingsFlexUsd } = useBalance();

  const walletAddress = user?.walletAddress || "";

  const linkedMarginfiPk =
    typeof savingsFlex?.marginfiAccountPk === "string" &&
    savingsFlex.marginfiAccountPk.trim()
      ? savingsFlex.marginfiAccountPk.trim()
      : null;

  const hasAccount = Boolean(linkedMarginfiPk);

  // -------- APY --------
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

  // -------- Balance --------
  const effectiveBalance = useMemo(() => {
    const n = Number(savingsFlexUsd);
    return Number.isFinite(n) ? n : 0;
  }, [savingsFlexUsd]);

  const loading = userLoading || balanceLoading;

  // -------- Drawer (Deposit/Withdraw) --------
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  const openDrawer = (mode: Exclude<DrawerMode, null>) => {
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

  // -------- Activity --------
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);

  const fetchTxs = useCallback(async () => {
    if (!walletAddress) return;

    try {
      setTxLoading(true);
      setTxError(null);

      const res = await fetch(`/api/user/wallet/transactions?limit=500`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        txs?: TxRow[];
        error?: string;
      };

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }

      setTxs(Array.isArray(data?.txs) ? data.txs : []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "";
      setTxError(message || "Failed to load activity");
      setTxs([]);
    } finally {
      setTxLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!user) return;
    fetchTxs();
  }, [user, fetchTxs]);

  // Only savings deposits/withdrawals:
  // - transfers only
  // - counterparty == FLEX_SAVINGS_ADDR
  const savingsActivity = useMemo(() => {
    const rows = txs
      .filter((t) => t.kind === "transfer")
      .filter((t) => (t.amountUsdc ?? 0) > 0)
      .filter((t) => normAddr(t.counterparty) === FLEX_SAVINGS_ADDR)
      .slice();

    rows.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
    return rows.slice(0, 25);
  }, [txs]);

  if (!user && !userLoading) {
    return (
      <div className="haven-app px-4 py-6">
        <div className="haven-card p-5">
          <p className="text-sm text-muted-foreground">Please sign in.</p>
        </div>
      </div>
    );
  }

  // If they don’t have a flex account yet, keep it simple (you can replace with your “Open account” CTA later)
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
              You don’t have a Flex account yet.
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Open one to start earning on idle USDC.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="haven-app px-4 py-6">
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
                {loading ? "…" : formatUsd(effectiveBalance)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Yield accrues daily, withdraw anytime
              </p>
            </div>

            <span className="haven-pill">
              {apyLoading ? (
                "APY …"
              ) : apyPctLive == null ? (
                "APY —"
              ) : (
                <>APY {apyPctLive.toFixed(2)}%</>
              )}
            </span>
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

        {/* Activity (only savings deposits/withdrawals) */}
        <div className="haven-card p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <p className="haven-kicker">Recent activity</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Deposits & withdrawals only
              </p>
            </div>

            <button
              type="button"
              onClick={fetchTxs}
              className="haven-icon-btn"
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3">
            {txLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : txError ? (
              <p className="text-sm text-muted-foreground">{txError}</p>
            ) : savingsActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent Flex activity yet.
              </p>
            ) : (
              <div className="space-y-2">
                {savingsActivity.map((tx) => {
                  const isDeposit = tx.direction === "out"; // wallet -> savings
                  const title = isDeposit
                    ? "Savings deposit"
                    : "Savings withdrawal";
                  const rightTop = isDeposit
                    ? `-${formatUsd(tx.amountUsdc ?? 0)}`
                    : `+${formatUsd(tx.amountUsdc ?? 0)}`;

                  return (
                    <div
                      key={tx.signature}
                      className="haven-row hover:bg-accent transition"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {title}
                        </p>

                        <div className="mt-1 flex items-center gap-2">
                          <SavingsAvatar />
                          <p className="text-xs text-muted-foreground">
                            {isDeposit ? "To" : "From"} Flex Savings Account
                          </p>
                        </div>

                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatTime(tx.blockTime)}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {rightTop}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drawer-like modals */}
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
