"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

import DepositFlex from "@/components/accounts/flex/Deposit";
import WithdrawFlex from "@/components/accounts/flex/Withdraw";

type DrawerMode = "deposit" | "withdraw" | null;

type SavingsAccountShape = {
  walletAddress: string;
  totalDeposited: number;
};

type FlexSavingsAccountCardProps = {
  account?: SavingsAccountShape;
  loading?: boolean;
  displayCurrency?: string;

  onDeposit: () => void;
  onWithdraw: () => void;
  onOpenAccount: () => void;

  apyPctOverride?: number;
};

type ApyResponse = {
  ok?: boolean;
  apyPct?: number;
  apy?: number;
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
  onOpenAccount,
  apyPctOverride,
}) => {
  const { loading: userLoading, savingsFlex } = useUser();
  const { loading: balanceLoading, savingsFlexUsd } = useBalance();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  const [apyPctLive, setApyPctLive] = useState<number | null>(null);
  const [apyLoading, setApyLoading] = useState(false);

  const effectiveLoading = loadingProp ?? (userLoading || balanceLoading);

  const linkedMarginfiPk =
    typeof savingsFlex?.marginfiAccountPk === "string" &&
    savingsFlex.marginfiAccountPk.trim()
      ? savingsFlex.marginfiAccountPk.trim()
      : null;

  const hasAccount = Boolean(linkedMarginfiPk);
  const accountPkToShow = linkedMarginfiPk || "";

  const effectiveBalance = useMemo(() => {
    if (Number.isFinite(savingsFlexUsd)) return savingsFlexUsd as number;
    if (account && Number.isFinite(account.totalDeposited))
      return account.totalDeposited;
    return 0;
  }, [account, savingsFlexUsd]);

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

  // APY fetch
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

  // ----------------------------
  // CLOSED STATE (Open account)
  // ----------------------------
  if (!hasAccount) {
    return (
      <Link href="/flex" className="block h-full">
        <div className="haven-card flex h-full min-h-[240px] w-full cursor-pointer flex-col justify-between p-4 sm:p-6">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="haven-kicker">Flex Account</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Earn yield with flexible access
                </p>
              </div>

              <span className="haven-pill">
                <span className="h-2 w-2 rounded-full bg-primary" />
                New
              </span>
            </div>

            <p className="mt-4 text-lg font-semibold">Open Flex Account</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Start earning automatically on idle USDC.
            </p>
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenAccount();
              }}
              className="haven-btn-primary text-[#0b3204]"
            >
              Open account
            </button>
          </div>
        </div>
      </Link>
    );
  }

  // ----------------------------
  // OPEN STATE
  // ----------------------------
  return (
    <Drawer open={drawerOpen} onOpenChange={handleDrawerChange}>
      <Link href="/flex" className="block h-full">
        <div className="haven-card flex h-full min-h-[240px] w-full cursor-pointer flex-col justify-between p-4 sm:p-6">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="haven-kicker">Flex Account</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Account #{shortAddress(accountPkToShow)}
                </p>
              </div>

              <span className="haven-pill">
                {apyLoading ? (
                  "APY …"
                ) : apyFinal === null ? (
                  "APY —"
                ) : (
                  <>APY {apyFinal.toFixed(2)}%</>
                )}
              </span>
            </div>

            <div className="mt-4">
              <p className="text-3xl text-foreground font-semibold tracking-tight sm:text-4xl">
                {effectiveLoading ? "…" : formatDisplay(effectiveBalance)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Yield accrues daily, withdraw anytime
              </p>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <DrawerTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  // ✅ prevent the card link from navigating
                  e.preventDefault();
                  e.stopPropagation();
                  openDrawer("deposit");
                }}
                className="haven-btn-primary flex-1 text-[#0b3204]"
              >
                Deposit
              </button>
            </DrawerTrigger>

            <DrawerTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  // ✅ prevent the card link from navigating
                  e.preventDefault();
                  e.stopPropagation();
                  openDrawer("withdraw");
                }}
                className="haven-btn-primary flex-1 text-[#0b3204]"
              >
                Withdraw
              </button>
            </DrawerTrigger>
          </div>
        </div>
      </Link>

      {drawerMode === "deposit" && (
        <DepositFlex
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setDrawerMode(null);
          }}
          hasAccount
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
