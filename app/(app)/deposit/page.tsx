"use client";

import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  PiggyBank,
  User,
  TrendingUp,
} from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";

import Deposit from "@/components/accounts/deposit/Deposit";
import Transfer from "@/components/accounts/deposit/Transfer";
import Withdraw from "@/components/accounts/deposit/Withdraw";

import {
  TOKENS,
  WSOL_MINT,
  type Cluster,
  type TokenMeta,
} from "@/lib/tokenConfig";

/* =========================
   CONSTANTS
========================= */

const FLEX_SAVINGS_ADDR = "3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG";
const DEFAULT_AVATAR = "/logos/user.png";

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

  kind?: "transfer" | "swap" | "perp";
  direction?: "in" | "out" | "neutral";

  swapDirection?: "buy" | "sell" | null;
  amountUsdc?: number | null;

  // wallet (owner) for transfers; null for swaps/perps
  counterparty?: string | null;

  // ✅ owner wallet (same as counterparty for transfers in new API)
  counterpartyOwner?: string | null;

  // ✅ API now returns mapped values when available
  counterpartyLabel?: string | null;
  counterpartyAvatarUrl?: string | null;

  swapSoldMint?: string | null;
  swapSoldAmountUi?: number | null;
  swapBoughtMint?: string | null;
  swapBoughtAmountUi?: number | null;

  source?: string | null;
};

type FxPayload = { rate?: number };

type TxResponse = {
  ok?: boolean;
  txs?: TxRow[];
  nextBefore?: string | null;
  exhausted?: boolean;
  error?: string;
};

/* =========================
   HELPERS
========================= */

const normAddr = (a?: string | null) => (a || "").trim();
const normLower = (a?: string | null) => normAddr(a).toLowerCase();

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

const safeName = (meta?: { name: string } | null, fallback: string = "Asset") =>
  meta?.name?.trim() || fallback;

const fmtTokenAmt = (n?: number | null, decimals = 6) => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "";
  const max = Math.min(6, Math.max(2, decimals));
  return v.toFixed(max);
};

const toMultiplierLabel = (s?: string | null) => {
  if (!s) return s;
  return s.replace(/jupiter\s*perp(etuals)?/gi, "Multiplier");
};

function AssetIcon({ logo, alt }: { logo?: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const src = !logo || broken ? "/logos/sol.png" : logo;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-7 w-7 rounded-full border border-white/10 object-cover bg-white/[0.06]"
      onError={() => setBroken(true)}
    />
  );
}

function UserIconAvatar() {
  return (
    <span className="h-7 w-7 rounded-full border border-white/10 bg-white/[0.06] inline-flex items-center justify-center">
      <User className="h-4 w-4 text-foreground/80" />
    </span>
  );
}

function SavingsAvatar() {
  return (
    <span className="h-7 w-7 rounded-full border border-white/10 bg-white/[0.06] inline-flex items-center justify-center">
      <PiggyBank className="h-4 w-4 text-foreground/80" />
    </span>
  );
}

