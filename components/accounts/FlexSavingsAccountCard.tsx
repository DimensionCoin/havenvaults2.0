"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

import DepositFlex from "@/components/accounts/flex/Deposit";
import WithdrawFlex from "@/components/accounts/flex/Withdraw";

type DrawerMode = "deposit" | "withdraw" | null;

type SavingsAccountShape = {
  walletAddress: string;
  totalDeposited: number; // NOTE: lifetime deposits/principal-ish — NOT live balance
};

type FlexSavingsAccountCardProps = {
  account?: SavingsAccountShape;
  loading?: boolean;
  displayCurrency?: string;

  onDeposit: () => void;
  onWithdraw: () => void;
  onOpenAccount: () => void;

  apyPctOverride?: number; // e.g. 4.25
};

type ApyResponse = {
  ok?: boolean;
  apyPct?: number;
  apy?: number; // decimal, e.g. 0.0425
  error?: string;
};

const APY_URL = "/api/savings/flex/apy";

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

const FlexSavingsAccountCard: React.FC<FlexSavingsAccountCardProps> = ({
  account,
  loading: loadingProp,
  displayCurrency: displayCurrencyProp,
  onOpenAccount,
  apyPctOverride,
}) => {
  const { user, loading: userLoading, savingsFlex } = useUser();
  const {
    loading: balanceLoading,
    displayCurrency: balanceCurrency,
    savingsFlexUsd, // (this is your LIVE balance value coming from BalanceProvider)
  } = useBalance();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  // ---------- APY state ----------
  const [apyPctLive, setApyPctLive] = useState<number | null>(null);
  const [apyLoading, setApyLoading] = useState(false);

  const effectiveLoading = loadingProp ?? (userLoading || balanceLoading);

  

  // ✅ Only treat as "open account" when we have a real marginfiAccountPk
  const linkedMarginfiPk =
    typeof savingsFlex?.marginfiAccountPk === "string" &&
    savingsFlex.marginfiAccountPk.trim()
      ? savingsFlex.marginfiAccountPk.trim()
      : null;

  // ✅ IMPORTANT: don't use `account` to determine "has account"
  // because `account` may exist even when the marginfi link isn't real.
  const hasAccount = Boolean(linkedMarginfiPk);

  // address to show on the "open" style card
  const accountPkToShow = linkedMarginfiPk || "";

  // ✅ FIX: Always prefer BalanceProvider's live balance for display.
  // Only fall back to account.totalDeposited if provider value is missing.
  const effectiveBalance = useMemo(() => {
    if (Number.isFinite(savingsFlexUsd)) return savingsFlexUsd as number;

    // fallback only (this is NOT a live balance, it's lifetime deposits/principal)
    if (account && Number.isFinite(account.totalDeposited)) {
      return account.totalDeposited;
    }

    return 0;
  }, [account, savingsFlexUsd]);

  // Always show "$" (no CAD$, US$, etc) but still keep separators/decimals
  const formatDisplay = (n?: number | null) => {
    const value =
      n === undefined || n === null || Number.isNaN(n) ? 0 : Number(n);

    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const openDrawer = (mode: Exclude<DrawerMode, null>) => {
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

  const handleDrawerChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) setDrawerMode(null);
  };

  // ---------- Fetch APY (only when account exists, and only if no override) ----------
  useEffect(() => {
    if (!hasAccount) return;
    if (typeof apyPctOverride === "number" && Number.isFinite(apyPctOverride)) {
      setApyPctLive(null);
      setApyLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setApyLoading(true);

        // 5-min session cache
        const cacheKey = "flex_apy_cache_v1";
        const cachedRaw = sessionStorage.getItem(cacheKey);
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

        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({ at: Date.now(), apyPct: pct })
        );
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
  }, [hasAccount, apyPctOverride]);

  const apyFinal =
    typeof apyPctOverride === "number" && Number.isFinite(apyPctOverride)
      ? apyPctOverride
      : apyPctLive;

  if (!hasAccount) {
    return (
      <div className="flex h-full w-full flex-col justify-between rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 via-zinc-950 to-zinc-950 px-4 py-4 sm:px-6 sm:py-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
            Flex Account
          </p>

          <p className="mt-3 text-lg font-semibold text-zinc-50 sm:text-xl">
            Open Flex Account
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Earn yield with flexible access.
          </p>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={onOpenAccount}
            className="w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] transition hover:brightness-105"
          >
            Open account
          </button>
        </div>
      </div>
    );
  }

  return (
    <Drawer open={drawerOpen} onOpenChange={handleDrawerChange}>
      <div className="flex h-full w-full flex-col justify-between rounded-2xl border border-zinc-800 bg-white/10 px-4 py-4 sm:px-6 sm:py-5">
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-200/80">
              Flex Account
            </p>

            <div className="rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
              {apyLoading
                ? "APY …"
                : apyFinal === null
                  ? "APY —"
                  : `APY ${apyFinal.toFixed(2)}%`}
            </div>
          </div>

          <div className="mt-3">
            <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-50 sm:text-4xl">
              {effectiveLoading ? "…" : formatDisplay(effectiveBalance)}
            </p>

            <div className="mt-1 flex items-center justify-between">
              <p className="text-[11px] text-zinc-500">
                Account #{shortAddress(accountPkToShow)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <DrawerTrigger asChild>
            <button
              type="button"
              onClick={() => openDrawer("deposit")}
              className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-black shadow-[0_0_18px_rgba(190,242,100,0.6)] transition hover:brightness-105"
            >
              Deposit
            </button>
          </DrawerTrigger>

          <DrawerTrigger asChild>
            <button
              type="button"
              onClick={() => openDrawer("withdraw")}
              className="flex-1 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-900"
            >
              Withdraw
            </button>
          </DrawerTrigger>
        </div>
      </div>

      {drawerMode === "deposit" && (
        <DepositFlex
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setDrawerMode(null);
          }}
          hasAccount={true}
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
    </Drawer>
  );
};

export default FlexSavingsAccountCard;
