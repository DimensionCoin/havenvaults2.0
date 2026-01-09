// components/amplify/PositionsPanel.tsx
"use client";

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import Image from "next/image";
import {
  Loader2,
  X,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Wallet,
} from "lucide-react";

import { formatMoney, safeNum, safeStr, safeDateLabel } from "./utils";
import type { BoosterRow } from "@/hooks/useBoosterPositions";
import { findTokenBySymbol } from "@/lib/tokenConfig";
import {
  useServerSponsoredBoosterClose,
  type CloseStatus,
} from "@/hooks/useServerSponsoredBoosterClose";
import { useBalance } from "@/providers/BalanceProvider";

/* ───────── TYPES ───────── */

type Props = {
  ownerBase58: string;
  displayCurrency: string;
  fxRate: number;
  rows?: BoosterRow[];
  loading?: boolean;
  onClosed?: () => void;
};

type ModalKind = "setup" | "processing" | "success" | "error";

type ModalState = {
  kind: ModalKind;
  closeSig?: string | null;
  sweepSig?: string | null;
  errorMessage?: string;
  warnings?: string[];
} | null;

/**
 * Minimal shape this component needs from a BoosterRow.
 * We intentionally keep this local so this file is lint-safe and production-stable
 * even if the upstream type changes.
 */
type BoosterRowView = {
  id?: string | null;
  symbol?: string | null;
  isLong?: boolean | null;
  createdAt?: string | number | Date | null;

  collateralUsd?: number | string | null;
  spotValueUsd?: number | string | null;
  pnlUsd?: number | string | null;
  liqUsd?: number | string | null;
  sizeTokens?: number | string | null;
};

/* ───────── CONSTANTS ───────── */

// Stage configuration - maps CloseStatus to UI (matches MultiplierPanel pattern)
const STAGE_CONFIG: Record<
  CloseStatus,
  {
    title: string;
    subtitle: string;
    progress: number;
    icon: "spinner" | "wallet" | "success" | "error";
  }
> = {
  idle: { title: "", subtitle: "", progress: 0, icon: "spinner" },
  building: {
    title: "Preparing close",
    subtitle: "Building transaction...",
    progress: 10,
    icon: "spinner",
  },
  signing: {
    title: "Approve in wallet",
    subtitle: "Please sign the transaction",
    progress: 20,
    icon: "wallet",
  },
  sending: {
    title: "Submitting",
    subtitle: "Broadcasting to Solana...",
    progress: 40,
    icon: "spinner",
  },
  confirming: {
    title: "Confirming",
    subtitle: "Waiting for network...",
    progress: 55,
    icon: "spinner",
  },
  "waiting-for-refund": {
    title: "Closing position",
    subtitle: "Jupiter is processing...",
    progress: 70,
    icon: "spinner",
  },
  sweeping: {
    title: "Almost done",
    subtitle: "Finalizing close...",
    progress: 88,
    icon: "spinner",
  },
  done: {
    title: "Position closed!",
    subtitle: "Your funds are returned",
    progress: 100,
    icon: "success",
  },
  error: {
    title: "Close failed",
    subtitle: "Something went wrong",
    progress: 0,
    icon: "error",
  },
};

/* ───────── HELPERS ───────── */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function usdToUnits(usd: number) {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.max(0, Math.floor(usd * 1_000_000));
}

