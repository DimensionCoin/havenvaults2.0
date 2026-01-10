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
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
      <div
        className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
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
  const base =
    "flex h-14 w-14 items-center justify-center rounded-2xl border shadow-fintech-sm";

  if (icon === "success") {
    return (
      <div className={`${base} border-primary/30 bg-primary/10`}>
        <CheckCircle2 className="h-7 w-7 text-primary" />
      </div>
    );
  }

  if (icon === "error") {
    return (
      <div className={`${base} border-destructive/30 bg-destructive/10`}>
        <XCircle className="h-7 w-7 text-destructive" />
      </div>
    );
  }

  if (icon === "wallet") {
    return (
      <div className={`${base} animate-pulse border-primary/25 bg-primary/10`}>
        <Wallet className="h-7 w-7 text-primary" />
      </div>
    );
  }

  return (
    <div className={`${base} border-border bg-card/40`}>
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
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
      <div className="glass-panel-soft p-4 sm:p-5 lg:sticky lg:top-3">
        <div className="text-sm font-semibold text-foreground">
          Your Positions
        </div>

        <div className="mt-4 space-y-2">
          {!ownerReady ? (
            <div className="rounded-2xl border bg-card/40 p-3 text-xs text-muted-foreground">
              Loading Account
            </div>
          ) : loading && rows.length === 0 ? (
            <div className="rounded-2xl border bg-card/40 p-3 text-xs text-muted-foreground">
              Loading positions…
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border bg-card/40 p-3 text-xs text-muted-foreground">
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
                  ? "text-primary"
                  : pnlLocal < 0
                    ? "text-destructive"
                    : "text-muted-foreground";

              return (
                <div key={id} className="rounded-2xl border bg-card/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Image
                        src={meta?.logo || "/placeholder.svg"}
                        alt={`${symbol} logo`}
                        width={22}
                        height={22}
                        className="h-5 w-5 rounded-full border border-border bg-card"
                      />
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {symbol} • {view.isLong ? "LONG" : "SHORT"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {sizeTokens.toFixed(6)} {symbol}
                        </div>
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {safeDateLabel(view.createdAt as unknown)}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="text-muted-foreground">
                      Buy-in
                      <div className="font-semibold text-foreground">
                        {formatMoney(buyInLocal, displayCurrency)}
                      </div>
                    </div>

                    <div className="text-muted-foreground">
                      Position value
                      <div className="font-semibold text-foreground">
                        {formatMoney(positionValueLocal, displayCurrency)}
                      </div>
                    </div>

                    <div className="text-muted-foreground">
                      P&amp;L
                      <div className={`font-semibold ${pnlClass}`}>
                        {pnlLocal >= 0 ? "+" : ""}
                        {formatMoney(pnlLocal, displayCurrency)}
                      </div>
                    </div>

                    <div className="text-muted-foreground">
                      Liquidation
                      <div className="font-semibold text-foreground">
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
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border bg-card/40 px-3 py-2 text-xs font-semibold text-foreground/85 hover:bg-card/60 disabled:opacity-60 transition"
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl border bg-card p-5 shadow-fintech-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">
                Close position
              </div>
              <button
                onClick={closeModal}
                className="rounded-xl border bg-card/60 p-2 text-muted-foreground hover:text-foreground transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Position info */}
              <div className="flex items-center gap-3 rounded-2xl border bg-card/40 p-3">
                <Image
                  src={selectedMeta?.logo || "/placeholder.svg"}
                  alt={`${safeStr(selectedView.symbol)} logo`}
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full border border-border bg-card"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    {safeStr(selectedView.symbol)} •{" "}
                    {selectedView.isLong ? "LONG" : "SHORT"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Max close:{" "}
                    <span className="font-semibold text-foreground">
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
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-card/40 text-foreground/80 hover:bg-card/60",
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
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-card/40 text-foreground/80 hover:bg-card/60",
                    busy ? "opacity-70 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  Close partial
                </button>
              </div>

              {/* Partial close controls */}
              {!closeAll && (
                <div className="space-y-3 rounded-2xl border bg-card/40 p-3">
                  <div className="text-xs font-semibold text-foreground/90">
                    Amount to close ({displayCurrency})
                  </div>

                  <div className="flex items-center gap-2 rounded-2xl border bg-card/40 p-2">
                    <span className="px-2 text-xs text-muted-foreground">
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
                      className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
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
                        className="rounded-xl border bg-card/40 px-2 py-2 text-[11px] font-semibold text-foreground/80 hover:bg-card/60 disabled:opacity-60"
                      >
                        {pct}%
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={setMax}
                      disabled={busy}
                      className="rounded-xl border border-primary/25 bg-primary/10 px-2 py-2 text-[11px] font-semibold text-primary hover:bg-primary/15 disabled:opacity-60"
                    >
                      Max
                    </button>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    {(() => {
                      const v = validatePartial();
                      if (!v.ok) return "Enter an amount above 0.";
                      return `Will close ${
                        v.closePercentage
                      }% (~${formatMoney(v.finalLocal, displayCurrency)} / ${v.finalUsd.toFixed(
                        2
                      )} USD)`;
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
                    ? "haven-primary-btn"
                    : "bg-muted/30 border-border text-muted-foreground cursor-not-allowed",
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && modal.kind !== "processing") {
              closeModal();
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-3xl border bg-card p-5 shadow-fintech-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button - only for success/error */}
            {modal.kind !== "processing" && (
              <div className="mb-2 flex justify-end">
                <button
                  onClick={closeModal}
                  className="rounded-xl border bg-card/60 p-2 text-muted-foreground hover:text-foreground transition"
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
                    <div className="text-base font-semibold text-foreground">
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
                      Position closed!
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Your funds have been returned
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <StageIcon icon="error" />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-destructive">
                      Close failed
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Something went wrong
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Error message */}
            {modal.kind === "error" && modal.errorMessage && (
              <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3">
                <div className="text-xs text-destructive text-center">
                  {modal.errorMessage}
                </div>
              </div>
            )}

            {/* Warnings */}
            {modal.kind === "success" && modal.warnings?.length ? (
              <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/10 p-3">
                <div className="text-xs text-foreground/80 text-center">
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
                    className="flex items-center justify-between rounded-2xl border bg-card/40 px-4 py-3 text-sm text-foreground/85 hover:bg-card/60 transition group"
                  >
                    <span>View transaction</span>
                    <ExternalLink className="h-4 w-4 opacity-60 group-hover:opacity-100" />
                  </a>
                )}
                {modal.sweepSig && (
                  <a
                    href={explorerUrl(modal.sweepSig)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-2xl border bg-card/30 px-4 py-2.5 text-xs text-muted-foreground hover:bg-card/50 transition group"
                  >
                    <span>View cleanup tx</span>
                    <ExternalLink className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
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
                    ? "bg-primary/10 border-primary/25 text-primary hover:bg-primary/15"
                    : "bg-muted/30 border-border text-foreground/80 hover:bg-muted/40",
                ].join(" ")}
              >
                {modal.kind === "success" ? "Done" : "Close"}
              </button>
            )}

            {/* Processing footer */}
            {modal.kind === "processing" && (
              <div className="mt-6 text-center text-xs text-muted-foreground">
                Please don&apos;t close this window
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
