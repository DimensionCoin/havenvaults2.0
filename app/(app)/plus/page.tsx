// app/(app)/savings/plus/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  PiggyBank,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

/* =========================
   Types returned by our NEW API
   (/api/savings/plus/activity)
========================= */

type ApiTx = {
  signature: string;
  timestamp: number | null;
  tokenTransfers?: TokenTransfer[];
  accountData?: AccountDataEntry[];
  type?: string | null;
  source?: string | null;
  fee?: number | null;
  involvedAccounts?: string[];
};

type TokenAmount = {
  uiAmount?: number | string | null;
  uiAmountString?: string | null;
};

type TokenTransfer = {
  mint?: string | null;
  tokenAddress?: string | null;
  mintAddress?: string | null;
  fromUserAccount?: string | null;
  from?: string | null;
  source?: string | null;
  toUserAccount?: string | null;
  to?: string | null;
  destination?: string | null;
  tokenAmount?: TokenAmount | null;
  rawTokenAmount?: TokenAmount | number | string | null;
  amount?: number | string | null;
};

type TokenBalanceChange = {
  mint?: string | null;
  userAccount?: string | null;
  owner?: string | null;
  rawTokenAmount?: TokenAmount | number | string | null;
  tokenAmount?: TokenAmount | number | string | null;
  amount?: number | string | null;
  changeType?: string | null;
};

type AccountDataEntry = {
  account?: string | null;
  tokenBalanceChanges?: TokenBalanceChange[];
};

type TxResponse = {
  ok?: boolean;
  vault?: string;
  txs?: ApiTx[];
  nextBefore?: string | null;
  exhausted?: boolean;
  error?: string;
  traceId?: string;
};

type ActivityTx = ApiTx & {
  _title: string;
  _subtitle: string;
  _direction: "in" | "out" | "neutral";
  _amountUsdc: number;
};

type FxPayload = {
  base?: string;
  target?: string;
  rate?: number;
};

const toFxRate = (p: FxPayload | null) => {
  const r = Number(p?.rate);
  return Number.isFinite(r) && r > 0 ? r : 1;
};

/* =========================
   UI helpers
========================= */

const USDC_MINT = (process.env.NEXT_PUBLIC_USDC_MINT || "")
  .trim()
  .toLowerCase();

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

/* =========================
   Client-side parsing
   (Deposit/Withdraw + Amount)
========================= */

/**
 * Helius tokenTransfers sometimes have:
 * - mint
 * - fromUserAccount / toUserAccount
 * - tokenAmount { uiAmount / uiAmountString }
 * - or amount / rawTokenAmount
 */
function readUiAmount(tt: TokenTransfer): number {
  const tokenAmount = tt?.tokenAmount ?? tt?.rawTokenAmount ?? tt?.amount;

  // tokenAmount object shape
  if (tokenAmount && typeof tokenAmount === "object") {
    const ui = tokenAmount.uiAmount ?? tokenAmount.uiAmountString;
    const n = Number(ui);
    return Number.isFinite(n) ? n : 0;
  }

  const n = Number(tokenAmount);
  return Number.isFinite(n) ? n : 0;
}

function norm(v: unknown) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * Fallback: accountData[].tokenBalanceChanges can contain:
 * - mint
 * - userAccount (sometimes)
 * - rawTokenAmount / tokenAmount
 * - changeType ("inc"/"dec") or amount can be +/- depending on shape
 *
 * We’ll compute USDC delta for the OWNER if possible.
 */
function readUsdcDeltaFromBalanceChanges(owner: string, tx: ApiTx) {
  const ownerLower = owner.trim().toLowerCase();
  const ads = Array.isArray(tx.accountData) ? tx.accountData : [];

  let inAmt = 0;
  let outAmt = 0;

  for (const ad of ads) {
    const tbc = Array.isArray(ad?.tokenBalanceChanges)
      ? ad.tokenBalanceChanges
      : [];

    for (const c of tbc) {
      const mint = norm(c?.mint);
      if (!mint || mint !== USDC_MINT) continue;

      // best effort: only count changes tied to the owner
      const userAccount = norm(c?.userAccount ?? c?.owner ?? "");
      if (userAccount && userAccount !== ownerLower) continue;

      const raw = c?.rawTokenAmount ?? c?.tokenAmount ?? c?.amount;
      let ui = 0;

      if (raw && typeof raw === "object") {
        const uiMaybe = raw.uiAmount ?? raw.uiAmountString;
        const n = Number(uiMaybe);
        ui = Number.isFinite(n) ? n : 0;
      } else {
        const n = Number(raw);
        ui = Number.isFinite(n) ? Math.abs(n) : 0;
      }

      if (!ui) continue;

      const changeType = String(c?.changeType || "").toLowerCase();
      if (changeType === "inc" || changeType === "increase") inAmt += ui;
      else if (changeType === "dec" || changeType === "decrease") outAmt += ui;
      else {
        // if unknown, assume neutral and skip
      }
    }
  }

  return { usdcIn: inAmt, usdcOut: outAmt };
}

