"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Wallet,
  ExternalLink,
  PiggyBank,
} from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import { usePlusDeposit, type PlusDepositStatus } from "@/hooks/usePlusDeposit";

/* ───────── TYPES ───────── */

type DepositPlusProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasAccount: boolean; // ignored
};

type ModalState =
  | { kind: "processing" }
  | { kind: "success"; signature: string }
  | {
      kind: "error";
      errorMessage: string;
      code?: string;
      stage?: string;
      traceId?: string;
      logs?: string[];
    }
  | null;

/* ───────── STAGE CONFIG ───────── */

const STAGE_CONFIG: Record<
  PlusDepositStatus,
  {
    title: string;
    subtitle: string;
    progress: number;
    icon: "spinner" | "wallet" | "success" | "error";
  }
> = {
  idle: { title: "", subtitle: "", progress: 0, icon: "spinner" },
  building: {
    title: "Preparing deposit",
    subtitle: "Building swap + vault deposit…",
    progress: 22,
    icon: "spinner",
  },
  signing: {
    title: "Approving transaction",
    subtitle: "Approve the transaction in your wallet…",
    progress: 46,
    icon: "wallet",
  },
  sending: {
    title: "Submitting",
    subtitle: "Broadcasting to Solana…",
    progress: 70,
    icon: "spinner",
  },
  confirming: {
    title: "Confirming",
    subtitle: "Waiting for network confirmation…",
    progress: 88,
    icon: "spinner",
  },
  done: {
    title: "Deposit complete!",
    subtitle: "Your funds are now earning interest",
    progress: 100,
    icon: "success",
  },
  error: {
    title: "Deposit failed",
    subtitle: "Something went wrong",
    progress: 0,
    icon: "error",
  },
};

/* ───────── HELPERS ───────── */

function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function clampMoneyInput(raw: string) {
  const cleaned = (raw ?? "").replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
}

