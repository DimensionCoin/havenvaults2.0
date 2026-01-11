"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, PiggyBank } from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

import Deposit from "@/components/accounts/deposit/Deposit";
import Transfer from "@/components/accounts/deposit/Transfer";
import Withdraw from "@/components/accounts/deposit/Withdraw";

import {
  TOKENS,
  getCluster,
  WSOL_MINT,
  type Cluster,
  type TokenMeta,
} from "@/lib/tokenConfig";

/* =========================
   CONSTANTS
========================= */

// ✅ Flex savings vault address
const FLEX_SAVINGS_ADDR = "3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG";

// Fallback avatar when we don't have a Haven user profile photo.
const DEFAULT_AVATAR = "/logos/user.png";

// Optional deterministic avatar for non-users
const USE_DICEBEAR = true;
const dicebearAvatar = (addr: string) =>
  `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(addr)}`;

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

  // ✅ "buy" = spent USDC for token, "sell" = sold token for USDC
  // token→token swaps will be null
  swapDirection?: "buy" | "sell" | null;

  // USDC statement amount (will be 0 for token→token swaps)
  amountUsdc?: number | null;

  counterparty?: string | null;
  counterpartyLabel?: string | null;

  counterpartyAvatarUrl?: string | null;

  swapSoldMint?: string | null;
  swapSoldAmountUi?: number | null;
  swapBoughtMint?: string | null;
  swapBoughtAmountUi?: number | null;

  source?: string | null;
};

type FxPayload = { rate?: number };

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

function TokenPill({
  mint,
  amountUi,
  resolveMeta,
  label,
}: {
  mint?: string | null;
  amountUi?: number | null;
  resolveMeta: (
    m?: string | null
  ) => { symbol: string; logo: string; decimals: number; name: string } | null;
  label?: string;
}) {
  if (!mint || !amountUi || amountUi <= 0) return null;

  const meta = resolveMeta(mint);
  const symbol = meta?.symbol ?? "TOKEN";

  // avoid missing asset 404
  const logo = meta?.logo ?? "/logos/sol.png";
  const dec = Math.max(0, Math.min(8, meta?.decimals ?? 6));

  return (
    <span className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-white/[0.06] border border-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt={symbol} className="h-4 w-4 rounded-sm" />
      <span className="text-xs text-foreground/80">
        {label ? `${label} ` : ""}
        {amountUi.toFixed(Math.min(6, dec))}
      </span>
      <span className="text-xs text-foreground/60">{symbol}</span>
    </span>
  );
}

// Standard user avatar
function Avatar({ src, alt }: { src?: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const finalSrc = !src || broken ? DEFAULT_AVATAR : src;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={finalSrc}
      alt={alt}
      className="h-7 w-7 rounded-full border border-white/10 object-cover"
      onError={() => setBroken(true)}
    />
  );
}

// ✅ PiggyBank avatar for savings deposits/withdrawals
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