/**
 * Primary parse from tokenTransfers:
 * - Deposit: owner sent USDC (out)
 * - Withdraw: owner received USDC (in)
 */
function parsePlusEvent(owner: string, tx: ApiTx) {
  const ownerLower = owner.trim().toLowerCase();

  let usdcOut = 0;
  let usdcIn = 0;

  const tts = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];

  for (const t of tts) {
    const mint = norm(t?.mint ?? t?.tokenAddress ?? t?.mintAddress);
    if (!mint || mint !== USDC_MINT) continue;

    const from = norm(t?.fromUserAccount ?? t?.from ?? t?.source);
    const to = norm(t?.toUserAccount ?? t?.to ?? t?.destination);

    const amt = readUiAmount(t);
    if (!amt) continue;

    if (from === ownerLower) usdcOut += amt;
    if (to === ownerLower) usdcIn += amt;
  }

  // fallback if tokenTransfers didn’t reveal it
  if (usdcIn === 0 && usdcOut === 0) {
    const fallback = readUsdcDeltaFromBalanceChanges(owner, tx);
    usdcIn = fallback.usdcIn;
    usdcOut = fallback.usdcOut;
  }

  // classify
  if (usdcOut > usdcIn && usdcOut > 0) {
    return {
      title: "Deposit",
      subtitle: "USDC moved into the Plus vault",
      direction: "out" as const,
      amountUsdc: usdcOut,
    };
  }

  if (usdcIn > usdcOut && usdcIn > 0) {
    return {
      title: "Withdraw",
      subtitle: "USDC returned from the Plus vault",
      direction: "in" as const,
      amountUsdc: usdcIn,
    };
  }

  return {
    title: "Plus activity",
    subtitle: "Vault transaction",
    direction: "neutral" as const,
    amountUsdc: 0,
  };
}

/* =========================
   Page
========================= */