function PerpAvatar() {
  return (
    <span className="h-7 w-7 rounded-full border border-white/10 bg-white/[0.06] inline-flex items-center justify-center">
      <TrendingUp className="h-4 w-4 text-foreground/80" />
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

  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  // ✅ Frontend no longer needs extra resolve-wallets calls,
  // because the API now returns counterpartyLabel + counterpartyAvatarUrl.
  // Keeping these refs/state removed to avoid conflicting labels.

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

        const url = `/api/user/wallet/transactions?limit=25${cursor}`;

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
    [walletAddress, nextBefore]
  );

  useEffect(() => {
    if (!user) return;
    loadFx();
    setTxs([]);
    setNextBefore(null);
    setExhausted(false);
    fetchTxsPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadFx]);

  const swaps = useMemo(() => {
    return txs.filter((t) => {
      if (t.kind !== "swap") return false;

      const tokenToToken =
        !t.swapDirection &&
        !!t.swapSoldMint &&
        !!t.swapBoughtMint &&
        (t.swapSoldAmountUi ?? 0) > 0 &&
        (t.swapBoughtAmountUi ?? 0) > 0;

      if (tokenToToken) return true;

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

  const transfers = useMemo(() => {
    return txs.filter((t) => t.kind === "transfer" && (t.amountUsdc ?? 0) > 0);
  }, [txs]);

  const perps = useMemo(() => {
    return txs.filter((t) => t.kind === "perp" && (t.amountUsdc ?? 0) > 0);
  }, [txs]);

  const activity = useMemo(() => {
    const rows = [...swaps, ...transfers, ...perps];
    rows.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
    return rows;
  }, [swaps, transfers, perps]);

  const hasMore = !exhausted;

  const balanceDisplay = useMemo(() => {
    const base = Number.isFinite(usdcUsd) ? Number(usdcUsd) : 0;
    return formatCurrency(base, displayCurrency);
  }, [usdcUsd, displayCurrency]);

  const loading = userLoading || balanceLoading;

  const resolveTransferParty = useCallback((tx: TxRow) => {
    const cpRaw = normAddr(tx.counterparty);
    const ownerRaw = normAddr(tx.counterpartyOwner);

    const isFlexSavings =
      cpRaw === FLEX_SAVINGS_ADDR || ownerRaw === FLEX_SAVINGS_ADDR;

    if (isFlexSavings) {
      return {
        label: "Flex Savings Account",
        avatarUrl: null,
        isFlexSavings: true,
      };
    }

    // ✅ Prefer mapped label/avatar from API; fallback to short address
    const label =
      (tx.counterpartyLabel && tx.counterpartyLabel.trim()) ||
      shortAddress(ownerRaw || cpRaw) ||
      "—";

    const avatarUrl =
      (tx.counterpartyAvatarUrl && tx.counterpartyAvatarUrl.trim()) ||
      ((ownerRaw || cpRaw) && USE_DICEBEAR
        ? dicebearAvatar(ownerRaw || cpRaw)
        : null) ||
      DEFAULT_AVATAR;

    return { label, avatarUrl, isFlexSavings: false };
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
              onClick={() => {
                setTxs([]);
                setNextBefore(null);
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
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent activity yet.
              </p>
            ) : (
              <div className="space-y-2">
                {activity.map((tx) => {
                  const isSwap = tx.kind === "swap";
                  const isPerp = tx.kind === "perp";
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

                  const soldMint = tx.swapSoldMint;
                  const soldAmount = tx.swapSoldAmountUi;

                  const boughtMint = tx.swapBoughtMint;
                  const boughtAmount = tx.swapBoughtAmountUi;

                  const tokenMint = isBuy ? boughtMint : soldMint;
                  const tokenAmount = isBuy ? boughtAmount : soldAmount;

                  const tokenMeta = isSwap ? resolveMeta(tokenMint) : null;

                  const party =
                    !isSwap && !isPerp ? resolveTransferParty(tx) : null;
                  const isSavings = !!party?.isFlexSavings;

                  const soldMeta = isTokenToToken
                    ? resolveMeta(soldMint)
                    : null;
                  const boughtMeta = isTokenToToken
                    ? resolveMeta(boughtMint)
                    : null;

                  const tokenName = safeName(tokenMeta, "Asset");
                  const soldName = safeName(soldMeta, "Asset");
                  const boughtName = safeName(boughtMeta, "Asset");

                  const localAbs = (tx.amountUsdc ?? 0) * rate;

                  const title = isPerp
                    ? toMultiplierLabel(tx.counterpartyLabel) || "Multiplier"
                    : isSwap
                      ? isTokenToToken
                        ? `Swap ${soldName} → ${boughtName}`
                        : isSell
                          ? `Sold ${tokenName}`
                          : `Bought ${tokenName}`
                      : isSavings
                        ? tx.direction === "out"
                          ? "Savings deposit"
                          : "Savings withdrawal"
                        : tx.direction === "in"
                          ? "Received money"
                          : "Sent money";

                  const rightTop = isPerp
                    ? tx.direction === "in"
                      ? `+${formatCurrency(localAbs, displayCurrency)}`
                      : `-${formatCurrency(localAbs, displayCurrency)}`
                    : isSwap
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

                  const detailLine = isPerp
                    ? "Multiplier"
                    : isSwap
                      ? isTokenToToken
                        ? `${soldName} → ${boughtName}`
                        : ""
                      : `${tx.direction === "in" ? "From" : "To"} ${
                          party?.label ?? "—"
                        }`;

                  const tokenToTokenAmounts =
                    isTokenToToken &&
                    soldAmount &&
                    boughtAmount &&
                    (soldAmount ?? 0) > 0 &&
                    (boughtAmount ?? 0) > 0
                      ? `${fmtTokenAmt(
                          soldAmount,
                          soldMeta?.decimals ?? 6
                        )} ${soldName} → ${fmtTokenAmt(
                          boughtAmount,
                          boughtMeta?.decimals ?? 6
                        )} ${boughtName}`
                      : "";

                  const usdcSwapTokenAmount =
                    isSwap && !isTokenToToken && tokenAmount
                      ? `${fmtTokenAmt(
                          tokenAmount,
                          tokenMeta?.decimals ?? 6
                        )} ${tokenName}`
                      : "";

                  const leftIcon = (() => {
                    if (isPerp) return <PerpAvatar />;
                    if (isSavings) return <SavingsAvatar />;

                    if (isSwap) {
                      const logo =
                        (isTokenToToken ? soldMeta?.logo : tokenMeta?.logo) ??
                        "/logos/sol.png";
                      const alt = isTokenToToken ? soldName : tokenName;
                      return <AssetIcon logo={logo} alt={alt} />;
                    }

                    // ✅ Transfers: if API returned an avatar, show it; otherwise fallback icon
                    if (party?.avatarUrl) {
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={party.avatarUrl}
                          alt={party.label || "User"}
                          className="h-7 w-7 rounded-full border border-white/10 object-cover bg-white/[0.06]"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src =
                              DEFAULT_AVATAR;
                          }}
                        />
                      );
                    }

                    return <UserIconAvatar />;
                  })();

                  return (
                    <div
                      key={tx.signature}
                      className="haven-row hover:bg-accent transition flex items-start gap-3"
                    >
                      <div className="pt-0.5 shrink-0">{leftIcon}</div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {title}
                        </p>

                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {detailLine}
                        </p>

                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatDayTime(tx.blockTime)}
                        </p>

                        {tokenToTokenAmounts ? (
                          <p className="mt-1 text-xs text-foreground/80 truncate">
                            {tokenToTokenAmounts}
                          </p>
                        ) : usdcSwapTokenAmount ? (
                          <p className="mt-1 text-xs text-foreground/80 truncate">
                            {usdcSwapTokenAmount}
                          </p>
                        ) : null}
                      </div>

                      <div className="text-right shrink-0 pl-2">
                        <p className="text-sm font-semibold text-foreground tabular-nums">
                          {rightTop}
                        </p>

                        {tx.signature ? (
                          <a
                            href={`https://orbmarkets.io/tx/${encodeURIComponent(
                              tx.signature
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