export default function DepositAccountPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { usdcUsd, loading: balanceLoading } = useBalance();

  const walletAddress = user?.walletAddress || "";

  const displayCurrency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  // FX rate for txs only (NOT balance)
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

  const [modalMode, setModalMode] = useState<DrawerMode>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);

  const cluster = useMemo(() => getCluster(), []);

  // Case-insensitive mint index
  const mintIndex = useMemo(() => {
    const map = new Map<string, TokenMeta>();
    const clusters: Cluster[] = ["mainnet", "devnet"];
    for (const t of TOKENS) {
      for (const c of clusters) {
        const m = t.mints[c];
        if (!m) continue;
        map.set(m.trim().toLowerCase(), t);
      }
    }
    return map;
  }, []);

  const resolveMeta = useCallback(
    (mint?: string | null) => {
      if (!mint) return null;
      const cleaned = mint.trim();
      if (!cleaned) return null;

      const normalized =
        cleaned.toLowerCase() === WSOL_MINT.toLowerCase() ? WSOL_MINT : cleaned;

      const meta = mintIndex.get(normalized.toLowerCase()) ?? null;
      if (!meta) return null;

      return {
        symbol: meta.symbol,
        logo: meta.logo,
        decimals: meta.decimals ?? 6,
        name: meta.name,
      };
    },
    [mintIndex]
  );

  const fetchTxs = useCallback(async () => {
    if (!walletAddress) return;

    try {
      setTxLoading(true);
      setTxError(null);

      const res = await fetch(`/api/user/wallet/transactions?limit=25`, {
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
    loadFx();
    fetchTxs();
  }, [user, loadFx, fetchTxs]);

  // swaps only
  const swaps = useMemo(() => {
    return txs.filter((t) => {
      if (t.kind !== "swap") return false;

      // ✅ token→token swap: no swapDirection, and both legs exist
      const tokenToToken =
        !t.swapDirection &&
        !!t.swapSoldMint &&
        !!t.swapBoughtMint &&
        (t.swapSoldAmountUi ?? 0) > 0 &&
        (t.swapBoughtAmountUi ?? 0) > 0;

      if (tokenToToken) return true;

      // ✅ USDC swaps (buy/sell)
      if (t.swapDirection === "buy") {
        return (
          !!t.swapBoughtMint &&
          (t.swapBoughtAmountUi ?? 0) > 0 &&
          (t.swapSoldAmountUi ?? 0) > 0
        );
      }

      if (t.swapDirection === "sell") {
        return (
          !!t.swapSoldMint &&
          (t.swapSoldAmountUi ?? 0) > 0 &&
          (t.swapBoughtAmountUi ?? 0) > 0
        );
      }

      return false;
    });
  }, [txs]);

  // transfers only
  const transfers = useMemo(() => {
    return txs.filter((t) => t.kind === "transfer" && (t.amountUsdc ?? 0) > 0);
  }, [txs]);

  // combined activity
  const activity = useMemo(() => {
    const rows = [...swaps, ...transfers];
    rows.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
    return rows.slice(0, 25);
  }, [swaps, transfers]);

  // Balance shown raw (NO FX)
  const balanceDisplay = useMemo(() => {
    const base = Number.isFinite(usdcUsd) ? Number(usdcUsd) : 0;
    return formatCurrency(base, displayCurrency);
  }, [usdcUsd, displayCurrency]);

  const loading = userLoading || balanceLoading;

  // classify transfer party (frontend-only)
  const resolveTransferParty = useCallback((tx: TxRow) => {
    const cp = normAddr(tx.counterparty);
    const isFlexSavings = cp === FLEX_SAVINGS_ADDR;

    const label = isFlexSavings
      ? "Flex Savings Account"
      : tx.counterpartyLabel || shortAddress(cp) || "—";

    const avatarUrl = isFlexSavings
      ? null
      : tx.counterpartyAvatarUrl ||
        (cp && USE_DICEBEAR ? dicebearAvatar(cp) : null) ||
        DEFAULT_AVATAR;

    return { label, avatarUrl, isFlexSavings };
  }, []);

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
            <p className="haven-kicker">Deposit Account</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Account #{shortAddress(walletAddress)}
            </p>
          </div>
        </div>

        {/* Balance card */}
        <div className="haven-card p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="haven-kicker">Available balance</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-foreground">
                {loading ? "…" : balanceDisplay}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Spendable balance in your deposit wallet
              </p>
            </div>

            <span className="haven-pill">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Active
            </span>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setModalMode("deposit")}
              className="haven-btn-primary flex-1 text-[#0b3204]"
            >
              Deposit
            </button>

            <button
              type="button"
              onClick={() => setTransferOpen(true)}
              className="haven-btn-primary flex-1 text-[#0b3204]"
            >
              Transfer
            </button>

            <button
              type="button"
              onClick={() => setModalMode("withdraw")}
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
              <p className="haven-kicker">Recent activity</p>
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
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent activity yet.
              </p>
            ) : (
              <div className="space-y-2">
                {activity.map((tx) => {
                  const isSwap = tx.kind === "swap";
                  const isBuy = tx.swapDirection === "buy";
                  const isSell = tx.swapDirection === "sell";

                  const isTokenToToken =
                    isSwap &&
                    !isBuy &&
                    !isSell &&
                    !!tx.swapSoldMint &&
                    !!tx.swapBoughtMint &&
                    (tx.swapSoldAmountUi ?? 0) > 0 &&
                    (tx.swapBoughtAmountUi ?? 0) > 0;

                  // Swap legs
                  const soldMint = tx.swapSoldMint;
                  const soldAmount = tx.swapSoldAmountUi;

                  const boughtMint = tx.swapBoughtMint;
                  const boughtAmount = tx.swapBoughtAmountUi;

                  // For USDC swaps, pick the “asset” mint for title/meta
                  const tokenMint = isBuy ? boughtMint : soldMint;
                  const tokenAmount = isBuy ? boughtAmount : soldAmount;

                  const tokenMeta = isSwap ? resolveMeta(tokenMint) : null;

                  // transfer fields
                  const party = !isSwap ? resolveTransferParty(tx) : null;

                  // FX conversion for transfers only
                  const localAbs = (tx.amountUsdc ?? 0) * rate;

                  const isSavings = !!party?.isFlexSavings;

                  // Titles
                  const soldMeta = isTokenToToken
                    ? resolveMeta(soldMint)
                    : null;
                  const boughtMeta = isTokenToToken
                    ? resolveMeta(boughtMint)
                    : null;

                  const title = isSwap
                    ? isTokenToToken
                      ? `Asset swap — ${soldMeta?.symbol ?? "TOKEN"} → ${
                          boughtMeta?.symbol ?? "TOKEN"
                        }`
                      : isSell
                        ? `Asset sale — ${tokenMeta?.symbol ?? "TOKEN"}`
                        : `Asset purchase — ${tokenMeta?.symbol ?? "TOKEN"}`
                    : isSavings
                      ? tx.direction === "out"
                        ? "Savings deposit"
                        : "Savings withdrawal"
                      : tx.direction === "in"
                        ? "Received Money"
                        : "Sent Money";

                  // Right side amount:
                  // - token→token swaps are neutral (no +/- fiat)
                  // - USDC swaps show +/- using amountUsdc (statement column)
                  // - transfers show +/- using amountUsdc
                  const rightTop = isSwap
                    ? isTokenToToken
                      ? "—"
                      : (() => {
                          const usdcDeltaAbs = Math.abs(tx.amountUsdc ?? 0);
                          const local = usdcDeltaAbs * rate;
                          if (!local) return "—";
                          return isSell
                            ? `+${formatCurrency(local, displayCurrency)}`
                            : `-${formatCurrency(local, displayCurrency)}`;
                        })()
                    : tx.direction === "in"
                      ? `+${formatCurrency(localAbs, displayCurrency)}`
                      : `-${formatCurrency(localAbs, displayCurrency)}`;

                  return (
                    <div
                      key={tx.signature}
                      className="haven-row hover:bg-accent transition"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {title}
                        </p>

                        {isSwap ? (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {isTokenToToken ? (
                              <>
                                <TokenPill
                                  mint={soldMint}
                                  amountUi={soldAmount}
                                  resolveMeta={resolveMeta}
                                  label="Sold"
                                />
                                <TokenPill
                                  mint={boughtMint}
                                  amountUi={boughtAmount}
                                  resolveMeta={resolveMeta}
                                  label="Bought"
                                />
                                <span className="text-xs text-muted-foreground">
                                  {soldMeta?.name ?? "Unknown token"} →{" "}
                                  {boughtMeta?.name ?? "Unknown token"}
                                </span>
                              </>
                            ) : (
                              <>
                                <TokenPill
                                  mint={tokenMint}
                                  amountUi={tokenAmount}
                                  resolveMeta={resolveMeta}
                                  label={isSell ? "Sold" : "Bought"}
                                />
                                <span className="text-xs text-muted-foreground">
                                  {tokenMeta?.name ?? "Unknown token"}
                                </span>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1 flex items-center gap-2">
                            {isSavings ? (
                              <SavingsAvatar />
                            ) : (
                              <Avatar
                                src={party?.avatarUrl}
                                alt={party?.label ?? "Counterparty"}
                              />
                            )}

                            <p className="text-xs text-muted-foreground">
                              {tx.direction === "in" ? "From" : "To"}{" "}
                              {party?.label ?? "—"}
                            </p>
                          </div>
                        )}

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

      {/* Modals */}
      <Deposit
        open={modalMode === "deposit"}
        onOpenChange={(open) => !open && setModalMode(null)}
        walletAddress={walletAddress}
        balanceUsd={usdcUsd}
        onSuccess={() => setModalMode(null)}
      />

      <Withdraw
        open={modalMode === "withdraw"}
        onOpenChange={(open) => !open && setModalMode(null)}
        walletAddress={walletAddress}
        balanceUsd={usdcUsd}
        onSuccess={() => setModalMode(null)}
      />

      <Transfer
        open={transferOpen}
        onOpenChange={setTransferOpen}
        walletAddress={walletAddress}
        balanceUsd={usdcUsd}
        onSuccess={() => setTransferOpen(false)}
      />
    </div>
  );
}