export default function PlusSavingsAccountPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const [fx, setFx] = useState<FxPayload | null>(null);
  const fxRate = useMemo(() => toFxRate(fx), [fx]);

  const {
    loading: balanceLoading,
    savingsPlusUsd,
    savingsPlusAmount,
    plusReady,
    plusError,
    displayCurrency,
    refreshNow,
  } = useBalance();

  const walletAddress = user?.walletAddress || "";

  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txs, setTxs] = useState<ApiTx[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const fetchTxsPage = useCallback(
    async (reset = false) => {
      if (!walletAddress) return;

      try {
        setTxLoading(true);
        setTxError(null);

        const cursor =
          !reset && nextBefore
            ? `&before=${encodeURIComponent(nextBefore)}`
            : "";

        const url = `/api/savings/plus/activity?wallet=${encodeURIComponent(walletAddress)}&limit=25${cursor}`;
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        const data = (await res.json().catch(() => ({}))) as TxResponse;

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `Failed (${res.status})`);
        }

        const page = Array.isArray(data?.txs) ? data.txs : [];

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
          typeof data?.nextBefore === "string" && data.nextBefore.trim()
            ? data.nextBefore.trim()
            : null;

        setNextBefore(newCursor);

        if (
          data?.exhausted === true ||
          newCursor === null ||
          page.length === 0
        ) {
          setExhausted(true);
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "";
        setTxError(message || "Failed to load activity");
        if (reset) setTxs([]);
        setNextBefore(null);
        setExhausted(true);
      } finally {
        setTxLoading(false);
      }
    },
    [walletAddress, nextBefore],
  );

  useEffect(() => {
    if (!user) return;
    setTxs([]);
    setNextBefore(null);
    setExhausted(false);
    void fetchTxsPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ✅ parse + sort for rendering
  const activity = useMemo(() => {
    const owner = walletAddress;
    const mapped: ActivityTx[] = txs.map((tx) => {
      const parsed = parsePlusEvent(owner, tx);
      return {
        ...tx,
        _title: parsed.title,
        _subtitle: parsed.subtitle,
        _direction: parsed.direction,
        _amountUsdc: parsed.amountUsdc,
      };
    });

    mapped.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    return mapped;
  }, [txs, walletAddress]);

  useEffect(() => {
    let cancelled = false;

    async function loadFx() {
      try {
        const res = await fetch("/api/fx", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`FX (${res.status})`);
        const data = (await res.json()) as FxPayload;
        if (!cancelled) setFx(data);
      } catch {
        // If FX fails, we safely fall back to rate=1 (USD)
        if (!cancelled) setFx({ base: "USD", target: "USD", rate: 1 });
      }
    }

    loadFx();
    return () => {
      cancelled = true;
    };
  }, [displayCurrency]);

  const hasMore = !exhausted;

  // ✅ Better loading: wait for Plus to resolve so you don’t flash $0.00
  const balancePending = userLoading || balanceLoading || !plusReady;

  const balanceDisplay = useMemo(() => {
    const base = Number.isFinite(savingsPlusUsd) ? Number(savingsPlusUsd) : 0;
    return formatCurrency(base, displayCurrency || "USD");
  }, [savingsPlusUsd, displayCurrency]);

  const subBalanceLine = useMemo(() => {
    const amt = Number.isFinite(savingsPlusAmount)
      ? Number(savingsPlusAmount)
      : 0;
    if (!amt) return "Vault balance in USDC terms";
    return `${amt.toLocaleString(undefined, {
      maximumFractionDigits: 6,
    })} USDC in vault`;
  }, [savingsPlusAmount]);

  if (!user && !userLoading) {
    return (
      <div className="haven-app px-4 py-6">
        <div className="haven-card p-5">
          <p className="text-sm text-muted-foreground">Please sign in.</p>
        </div>
      </div>
    );
  }

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
            <p className="haven-kicker">Plus Savings</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Wallet {shortAddress(walletAddress)}
            </p>
          </div>
        </div>

        {/* Balance */}
        <div className="haven-card p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="haven-kicker">Balance</p>

              <p className="mt-2 text-4xl font-semibold tracking-tight text-foreground">
                {balancePending ? "…" : balanceDisplay}
              </p>

              <p className="mt-1 text-[11px] text-muted-foreground">
                {balancePending ? "Loading vault balance…" : subBalanceLine}
              </p>

              {plusError ? (
                <p className="mt-2 text-[11px] text-amber-300/90">
                  {plusError}
                </p>
              ) : null}
            </div>

            <span className="haven-pill">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Active
            </span>
          </div>

          {/* Actions (wire to your Deposit/Withdraw drawers later) */}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" className="haven-btn-primary text-[#0b3204]">
              Deposit
            </button>
            <button type="button" className="haven-btn-primary text-[#0b3204]">
              Withdraw
            </button>
          </div>
        </div>

        {/* Activity */}
        <div className="haven-card p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <p className="haven-kicker">Recent activity</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Only vault-related transactions (Helius filtered)
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                void refreshNow();
                setTxs([]);
                setNextBefore(null);
                setExhausted(false);
                void fetchTxsPage(true);
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
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Plus activity yet.
              </p>
            ) : (
              <div className="space-y-2">
                {activity.map((tx) => {
                  const title = tx._title;
                  const subtitle = tx._subtitle;
                  const direction = tx._direction;
                  const amountUsdc = Number(tx._amountUsdc || 0);

                  const icon =
                    direction === "in" ? (
                      <ArrowDownLeft className="h-4 w-4 text-foreground/80" />
                    ) : direction === "out" ? (
                      <ArrowUpRight className="h-4 w-4 text-foreground/80" />
                    ) : (
                      <PiggyBank className="h-4 w-4 text-foreground/80" />
                    );

                  const amountDisplay =
                    amountUsdc > 0 ? amountUsdc * fxRate : 0;

                  const amountText =
                    amountUsdc > 0
                      ? direction === "in"
                        ? `+${formatCurrency(amountDisplay, displayCurrency || "USD")}`
                        : direction === "out"
                          ? `-${formatCurrency(amountDisplay, displayCurrency || "USD")}`
                          : formatCurrency(
                              amountDisplay,
                              displayCurrency || "USD",
                            )
                      : "—";


                  return (
                    <div
                      key={tx.signature}
                      className="haven-row hover:bg-accent transition flex items-start gap-3"
                    >
                      <div className="pt-0.5 shrink-0">
                        <span className="h-7 w-7 rounded-full border border-white/10 bg-white/[0.06] inline-flex items-center justify-center">
                          {icon}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {title}
                        </p>

                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {subtitle}
                        </p>

                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatDayTime(tx.timestamp)}
                        </p>
                      </div>

                      <div className="text-right shrink-0 pl-2">
                        <p className="text-sm font-semibold text-foreground tabular-nums">
                          {amountText}
                        </p>

                        {tx.signature ? (
                          <a
                            href={`https://orbmarkets.io/tx/${encodeURIComponent(
                              tx.signature,
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center justify-end text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                          >
                            View
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {hasMore && activity.length > 0 && (
              <button
                type="button"
                onClick={() => fetchTxsPage(false)}
                disabled={txLoading}
                className="haven-btn-primary w-full mt-3 text-[#0b3204] disabled:opacity-60"
              >
                {txLoading ? "Loading…" : "Load more"}
              </button>
            )}

            {exhausted && activity.length > 0 && (
              <p className="mt-3 text-[11px] text-muted-foreground text-center">
                You&apos;ve reached the end of the available history.
              </p>
            )}
          </div>

          {/* helpful dev hint if USDC mint missing */}
          {!USDC_MINT ? (
            <p className="mt-3 text-[11px] text-amber-300/90">
              Missing NEXT_PUBLIC_USDC_MINT — amounts may not parse correctly.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