function money2(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function safeNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function explorerUrl(sig: string) {
  return `https://orbmarkets.io/tx/${sig}`;
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

function StageIcon({
  icon,
}: {
  icon: "spinner" | "wallet" | "success" | "error";
}) {
  const base = "flex h-14 w-14 items-center justify-center rounded-2xl border";

  if (icon === "success") {
    return (
      <div className={`${base} border-emerald-400/30 bg-emerald-500/20`}>
        <CheckCircle2 className="h-7 w-7 text-emerald-400" />
      </div>
    );
  }

  if (icon === "error") {
    return (
      <div className={`${base} border-rose-400/30 bg-rose-500/20`}>
        <XCircle className="h-7 w-7 text-rose-400" />
      </div>
    );
  }

  if (icon === "wallet") {
    return (
      <div
        className={`${base} border-amber-400/30 bg-amber-500/20 animate-pulse`}
      >
        <Wallet className="h-7 w-7 text-amber-400" />
      </div>
    );
  }

  return (
    <div className={`${base} border-white/10 bg-white/5`}>
      <Loader2 className="h-7 w-7 text-white/60 animate-spin" />
    </div>
  );
}

/* ───────── MAIN ───────── */

export default function DepositPlus({
  open,
  onOpenChange,
  hasAccount: _hasAccountProp,
}: DepositPlusProps) {
  const { user, refresh: refreshUser } = useUser();
  const balance = useBalance();
  const refreshBalance = balance.refresh;

  const {
    deposit,
    reset: resetDeposit,
    status: depositStatus,
    error: depositError,
    isBusy,
  } = usePlusDeposit();

  const [amountRaw, setAmountRaw] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [mounted, setMounted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const ownerReady = !!user?.walletAddress && user.walletAddress !== "pending";
  const tradeStartedRef = useRef(false);

  // ====== NEW: force-refresh on open, and gate label until that refresh settles ======
  const openSeqRef = useRef(0);
  const [awaitingFreshPlus, setAwaitingFreshPlus] = useState(false);

  useEffect(() => {
    if (!open) return;

    openSeqRef.current += 1;
    const seq = openSeqRef.current;

    setAwaitingFreshPlus(true);

    // refreshNow() exists on provider; if not, fallback to refresh()
    const refreshFn =
      (balance as unknown as { refreshNow?: () => Promise<void> }).refreshNow ??
      balance.refresh;

    Promise.resolve()
      .then(() => refreshFn?.())
      .catch(() => {})
      .finally(() => {
        // only clear if this is still the latest "open"
        if (openSeqRef.current === seq) setAwaitingFreshPlus(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const plusReady = Boolean(balance.plusReady);
  const plusAmount = safeNum(balance.savingsPlusAmount, 0);

  // labelReady = "we opened + we ran a refresh + plus endpoint resolved"
  const labelReady = !awaitingFreshPlus && plusReady;

  // (optional) treat dust as zero
  const hasPlusFunds = labelReady && plusAmount > 0.000001;

  const label = !labelReady ? "…" : hasPlusFunds ? "Deposit" : "Open Account";
  // ================================================================================

  const displayCurrency = (balance.displayCurrency || "USD")
    .toUpperCase()
    .trim();

  const fxRate = safeNum(balance.fxRate, 1);
  const isUsd = displayCurrency === "USD";

  const usdcBalanceDisplay = safeNum(balance.usdcUsd, 0);

  // ✅ DEBUG: logs on every relevant change while open
  useEffect(() => {
    if (!open) return;
    console.log("[DepositPlus][DEBUG]", {
      open,
      awaitingFreshPlus,
      plusReady: balance.plusReady,
      plusError: balance.plusError,
      savingsPlusAmount_raw: balance.savingsPlusAmount,
      plusAmount_parsed: plusAmount,
      labelReady,
      hasPlusFunds,
      computedLabel: label,
      balance_loading: balance.loading,
      lastUpdated: balance.lastUpdated,
      owner: user?.walletAddress,
    });
  }, [
    open,
    awaitingFreshPlus,
    balance.plusReady,
    balance.plusError,
    balance.savingsPlusAmount,
    plusAmount,
    labelReady,
    hasPlusFunds,
    label,
    balance.loading,
    balance.lastUpdated,
    user?.walletAddress,
  ]);

  const amountDisplay = useMemo(() => {
    const n = parseFloat(amountRaw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountRaw]);

  const amountUsd = useMemo(() => {
    if (amountDisplay <= 0) return 0;
    if (isUsd) return amountDisplay;
    return fxRate > 0 ? amountDisplay / fxRate : 0;
  }, [amountDisplay, isUsd, fxRate]);

  const canSubmit = useMemo(() => {
    if (!ownerReady) return false;
    if (!labelReady) return false;
    if (amountDisplay <= 0) return false;
    if (amountDisplay > usdcBalanceDisplay) return false;
    if (amountUsd <= 0) return false;
    return true;
  }, [ownerReady, labelReady, amountDisplay, usdcBalanceDisplay, amountUsd]);

  const currentStage = modal?.kind === "processing" ? depositStatus : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setAmountRaw("");
      setModal(null);
      setShowDetails(false);
      tradeStartedRef.current = false;
      resetDeposit();
    }
  }, [open, resetDeposit]);

  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!modal || modal.kind !== "processing") return;
    if (!depositError) return;

    setModal({
      kind: "error",
      errorMessage: depositError.message || "Deposit failed",
      code: depositError.code,
      stage: depositError.stage,
      traceId: depositError.traceId,
      logs: depositError.logs,
    });
  }, [open, modal, depositError]);

  const closeModal = useCallback(() => {
    if (!modal || modal.kind === "processing") return;
    setModal(null);
    setShowDetails(false);
    tradeStartedRef.current = false;
    onOpenChange(false);
  }, [modal, onOpenChange]);

  const onDeposit = useCallback(async () => {
    if (!canSubmit || isBusy || !user?.walletAddress) return;

    tradeStartedRef.current = true;
    setModal({ kind: "processing" });
    setShowDetails(false);

    try {
      const result = await deposit({
        amountDisplay: amountUsd,
        owner58: user.walletAddress,
        slippageBps: 50,
      });

      setAmountRaw("");

      refreshBalance?.().catch(() => {});
      refreshUser?.().catch(() => {});

      setModal({ kind: "success", signature: result.signature });
    } catch (e: unknown) {
      const fallbackMsg =
        e instanceof Error && e.message ? e.message : "Deposit failed";
      const msg = depositError?.message || fallbackMsg;

      setModal({
        kind: "error",
        errorMessage: msg,
        code: depositError?.code,
        stage: depositError?.stage,
        traceId: depositError?.traceId,
        logs: depositError?.logs,
      });
    }
  }, [
    canSubmit,
    isBusy,
    user?.walletAddress,
    deposit,
    amountUsd,
    refreshBalance,
    refreshUser,
    depositError,
  ]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && modal?.kind !== "processing") {
          onOpenChange(false);
        }
      }}
    >
      <div
        className="w-full max-w-sm haven-card p-5 shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {!modal && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <PiggyBank className="h-4 w-4 text-primary" />
                  <div className="text-sm font-semibold text-foreground/90">
                    {label}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {!labelReady
                    ? "Loading your Plus account…"
                    : hasPlusFunds
                      ? "Add funds to your Plus Savings balance."
                      : "Open your Plus Savings account and start earning."}
                </div>
              </div>

              <div className="text-right text-xs text-muted-foreground">
                Available
                <div className="mt-0.5 font-semibold text-foreground/90">
                  {!labelReady
                    ? "…"
                    : formatMoney(usdcBalanceDisplay, displayCurrency)}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs text-muted-foreground">Amount</label>

              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-border bg-background/50 p-2">
                <span className="text-xs text-muted-foreground px-2">
                  {displayCurrency}
                </span>

                <input
                  value={amountRaw}
                  onChange={(e) =>
                    setAmountRaw(clampMoneyInput(e.target.value))
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={isBusy || !labelReady}
                  className="w-full bg-transparent text-sm text-foreground/90 outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
                />

                <button
                  type="button"
                  disabled={isBusy || !labelReady}
                  onClick={() => setAmountRaw(money2(usdcBalanceDisplay))}
                  className="haven-pill hover:bg-accent disabled:opacity-60"
                >
                  Max
                </button>
              </div>
            </div>

            <button
              disabled={!canSubmit || isBusy}
              onClick={onDeposit}
              className={[
                "mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 border",
                canSubmit && !isBusy
                  ? "haven-btn-primary active:scale-[0.98] text-[#0b3204]"
                  : "border-border bg-background/40 text-muted-foreground cursor-not-allowed",
              ].join(" ")}
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {label}
                  <PiggyBank className="h-4 w-4" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
              className="mt-3 w-full rounded-2xl border border-border bg-background/50 px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-accent transition disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}

        {modal && (
          <>
            {modal.kind !== "processing" && (
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="haven-pill hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="flex flex-col items-center text-center pt-2">
              {modal.kind === "processing" && stageConfig ? (
                <>
                  <StageIcon icon={stageConfig.icon} />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-foreground/90">
                      {stageConfig.title}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {stageConfig.subtitle}
                    </div>
                  </div>
                  <div className="mt-5 w-full max-w-[200px]">
                    <ProgressBar progress={stageConfig.progress} />
                  </div>
                </>
              ) : modal.kind === "success" ? (
                <>
                  <StageIcon icon="success" />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-primary">
                      Deposit complete!
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Your funds are now earning interest
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <StageIcon icon="error" />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-destructive">
                      Deposit failed
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Something went wrong
                    </div>
                  </div>
                </>
              )}
            </div>

            {modal.kind === "success" && (
              <div className="mt-5">
                <a
                  href={explorerUrl(modal.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-2xl border border-border bg-background/50 px-4 py-3 text-sm text-foreground/90 hover:bg-accent transition group"
                >
                  <span>View transaction</span>
                  <ExternalLink className="h-4 w-4 opacity-50 group-hover:opacity-100" />
                </a>
              </div>
            )}

            {modal.kind !== "processing" && (
              <button
                type="button"
                onClick={closeModal}
                className={[
                  "mt-5 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border",
                  modal.kind === "success"
                    ? "haven-btn-primary text-[#0b3204]"
                    : "border-border bg-background/60 text-foreground/90 hover:bg-accent",
                ].join(" ")}
              >
                {modal.kind === "success" ? "Done" : "Close"}
              </button>
            )}

            {modal.kind === "processing" && (
              <div className="mt-6 text-center text-xs text-muted-foreground">
                Please keep this window open
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
