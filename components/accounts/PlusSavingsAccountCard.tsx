"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

import DepositPlus from "@/components/accounts/plus/Deposit";
import WithdrawPlus from "@/components/accounts/plus/Withdraw";

type DrawerMode = "deposit" | "withdraw" | null;

type SavingsAccountShape = {
  walletAddress: string;
  totalDeposited: number;
};

type PlusSavingsAccountCardProps = {
  account?: SavingsAccountShape;
  loading?: boolean;
  displayCurrency?: string;

  onDeposit: () => void; // kept for compatibility (unused)
  onWithdraw: () => void; // kept for compatibility (unused)
  onOpenAccount: () => void;

  apyPctOverride?: number;
};

type ApyResponse = {
  ok?: boolean;
  apyPct?: number;
  apy?: number;
  apyPercentage?: string;
  error?: string;
};

const APY_URL = "/api/savings/plus/apy";

const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

/* ───────── safe helpers (no any) ───────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function getNumberField(obj: unknown, key: string): number | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function getStringField(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

const PlusSavingsAccountCard: React.FC<PlusSavingsAccountCardProps> = ({
  account,
  loading: loadingProp,

  // ✅ Fix unused-var lint: accept prop but don’t use it
  onOpenAccount: _onOpenAccount,

  apyPctOverride,
}) => {
  const { loading: userLoading, user } = useUser();
  const balanceCtx = useBalance();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  // Live APY
  const [apyPctLive, setApyPctLive] = useState<number | null>(null);
  const [apyLoading, setApyLoading] = useState(false);

  // ✅ Pull Plus balance from provider (already in display currency)
  const plusUsdDisplay = getNumberField(balanceCtx, "savingsPlusUsd") ?? 0; // display currency value
  const plusAmount = getNumberField(balanceCtx, "savingsPlusAmount") ?? 0; // base units in UI amount (JupUSD-ish)

  const balanceLoading = getNumberField(balanceCtx, "loading")
    ? Boolean(getNumberField(balanceCtx, "loading"))
    : Boolean((balanceCtx as unknown as { loading?: boolean })?.loading);

  // For subtitle
  const accountPkToShow = account?.walletAddress
    ? account.walletAddress
    : user?.walletAddress && user.walletAddress !== "pending"
      ? user.walletAddress
      : "";

  // ✅ Display currency comes from provider/user
  const displayCurrency = (
    getStringField(balanceCtx, "displayCurrency") ??
    (isRecord(user) ? getStringField(user, "displayCurrency") : undefined) ??
    "USD"
  )
    .toUpperCase()
    .trim();

  const effectiveLoading = loadingProp ?? (userLoading || balanceLoading);

  // Format money in *display currency* (value already converted)
  const formatDisplay = (displayValue?: number | null) => {
    const v =
      displayValue === undefined ||
      displayValue === null ||
      Number.isNaN(displayValue)
        ? 0
        : Number(displayValue);

    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: displayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
    } catch {
      return `$${v.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  };

  const openDrawer = (mode: Exclude<DrawerMode, null>) => {
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

  const handleDrawerChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) setDrawerMode(null);
  };

  // ───────── Fetch APY ─────────
  useEffect(() => {
    if (typeof apyPctOverride === "number" && Number.isFinite(apyPctOverride)) {
      setApyPctLive(null);
      setApyLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setApyLoading(true);

        const cacheKey = "plus_apy_cache_v1";
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
              : typeof data.apyPercentage === "string" &&
                  Number.isFinite(Number(data.apyPercentage))
                ? Number(data.apyPercentage)
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
  }, [apyPctOverride]);

  const apyFinal =
    typeof apyPctOverride === "number" && Number.isFinite(apyPctOverride)
      ? apyPctOverride
      : apyPctLive;

  // ✅ Balance value to show:
  // Prefer provider value; fallback to account.totalDeposited (assumed already display currency)
  const effectiveBalanceDisplay = useMemo(() => {
    if (Number.isFinite(plusUsdDisplay) && plusUsdDisplay > 0)
      return plusUsdDisplay;
    if (account && Number.isFinite(account.totalDeposited))
      return account.totalDeposited;
    return 0;
  }, [account, plusUsdDisplay]);

  // ✅ Has account?
  // Use provider amount > 0 as a proxy (no API call).
  const hasPosition = plusAmount > 0;

  return (
    <Drawer open={drawerOpen} onOpenChange={handleDrawerChange}>
      <Link href="/plus" className="block h-full">
        <div className="haven-card flex h-full min-h-[240px] w-full cursor-pointer flex-col justify-between p-4 sm:p-6">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="haven-kicker">Plus Account</p>
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
                {effectiveLoading
                  ? "…"
                  : formatDisplay(effectiveBalanceDisplay)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Higher yield, USDC → JupUSD vault strategy
              </p>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <DrawerTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
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
        <DepositPlus
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setDrawerMode(null);
          }}
          hasAccount={hasPosition}
        />
      )}

      {drawerMode === "withdraw" && (
        <WithdrawPlus
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setDrawerMode(null);
          }}
          // ✅ IMPORTANT: Withdraw component likely expects USD amount.
          // If WithdrawPlus expects base USD (not display currency), tell me and we’ll pass plusAmount instead.
          availableBalance={effectiveBalanceDisplay}
        />
      )}
    </Drawer>
  );
};

export default PlusSavingsAccountCard;