function cleanNumberInput(raw: string) {
  const s = raw.replace(/[^\d.]/g, "");
  const parts = s.split(".");
  if (parts.length <= 1) return s;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function explorerUrl(sig: string) {
  return `https://solscan.io/tx/${sig}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asBoosterView(row: BoosterRow | null | undefined): BoosterRowView {
  // BoosterRow is imported but may be wide; we safely read properties
  // without using `any`.
  if (!row || !isRecord(row)) return {};
  const r = row as Record<string, unknown>;

  return {
    id: typeof r.id === "string" ? r.id : null,
    symbol: typeof r.symbol === "string" ? r.symbol : null,
    isLong: typeof r.isLong === "boolean" ? r.isLong : null,
    createdAt:
      typeof r.createdAt === "string" ||
      typeof r.createdAt === "number" ||
      r.createdAt instanceof Date
        ? (r.createdAt as string | number | Date)
        : null,

    collateralUsd:
      typeof r.collateralUsd === "number" || typeof r.collateralUsd === "string"
        ? (r.collateralUsd as number | string)
        : null,
    spotValueUsd:
      typeof r.spotValueUsd === "number" || typeof r.spotValueUsd === "string"
        ? (r.spotValueUsd as number | string)
        : null,
    pnlUsd:
      typeof r.pnlUsd === "number" || typeof r.pnlUsd === "string"
        ? (r.pnlUsd as number | string)
        : null,
    liqUsd:
      typeof r.liqUsd === "number" || typeof r.liqUsd === "string"
        ? (r.liqUsd as number | string)
        : null,
    sizeTokens:
      typeof r.sizeTokens === "number" || typeof r.sizeTokens === "string"
        ? (r.sizeTokens as number | string)
        : null,
  };
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

export default function PositionsPanel({
  ownerBase58,
  displayCurrency,
  fxRate,
  rows = [],
  loading,
  onClosed,
}: Props) {
  const ownerReady = safeStr(ownerBase58).trim().length > 0;

  // ✅ Get balance context for refreshing after close
  const { refresh: refreshBalance } = useBalance();

  const toLocal = useCallback(
    (usd: number) => safeNum(usd, 0) * (safeNum(fxRate, 1) || 1),
    [fxRate]
  );

  const toUsd = useCallback(
    (local: number) => local / (safeNum(fxRate, 1) || 1),
    [fxRate]
  );

  const closeHook = useServerSponsoredBoosterClose();
  const busy = closeHook.isBusy;

  const [selected, setSelected] = useState<BoosterRow | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [closeAll, setCloseAll] = useState(true);
  const [amountLocal, setAmountLocal] = useState("");

  const closeStartedRef = useRef(false);

  const selectedView = useMemo(() => asBoosterView(selected), [selected]);

  const selectedMeta = useMemo(() => {
    const symbol = safeStr(selectedView.symbol);
    return symbol ? findTokenBySymbol(symbol) : null;
  }, [selectedView.symbol]);

  const selectedMaxUsd = useMemo(() => {
    return Math.max(0, safeNum(selectedView.spotValueUsd, 0));
  }, [selectedView.spotValueUsd]);

  const selectedMaxLocal = useMemo(
    () => toLocal(selectedMaxUsd),
    [selectedMaxUsd, toLocal]
  );

  // Get current stage config for processing modal
  const currentStage = modal?.kind === "processing" ? closeHook.status : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  /* ───────── Handlers ───────── */

  const openCloseModal = useCallback(
    (p: BoosterRow) => {
      closeHook.reset();
      setSelected(p);
      setCloseAll(true);
      setAmountLocal("");
      setModal({ kind: "setup" });
      closeStartedRef.current = false;
    },
    [closeHook]
  );

  const closeModal = useCallback(() => {
    // Can't close during processing
    if (modal?.kind === "processing") return;

    const wasSuccess = modal?.kind === "success";

    setModal(null);
    setSelected(null);
    setCloseAll(true);
    setAmountLocal("");
    closeStartedRef.current = false;

    // ✅ If successful, call parent callback (balance already refreshed)
    if (wasSuccess) {
      onClosed?.();
    }
  }, [modal, onClosed]);

  const setPercent = useCallback(
    (pct: number) => {
      if (!selected) return;
      const bounded = clamp(pct, 1, 100);
      const usd = (selectedMaxUsd * bounded) / 100;
      const local = toLocal(usd);
      setCloseAll(false);
      setAmountLocal(local.toFixed(2));
    },
    [selected, selectedMaxUsd, toLocal]
  );

  const setMax = useCallback(() => {
    if (!selected) return;
    setCloseAll(false);
    setAmountLocal(selectedMaxLocal.toFixed(2));
  }, [selected, selectedMaxLocal]);

  const validatePartial = useCallback(() => {
    const local = Number(amountLocal);
    if (!Number.isFinite(local) || local <= 0) {
      return { ok: false as const, message: "Enter an amount to close." };
    }

    const cappedLocal = clamp(local, 0, selectedMaxLocal);
    const usd = toUsd(cappedLocal);
    const cappedUsd = clamp(usd, 0, selectedMaxUsd);

    const sizeUsdDeltaUnits = usdToUnits(cappedUsd);
    if (sizeUsdDeltaUnits <= 0) {
      return { ok: false as const, message: "Close amount is too small." };
    }

    if (!selected) {
      return { ok: false as const, message: "No position selected." };
    }

    const collateralUsd = safeNum(selectedView.collateralUsd, 0);
    const closePercentage = selectedMaxUsd > 0 ? cappedUsd / selectedMaxUsd : 0;
    const collateralToWithdrawUsd = collateralUsd * closePercentage;
    const collateralUsdDeltaUnits = usdToUnits(collateralToWithdrawUsd);

    return {
      ok: true as const,
      sizeUsdDeltaUnits,
      collateralUsdDeltaUnits,
      finalLocal: cappedLocal,
      finalUsd: cappedUsd,
      closePercentage: Math.round(closePercentage * 100),
    };
  }, [
    amountLocal,
    selectedMaxLocal,
    selectedMaxUsd,
    toUsd,
    selected,
    selectedView.collateralUsd,
  ]);

  const canSubmit = useMemo(() => {
    if (!selected || !ownerReady || busy) return false;
    if (closeAll) return true;
    return validatePartial().ok;
  }, [selected, ownerReady, busy, closeAll, validatePartial]);

  const submitClose = useCallback(async () => {
    if (!selected || !canSubmit) return;

    closeStartedRef.current = true;
    setModal({ kind: "processing" });

    try {
      const symbolStr = safeStr(selectedView.symbol).toUpperCase();
      const symbol = (
        symbolStr === "BTC" || symbolStr === "ETH" || symbolStr === "SOL"
          ? symbolStr
          : "SOL"
      ) as "BTC" | "ETH" | "SOL";

      const side: "long" | "short" = selectedView.isLong ? "long" : "short";

      let result: Awaited<ReturnType<typeof closeHook.run>>;

      if (closeAll) {
        result = await closeHook.run({
          ownerBase58,
          symbol,
          side,
          entirePosition: true,
          priceSlippageBps: 500,
          autoSweep: true,
          sweepMaxAttempts: 5,
        });
      } else {
        const v = validatePartial();
        if (!v.ok) throw new Error(v.message);

        result = await closeHook.run({
          ownerBase58,
          symbol,
          side,
          entirePosition: false,
          sizeUsdDeltaUnits: v.sizeUsdDeltaUnits,
          collateralUsdDeltaUnits: v.collateralUsdDeltaUnits,
          priceSlippageBps: 500,
          autoSweep: true,
          sweepMaxAttempts: 5,
        });
      }

      // ✅ Immediately trigger balance refresh on success
      refreshBalance().catch((e: unknown) => {
        console.warn("[PositionsPanel] Balance refresh failed:", e);
      });

      setModal({
        kind: "success",
        closeSig: result.closeSignature,
        sweepSig: result.sweepSignature,
        warnings: result.warnings,
      });
    } catch (e: unknown) {
      const err = e as { message?: string; raw?: { userMessage?: string } };
      setModal({
        kind: "error",
        errorMessage: err?.message || err?.raw?.userMessage || "Close failed",
      });
    }
  }, [
    selected,
    canSubmit,
    closeAll,
    ownerBase58,
    closeHook,
    validatePartial,
    refreshBalance,
    selectedView.symbol,
    selectedView.isLong,
  ]);

  /* ───────── Sync with hook status (for processing animation) ───────── */

  useEffect(() => {
    if (!modal || modal.kind !== "processing" || !closeStartedRef.current)
      return;
    // stageConfig is derived from closeHook.status; React will re-render.
  }, [closeHook.status, modal]);

  /* ───────── Render ───────── */

  return (
    <>
      {/* POSITIONS LIST */}
      <div className="glass-panel bg-white/10 p-4 sm:p-5 lg:sticky lg:top-3">
        <div className="text-sm font-semibold text-white/90">
          Your Positions
        </div>

        <div className="mt-4 space-y-2">
          {!ownerReady ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
              Loading Account
            </div>
          ) : loading && rows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
              Loading positions…
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
              No Multiplied positions yet.
            </div>
          ) : (
            rows.map((p, idx) => {
              const view = asBoosterView(p);

              const symbol = safeStr(view.symbol, "SOL");
              const meta = findTokenBySymbol(symbol);
              const id = safeStr(view.id, `${symbol}-${idx}`);

              const collateralUsd = safeNum(view.collateralUsd, 0);
              const spotValueUsd = safeNum(view.spotValueUsd, 0);
              const pnlUsd = safeNum(view.pnlUsd, 0);
              const liqUsd = safeNum(view.liqUsd, 0);
              const sizeTokens = safeNum(view.sizeTokens, 0);

              const buyInLocal = toLocal(collateralUsd);
              const positionValueLocal = toLocal(spotValueUsd);
              const pnlLocal = toLocal(pnlUsd);

              const pnlClass =
                pnlLocal > 0
                  ? "text-emerald-300"
                  : pnlLocal < 0
                    ? "text-red-300"
                    : "text-white/70";

              return (
                <div
                  key={id}
                  className="rounded-2xl border border-white/10 bg-black/25 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Image
                        src={meta?.logo || "/placeholder.svg"}
                        alt={`${symbol} logo`}
                        width={22}
                        height={22}
                        className="h-5 w-5 rounded-full border border-white/15 bg-white/5"
                      />
                      <div>
                        <div className="text-sm font-semibold text-white/85">
                          {symbol} • {view.isLong ? "LONG" : "SHORT"}
                        </div>
                        <div className="text-[11px] text-white/45">
                          {sizeTokens.toFixed(6)} {symbol}
                        </div>
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-[11px] text-white/45">
                      {safeDateLabel(view.createdAt as unknown)}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="text-white/50">
                      Buy-in
                      <div className="font-semibold text-white/80">
                        {formatMoney(buyInLocal, displayCurrency)}
                      </div>
                    </div>
                    <div className="text-white/50">
                      Position value
                      <div className="font-semibold text-white/80">
                        {formatMoney(positionValueLocal, displayCurrency)}
                      </div>
                    </div>
                    <div className="text-white/50">
                      P&amp;L
                      <div className={`font-semibold ${pnlClass}`}>
                        {pnlLocal >= 0 ? "+" : ""}
                        {formatMoney(pnlLocal, displayCurrency)}
                      </div>
                    </div>
                    <div className="text-white/50">
                      Liquidation
                      <div className="font-semibold text-white/80">
                        {liqUsd > 0
                          ? formatMoney(toLocal(liqUsd), displayCurrency)
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      onClick={() => openCloseModal(p)}
                      disabled={busy}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-60 transition"
                    >
                      {busy ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Closing…
                        </>
                      ) : (
                        "Close position"
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* CLOSE SETUP MODAL */}
      {modal?.kind === "setup" && selected && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-white/90">
                Close position
              </div>
              <button
                onClick={closeModal}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/50 hover:text-white/90 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Position info */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <Image
                  src={selectedMeta?.logo || "/placeholder.svg"}
                  alt={`${safeStr(selectedView.symbol)} logo`}
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full border border-white/15 bg-white/5"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white/90">
                    {safeStr(selectedView.symbol)} •{" "}
                    {selectedView.isLong ? "LONG" : "SHORT"}
                  </div>
                  <div className="text-xs text-white/50">
                    Max close:{" "}
                    <span className="font-semibold text-white/80">
                      {formatMoney(selectedMaxLocal, displayCurrency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Close type toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCloseAll(true);
                    setAmountLocal("");
                  }}
                  disabled={busy}
                  className={[
                    "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                    closeAll
                      ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                      : "border-white/10 bg-black/25 text-white/70 hover:text-white/90",
                    busy ? "opacity-70 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  Close all
                </button>
                <button
                  type="button"
                  onClick={() => setCloseAll(false)}
                  disabled={busy}
                  className={[
                    "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                    !closeAll
                      ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                      : "border-white/10 bg-black/25 text-white/70 hover:text-white/90",
                    busy ? "opacity-70 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  Close partial
                </button>
              </div>

              {/* Partial close controls */}
              {!closeAll && (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="text-xs font-semibold text-white/80">
                    Amount to close ({displayCurrency})
                  </div>

                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
                    <span className="text-xs text-white/50 px-2">
                      {displayCurrency}
                    </span>
                    <input
                      value={amountLocal}
                      inputMode="decimal"
                      onChange={(e) =>
                        setAmountLocal(cleanNumberInput(e.target.value))
                      }
                      placeholder="0.00"
                      disabled={busy}
                      className="w-full bg-transparent text-sm text-white/90 outline-none disabled:opacity-60"
                    />
                  </div>

                  {/* Quick percentage buttons */}
                  <div className="grid grid-cols-5 gap-2">
                    {[25, 50, 75, 90].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setPercent(pct)}
                        disabled={busy}
                        className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-[11px] font-semibold text-white/70 hover:bg-white/10 disabled:opacity-60"
                      >
                        {pct}%
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={setMax}
                      disabled={busy}
                      className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-2 py-2 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-60"
                    >
                      Max
                    </button>
                  </div>

                  <div className="text-[11px] text-white/45">
                    {(() => {
                      const v = validatePartial();
                      if (!v.ok) return "Enter an amount above 0.";
                      return `Will close ${v.closePercentage}% (~${formatMoney(
                        v.finalLocal,
                        displayCurrency
                      )} / ${v.finalUsd.toFixed(2)} USD)`;
                    })()}
                  </div>
                </div>
              )}

              {/* Submit button */}
              <button
                type="button"
                onClick={submitClose}
                disabled={!canSubmit || busy}
                className={[
                  "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 border",
                  canSubmit && !busy
                    ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25 active:scale-[0.98]"
                    : "bg-white/5 border-white/10 text-white/35 cursor-not-allowed",
                ].join(" ")}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Closing position...
                  </>
                ) : closeAll ? (
                  "Close all"
                ) : (
                  "Close partial"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROCESSING / SUCCESS / ERROR MODAL */}
      {modal && modal.kind !== "setup" && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && modal.kind !== "processing") {
              closeModal();
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button - only for success/error */}
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
                      Position closed!
                    </div>
                    <div className="mt-1 text-sm text-white/50">
                      Your funds have been returned
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <StageIcon icon="error" />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-rose-100">
                      Close failed
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

            {/* Warnings */}
            {modal.kind === "success" && modal.warnings?.length ? (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
                <div className="text-xs text-amber-200/80 text-center">
                  {modal.warnings[0]}
                </div>
              </div>
            ) : null}

            {/* Transaction links */}
            {modal.kind === "success" && (modal.closeSig || modal.sweepSig) && (
              <div className="mt-5 space-y-2">
                {modal.closeSig && (
                  <a
                    href={explorerUrl(modal.closeSig)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 hover:text-white hover:bg-white/10 transition group"
                  >
                    <span>View transaction</span>
                    <ExternalLink className="h-4 w-4 opacity-50 group-hover:opacity-100" />
                  </a>
                )}
                {modal.sweepSig && (
                  <a
                    href={explorerUrl(modal.sweepSig)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white/60 hover:text-white/80 hover:bg-white/10 transition group"
                  >
                    <span>View cleanup tx</span>
                    <ExternalLink className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
                  </a>
                )}
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
                Please don&apos;t close this window
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
