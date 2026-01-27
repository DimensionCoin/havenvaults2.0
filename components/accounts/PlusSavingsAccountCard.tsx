// components/accounts/PlusSavingsAccountCard.tsx
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

  onDeposit: () => void; // compatibility (unused)
  onWithdraw: () => void; // compatibility (unused)
  onOpenAccount: () => void; // compatibility (unused)

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

  onOpenAccount: _onOpenAccount,
  onDeposit: _onDeposit,
  onWithdraw: _onWithdraw,

  apyPctOverride,
}) => {
  const { loading: userLoading, user } = useUser();
  const balanceCtx = useBalance();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  // Live APY
  const [apyPctLive, setApyPctLive] = useState<number | null>(null);
  const [apyLoading, setApyLoading] = useState(false);

  // ✅ Plus balance + readiness (THIS is what controls Open vs Deposit)
  const plusReady = Boolean(balanceCtx.plusReady);
  const plusAmount = getNumberField(balanceCtx, "savingsPlusAmount") ?? 0;
  const hasPlusFunds = plusReady && plusAmount > 0;

  // Display balance on the card (display currency value is already converted in provider)
  const plusUsdDisplay = getNumberField(balanceCtx, "savingsPlusUsd") ?? 0;

  const balanceLoading =
    Boolean(getNumberField(balanceCtx, "loading")) ||
    Boolean((balanceCtx as unknown as { loading?: boolean })?.loading);

  const effectiveLoading = loadingProp ?? (userLoading || balanceLoading);

  const accountPkToShow = account?.walletAddress
    ? account.walletAddress
    : user?.walletAddress && user.walletAddress !== "pending"
      ? user.walletAddress
      : "";

  const displayCurrency = (
    getStringField(balanceCtx, "displayCurrency") ??
    (isRecord(user) ? getStringField(user, "displayCurrency") : undefined) ??
    "USD"
  )
    .toUpperCase()
    .trim();

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
          JSON.stringify({ at: Date.now(), apyPct: pct }),
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

  const effectiveBalanceDisplay = useMemo(() => {
    if (Number.isFinite(plusUsdDisplay) && plusUsdDisplay > 0)
      return plusUsdDisplay;
    if (account && Number.isFinite(account.totalDeposited))
      return account.totalDeposited;
    return 0;
  }, [account, plusUsdDisplay]);

  // ✅ BUTTON LABEL: ONLY PLUS BALANCE CONTROLS THIS
  const depositCtaLabel = !plusReady
    ? "…"
    : hasPlusFunds
      ? "Deposit"
      : "Open Account";

  // ----------------------------
  // CLOSED/EMPTY STATE (no funds)
  // ----------------------------
  if (!hasPlusFunds) {
    return (
      <Drawer open={drawerOpen} onOpenChange={handleDrawerChange}>
        <Link href="/plus" className="block h-full">
          <div className="haven-card flex h-full w-full cursor-pointer flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="haven-kicker">Plus Savings</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Higher rate, built for long-term saving
                </p>
              </div>

              <span className="haven-pill">
                <span className="h-2 w-2 rounded-full bg-primary" />
                New
              </span>
            </div>

            <div className="mt-3">
              <p className="text-lg font-semibold text-foreground">
                Open Plus Savings Account
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Make a deposit to start earning automatically.
              </p>
            </div>

            <div className="mt-3">
              <DrawerTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openDrawer("deposit");
                  }}
                  className="haven-btn-primary w-full text-[#0b3204]"
                >
                  {depositCtaLabel}
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
            hasAccount={false}
          />
        )}
      </Drawer>
    );
  }

  // ----------------------------
  // OPEN STATE (has funds)
  // ----------------------------
  return (
    <Drawer open={drawerOpen} onOpenChange={handleDrawerChange}>
      <Link href="/plus" className="block h-full">
        <div className="haven-card flex h-full w-full cursor-pointer flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="haven-kicker">Plus Savings</p>
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

          <div className="mt-3">
            <p className="text-3xl text-foreground font-semibold tracking-tight">
              {effectiveLoading ? "…" : formatDisplay(effectiveBalanceDisplay)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Interest accrues daily, access anytime
            </p>
          </div>

          <div className="mt-3 flex gap-2">
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
          hasAccount={true}
        />
      )}

      {drawerMode === "withdraw" && (
        <WithdrawPlus
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setDrawerMode(null);
          }}
          availableBalance={effectiveBalanceDisplay}
        />
      )}
    </Drawer>
  );
};

export default PlusSavingsAccountCard;
