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
import {
  useSavingsDeposit,
  type DepositStatus,
} from "@/hooks/useSavingsDeposit";

/* ───────── TYPES ───────── */

type DepositFlexProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasAccount: boolean;
};

type ModalKind = "processing" | "success" | "error";

type ModalState = {
  kind: ModalKind;
  signature?: string | null;
  errorMessage?: string;
  marginfiAccount?: string | null;
  recordError?: string | null;
} | null;

/* ───────── STAGE CONFIG ───────── */

const STAGE_CONFIG: Record<
  DepositStatus,
  {
    title: string;
    subtitle: string;
    progress: number;
    icon: "spinner" | "wallet" | "success" | "error";
  }
> = {
  idle: {
    title: "",
    subtitle: "",
    progress: 0,
    icon: "spinner",
  },
  building: {
    title: "Preparing deposit",
    subtitle: "Building transaction...",
    progress: 12,
    icon: "spinner",
  },
  signing: {
    title: "Approving transaction",
    subtitle: "apprving the transaction ",
    progress: 28,
    icon: "wallet",
  },
  sending: {
    title: "Submitting",
    subtitle: "Broadcasting to network...",
    progress: 50,
    icon: "spinner",
  },
  confirming: {
    title: "Confirming",
    subtitle: "Waiting for network...",
    progress: 70,
    icon: "spinner",
  },
  recording: {
    title: "Finalizing",
    subtitle: "Recording your deposit...",
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

function safeNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function explorerUrl(sig: string) {
  return `https://solscan.io/tx/${sig}`;
}

/* ───────── SUB COMPONENTS ───────── */

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

/* ───────── MAIN COMPONENT ───────── */

export default function DepositFlex({
  open,
  onOpenChange,
  hasAccount,
}: DepositFlexProps) {
  const { user, refresh: refreshUser } = useUser();
  const balanceCtx = useBalance();
  const refreshBalance = balanceCtx?.refresh;

  // Get values from context
  const ctxLoading = !!balanceCtx?.loading;
  const ctxUsdcDisplay = safeNum(balanceCtx?.usdcUsd, 0);
  const displayCurrency = (
    balanceCtx?.displayCurrency ||
    user?.displayCurrency ||
    "USD"
  ).toUpperCase();

  const {
    deposit,
    reset: resetDeposit,
    status: depositStatus,
    isBusy,
  } = useSavingsDeposit();

  const [amountRaw, setAmountRaw] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [mounted, setMounted] = useState(false);

  const tradeStartedRef = useRef(false);

  /* ───────── Derived Values ───────── */

  const amountNum = useMemo(() => {
    const n = parseFloat(amountRaw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountRaw]);

  const ownerReady = !!user?.walletAddress && user.walletAddress !== "pending";

  const canSubmit = useMemo(() => {
    if (!ownerReady || ctxLoading) return false;
    if (amountNum <= 0) return false;
    if (amountNum > ctxUsdcDisplay) return false;
    return true;
  }, [ownerReady, ctxLoading, amountNum, ctxUsdcDisplay]);

  // Get current stage config
  const currentStage = modal?.kind === "processing" ? depositStatus : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  /* ───────── Effects ───────── */

  // Portal mount guard
  useEffect(() => setMounted(true), []);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setAmountRaw("");
      setModal(null);
      tradeStartedRef.current = false;
      resetDeposit();
    }
  }, [open, resetDeposit]);

  // Lock background scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  /* ───────── Handlers ───────── */

  const closeModal = useCallback(() => {
    if (!modal || modal.kind === "processing") return;
    setModal(null);
    tradeStartedRef.current = false;
    onOpenChange(false);
  }, [modal, onOpenChange]);

  const onDeposit = useCallback(async () => {
    if (!canSubmit || isBusy || !user?.walletAddress) return;

    tradeStartedRef.current = true;
    setModal({ kind: "processing" });

    try {
      // Find existing marginfi account hint (convert null to undefined)
      const flexAccount = user.savingsAccounts?.find(
        (a: { type: string }) => a.type === "flex"
      );
      // Convert null/undefined to just undefined for type safety
      const marginfiHint = flexAccount?.marginfiAccountPk || undefined;

      const result = await deposit({
        amountDisplay: amountNum,
        owner58: user.walletAddress,
        marginfiAccountHint: marginfiHint,
      });

      // Reset input
      setAmountRaw("");

      // Refresh balances
      refreshBalance?.().catch((e) => {
        console.warn("[DepositFlex] Balance refresh failed:", e);
      });
      refreshUser?.().catch((e) => {
        console.warn("[DepositFlex] User refresh failed:", e);
      });

      setModal({
        kind: "success",
        signature: result.signature,
        marginfiAccount: result.marginfiAccount,
        recordError: result.recordError,
      });
    } catch (e) {
      const err = e as Error & { raw?: { userMessage?: string } };
      setModal({
        kind: "error",
        errorMessage: err?.message || err?.raw?.userMessage || "Deposit failed",
      });
    }
  }, [
    canSubmit,
    isBusy,
    user,
    amountNum,
    deposit,
    refreshBalance,
    refreshUser,
  ]);

  /* ───────── Render Guards ───────── */

  if (!open || !mounted) return null;

  const title = hasAccount ? "Deposit" : "Open Account";
  const subtitle = hasAccount
    ? "Add funds to your savings account."
    : "Open a new savings account and start earning.";

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
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ───────── INPUT VIEW ───────── */}
        {!modal && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <PiggyBank className="h-4 w-4 text-emerald-400" />
                  <div className="text-sm font-semibold text-white/90">
                    {title}
                  </div>
                </div>
                <div className="mt-1 text-xs text-white/45">{subtitle}</div>
              </div>
              <div className="text-right text-xs text-white/45">
                Available
                <div className="mt-0.5 text-white/85 font-semibold">
                  {ctxLoading
                    ? "…"
                    : formatMoney(ctxUsdcDisplay, displayCurrency)}
                </div>
              </div>
            </div>

            {/* Amount Input */}
            <div className="mt-4">
              <label className="text-xs text-white/50">Amount</label>
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
                <span className="text-xs text-white/50 px-2">
                  {displayCurrency}
                </span>
                <input
                  value={amountRaw}
                  onChange={(e) =>
                    setAmountRaw(clampMoneyInput(e.target.value))
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={isBusy}
                  className="w-full bg-transparent text-sm text-white/90 outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={isBusy || ctxLoading}
                  onClick={() => setAmountRaw(money2(ctxUsdcDisplay))}
                  className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white/90 disabled:opacity-60"
                >
                  Max
                </button>
              </div>

              {/* Validation Messages */}
              {!ownerReady && (
                <div className="mt-2 text-xs text-rose-200/80">
                  Wallet not connected.
                </div>
              )}
              {!ctxLoading && amountNum > ctxUsdcDisplay && amountNum > 0 && (
                <div className="mt-2 text-xs text-rose-200/80">
                  Amount exceeds available balance.
                </div>
              )}
            </div>

            {/* Summary */}
            {amountNum > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-white/45">You deposit</div>
                  <div className="text-sm font-semibold text-white/85">
                    {formatMoney(amountNum, displayCurrency)}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-white/45">
                    Earning interest
                  </div>
                  <div className="text-sm font-semibold text-emerald-300">
                    Immediately
                  </div>
                </div>
              </div>
            )}

            {/* CTA */}
            <button
              disabled={!canSubmit || isBusy}
              onClick={onDeposit}
              className={[
                "mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 border",
                canSubmit && !isBusy
                  ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25 active:scale-[0.98]"
                  : "bg-white/5 border-white/10 text-white/35 cursor-not-allowed",
              ].join(" ")}
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {hasAccount ? "Deposit" : "Open & Deposit"}
                  <PiggyBank className="h-4 w-4" />
                </>
              )}
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/60 hover:text-white/80 hover:bg-white/10 transition disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}

        {/* ───────── PROCESSING / SUCCESS / ERROR VIEW ───────── */}
        {modal && (
          <>
            {/* Close button (not during processing) */}
            {modal.kind !== "processing" && (
              <div className="flex justify-end mb-2">
                <button
                  onClick={closeModal}
                  className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/50 hover:text-white/90 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Content */}
            <div className="flex flex-col items-center text-center pt-2">
              {modal.kind === "processing" && stageConfig ? (
                <>
                  <StageIcon icon={stageConfig.icon} />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-white/90">
                      {stageConfig.title}
                    </div>
                    <div className="mt-1 text-sm text-white/50">
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
                    <div className="text-base font-semibold text-emerald-100">
                      {hasAccount ? "Deposit complete!" : "Account opened!"}
                    </div>
                    <div className="mt-1 text-sm text-white/50">
                      Your funds are now earning interest
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <StageIcon icon="error" />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-rose-100">
                      {hasAccount ? "Deposit failed" : "Failed to open account"}
                    </div>
                    <div className="mt-1 text-sm text-white/50">
                      Something went wrong
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Error message */}
            {modal.kind === "error" && modal.errorMessage && (
              <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3">
                <div className="text-xs text-rose-200/80 text-center">
                  {modal.errorMessage}
                </div>
              </div>
            )}

            {/* Record warning (funds moved but record failed) */}
            {modal.kind === "success" && modal.recordError && (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
                <div className="text-xs text-amber-200/80 text-center">
                  Deposit succeeded but we couldn&apos;t link your account. Your
                  funds are safe.
                </div>
              </div>
            )}

            {/* Transaction link */}
            {modal.kind === "success" && modal.signature && (
              <div className="mt-5">
                <a
                  href={explorerUrl(modal.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 hover:text-white hover:bg-white/10 transition group"
                >
                  <span>View transaction</span>
                  <ExternalLink className="h-4 w-4 opacity-50 group-hover:opacity-100" />
                </a>
              </div>
            )}

            {/* Action button */}
            {modal.kind !== "processing" && (
              <button
                onClick={closeModal}
                className={[
                  "mt-5 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition border",
                  modal.kind === "success"
                    ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25"
                    : "bg-white/10 border-white/10 text-white/80 hover:bg-white/15",
                ].join(" ")}
              >
                {modal.kind === "success" ? "Done" : "Close"}
              </button>
            )}

            {/* Processing footer */}
            {modal.kind === "processing" && (
              <div className="mt-6 text-center text-xs text-white/30">
                Please keep window open
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
