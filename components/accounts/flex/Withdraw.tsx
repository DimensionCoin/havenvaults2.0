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
  ArrowDownToLine,
} from "lucide-react";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import {
  useSavingsWithdraw,
  type WithdrawStatus,
} from "@/hooks/useSavingsWithdraw";

/* ───────── TYPES ───────── */

type WithdrawFlexProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableBalance: number; // Available to withdraw (in display currency)
};

type ModalKind = "processing" | "success" | "error";

type ModalState = {
  kind: ModalKind;
  signature?: string | null;
  errorMessage?: string;
  amountUi?: number;
  feeUi?: number;
  netUi?: number;
} | null;

/* ───────── STAGE CONFIG ───────── */

const STAGE_CONFIG: Record<
  WithdrawStatus,
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
    title: "Preparing withdrawal",
    subtitle: "Building transaction...",
    progress: 15,
    icon: "spinner",
  },
  signing: {
    title: "Approve in wallet",
    subtitle: "Please sign the transaction",
    progress: 35,
    icon: "wallet",
  },
  sending: {
    title: "Submitting",
    subtitle: "Broadcasting to Solana...",
    progress: 55,
    icon: "spinner",
  },
  confirming: {
    title: "Confirming",
    subtitle: "Waiting for network...",
    progress: 80,
    icon: "spinner",
  },
  done: {
    title: "Withdrawal complete!",
    subtitle: "Funds are now in your wallet",
    progress: 100,
    icon: "success",
  },
  error: {
    title: "Withdrawal failed",
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
        className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
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

export default function WithdrawFlex({
  open,
  onOpenChange,
  availableBalance,
}: WithdrawFlexProps) {
  const { user, refresh: refreshUser } = useUser();
  const balanceCtx = useBalance();
  const refreshBalance = balanceCtx?.refresh;

  // Get values from context
  const ctxLoading = !!balanceCtx?.loading;
  const displayCurrency = (
    balanceCtx?.displayCurrency ||
    user?.displayCurrency ||
    "USD"
  ).toUpperCase();

  // Use prop for available balance (savings balance passed from parent)
  const available = safeNum(availableBalance, 0);

  const {
    withdraw,
    reset: resetWithdraw,
    status: withdrawStatus,
    isBusy,
  } = useSavingsWithdraw();

  const [amountRaw, setAmountRaw] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
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
    if (amountNum > available) return false;
    return true;
  }, [ownerReady, ctxLoading, amountNum, available]);

  // Get current stage config
  const currentStage = modal?.kind === "processing" ? withdrawStatus : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  /* ───────── Effects ───────── */

  // Portal mount guard
  useEffect(() => setMounted(true), []);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setAmountRaw("");
      setWithdrawAll(false);
      setModal(null);
      tradeStartedRef.current = false;
      resetWithdraw();
    }
  }, [open, resetWithdraw]);

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

  const handleMax = useCallback(() => {
    setAmountRaw(money2(available));
    setWithdrawAll(true);
  }, [available]);

  const handleAmountChange = useCallback((value: string) => {
    setAmountRaw(clampMoneyInput(value));
    setWithdrawAll(false); // User manually changed amount
  }, []);

  const closeModal = useCallback(() => {
    if (!modal || modal.kind === "processing") return;
    setModal(null);
    tradeStartedRef.current = false;
    onOpenChange(false);
  }, [modal, onOpenChange]);

  const onWithdraw = useCallback(async () => {
    if (!canSubmit || isBusy || !user?.walletAddress) return;

    tradeStartedRef.current = true;
    setModal({ kind: "processing" });

    try {
      // Find existing marginfi account hint
      const flexAccount = user.savingsAccounts?.find(
        (a: { type: string }) => a.type === "flex"
      );
      const marginfiHint = flexAccount?.marginfiAccountPk || undefined;

      const result = await withdraw({
        amountDisplay: amountNum,
        owner58: user.walletAddress,
        withdrawAll,
        marginfiAccountHint: marginfiHint,
      });

      // Reset input
      setAmountRaw("");
      setWithdrawAll(false);

      // Refresh balances
      refreshBalance?.().catch((e) => {
        console.warn("[WithdrawFlex] Balance refresh failed:", e);
      });
      refreshUser?.().catch((e) => {
        console.warn("[WithdrawFlex] User refresh failed:", e);
      });

      setModal({
        kind: "success",
        signature: result.signature,
        amountUi: result.amountUi,
        feeUi: result.feeUi,
        netUi: result.netUi,
      });
    } catch (e) {
      const err = e as Error & { raw?: { userMessage?: string } };
      setModal({
        kind: "error",
        errorMessage:
          err?.message || err?.raw?.userMessage || "Withdrawal failed",
      });
    }
  }, [
    canSubmit,
    isBusy,
    user,
    amountNum,
    withdrawAll,
    withdraw,
    refreshBalance,
    refreshUser,
  ]);

  /* ───────── Render Guards ───────── */

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
                  <ArrowDownToLine className="h-4 w-4 text-amber-400" />
                  <div className="text-sm font-semibold text-white/90">
                    Withdraw
                  </div>
                </div>
                <div className="mt-1 text-xs text-white/45">
                  Move funds from savings to your wallet.
                </div>
              </div>
              <div className="text-right text-xs text-white/45">
                Available
                <div className="mt-0.5 text-white/85 font-semibold">
                  {ctxLoading ? "…" : formatMoney(available, displayCurrency)}
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
                  onChange={(e) => handleAmountChange(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={isBusy}
                  className="w-full bg-transparent text-sm text-white/90 outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={isBusy || ctxLoading}
                  onClick={handleMax}
                  className={[
                    "rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition",
                    withdrawAll
                      ? "border-amber-400/30 bg-amber-500/20 text-amber-200"
                      : "border-white/10 bg-white/5 text-white/70 hover:text-white/90",
                    isBusy || ctxLoading ? "opacity-60" : "",
                  ].join(" ")}
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
              {!ctxLoading && amountNum > available && amountNum > 0 && (
                <div className="mt-2 text-xs text-rose-200/80">
                  Amount exceeds available balance.
                </div>
              )}
            </div>

            {/* Summary */}
            {amountNum > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-white/45">You withdraw</div>
                  <div className="text-sm font-semibold text-white/85">
                    {formatMoney(amountNum, displayCurrency)}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-white/45">Destination</div>
                  <div className="text-sm font-semibold text-amber-300">
                    Your wallet
                  </div>
                </div>
              </div>
            )}

            {/* CTA */}
            <button
              disabled={!canSubmit || isBusy}
              onClick={onWithdraw}
              className={[
                "mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 border",
                canSubmit && !isBusy
                  ? "bg-amber-500/20 border-amber-300/30 text-amber-100 hover:bg-amber-500/25 active:scale-[0.98]"
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
                  Withdraw
                  <ArrowDownToLine className="h-4 w-4" />
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
                      Withdrawal complete!
                    </div>
                    <div className="mt-1 text-sm text-white/50">
                      Funds are now in your wallet
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <StageIcon icon="error" />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-rose-100">
                      Withdrawal failed
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

            {/* Success details */}
            {modal.kind === "success" && modal.netUi !== undefined && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/45">Amount received</span>
                  <span className="text-white/85 font-semibold">
                    {formatMoney(modal.netUi, "USD")}
                  </span>
                </div>
                {modal.feeUi !== undefined && modal.feeUi > 0 && (
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-white/45">Fee</span>
                    <span className="text-white/60">
                      {formatMoney(modal.feeUi, "USD")}
                    </span>
                  </div>
                )}
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
