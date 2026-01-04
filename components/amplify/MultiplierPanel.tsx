"use client";

import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  ArrowUpRight,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  ExternalLink,
  Wallet,
} from "lucide-react";

import type {
  AmplifyTokenSymbol,
  LeverageOption,
  MultiplierPosition,
} from "./types";
import {
  estimateLiquidationPrice,
  formatMoney,
  safeNum,
  safeStr,
} from "./utils";

import {
  useServerSponsoredBoosterOpen,
  type BoosterStatus,
} from "@/hooks/useServerSponsoredBoosterOpen";
import { useBalance } from "@/providers/BalanceProvider";

/* ───────── TYPES ───────── */

type Props = {
  ownerBase58: string;
  tokenSymbol: AmplifyTokenSymbol;
  displayCurrency: string;
  depositBalance: number;
  balanceLoading: boolean;
  price: number;
  fxDisplayPerUsd: number;
  positions?: MultiplierPosition[];
  onPositionsChange: (next: MultiplierPosition[]) => void;
  onAfterAction?: () => void;
};

type ModalKind = "processing" | "success" | "error";

type ModalState = {
  kind: ModalKind;
  openSig?: string | null;
  sweepSig?: string | null;
  errorMessage?: string;
  warnings?: string[];
} | null;

/* ───────── CONSTANTS ───────── */

const leverageOptions: LeverageOption[] = [1.5, 2];

// Stage configuration - maps BoosterStatus to UI
const STAGE_CONFIG: Record<
  BoosterStatus,
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
    title: "Preparing trade",
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
    title: "Opening position",
    subtitle: "Jupiter is processing...",
    progress: 70,
    icon: "spinner",
  },
  sweeping: {
    title: "Almost done",
    subtitle: "Finalizing position...",
    progress: 88,
    icon: "spinner",
  },
  done: {
    title: "Position opened!",
    subtitle: "Your trade is live",
    progress: 100,
    icon: "success",
  },
  error: {
    title: "Trade failed",
    subtitle: "Something went wrong",
    progress: 0,
    icon: "error",
  },
};

/* ───────── HELPERS ───────── */

function explorerUrl(sig: string) {
  return `https://solscan.io/tx/${sig}`;
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

export default function MultiplierPanel({
  ownerBase58,
  tokenSymbol,
  displayCurrency,
  depositBalance,
  balanceLoading,
  price,
  fxDisplayPerUsd,
  positions,
  onPositionsChange,
  onAfterAction,
}: Props) {
  const balanceCtx = useBalance();
  const ctxLoading = !!balanceCtx?.loading;
  const ctxDepositDisplay = safeNum(balanceCtx?.usdcUsd, NaN);
  const refreshBalance = balanceCtx?.refresh;

  const owner = safeStr(ownerBase58, "").trim();
  const ownerReady = owner.length > 0;

  const currencySafe =
    balanceCtx?.displayCurrency?.trim() || displayCurrency?.trim() || "USD";

  const sym = safeStr(tokenSymbol, "SOL").toUpperCase() as AmplifyTokenSymbol;
  const safePositions = useMemo(
    () => (Array.isArray(positions) ? positions : []),
    [positions]
  );

  const [buyIn, setBuyIn] = useState("");
  const [lev, setLev] = useState<LeverageOption>(1.5);
  const [modal, setModal] = useState<ModalState>(null);

  const tradeStartedRef = useRef(false);

  const openHook = useServerSponsoredBoosterOpen();
  const busy = openHook.isBusy;

  /* ───────── Derived Values ───────── */

  const buyInNum = useMemo(() => Math.max(0, safeNum(buyIn, 0)), [buyIn]);
  const fx = useMemo(() => safeNum(fxDisplayPerUsd, 0), [fxDisplayPerUsd]);
  const depBalProp = useMemo(
    () => safeNum(depositBalance, 0),
    [depositBalance]
  );
  const depBal = useMemo(
    () => (Number.isFinite(ctxDepositDisplay) ? ctxDepositDisplay : depBalProp),
    [ctxDepositDisplay, depBalProp]
  );

  const effectiveBalanceLoading = balanceLoading || ctxLoading;
  const pDisplay = useMemo(() => safeNum(price, 0), [price]);

  const marginUsd = useMemo(
    () => (buyInNum > 0 && fx > 0 ? buyInNum / fx : 0),
    [buyInNum, fx]
  );

  const depBalUsd = useMemo(
    () => (depBal > 0 && fx > 0 ? depBal / fx : 0),
    [depBal, fx]
  );

  const fxLooksInverted = useMemo(() => {
    if (currencySafe.toUpperCase() === "USD") return false;
    if (buyInNum <= 0 || fx <= 0) return false;
    return marginUsd > buyInNum * 1.25;
  }, [currencySafe, buyInNum, fx, marginUsd]);

  const estTokenQty = useMemo(
    () => (pDisplay > 0 && buyInNum > 0 ? (buyInNum * lev) / pDisplay : 0),
    [buyInNum, lev, pDisplay]
  );

  const liq = useMemo(
    () => (pDisplay > 0 ? estimateLiquidationPrice(pDisplay, lev) : 0),
    [pDisplay, lev]
  );

  const canSubmit = useMemo(() => {
    if (!ownerReady || effectiveBalanceLoading) return false;
    if (buyInNum <= 0 || buyInNum > depBal) return false;
    if (marginUsd > depBalUsd) return false;
    if (pDisplay <= 0 || fx <= 0 || marginUsd <= 0) return false;
    if (fxLooksInverted) return false;
    return true;
  }, [
    ownerReady,
    effectiveBalanceLoading,
    buyInNum,
    depBal,
    marginUsd,
    depBalUsd,
    pDisplay,
    fx,
    fxLooksInverted,
  ]);

  /* ───────── Sync modal with hook status ───────── */

  useEffect(() => {
    // Only sync if we're in processing mode and we started this trade
    if (!modal || modal.kind !== "processing" || !tradeStartedRef.current)
      return;
    // Hook handles its own status, we just observe it
  }, [openHook.status, modal]);

  // Get current stage config
  const currentStage = modal?.kind === "processing" ? openHook.status : null;
  const stageConfig = currentStage ? STAGE_CONFIG[currentStage] : null;

  /* ───────── Handlers ───────── */

  const closeModal = useCallback(() => {
    if (!modal || modal.kind === "processing") return;
    setModal(null);
    tradeStartedRef.current = false;
    onAfterAction?.();
  }, [modal, onAfterAction]);

  const onOpen = useCallback(async () => {
    if (!canSubmit || busy) return;

    tradeStartedRef.current = true;
    setModal({ kind: "processing" });

    try {
      const marginUnits = Math.floor(marginUsd * 1_000_000);

      const result = await openHook.run({
        ownerBase58: owner,
        symbol: sym as "BTC" | "ETH" | "SOL",
        side: "long",
        leverage: lev,
        marginUnits,
        priceSlippageBps: 500,
        autoSweep: true,
        sweepMaxAttempts: 5,
      });

      // Create position record
      const pos: MultiplierPosition = {
        id: `mp_${Date.now()}`,
        tokenSymbol: sym,
        side: "long",
        leverage: lev,
        buyIn: buyInNum,
        entryPrice: pDisplay,
        estTokenQty,
        estLiquidationPrice: liq,
        createdAt: new Date().toISOString(),
        openSignature: result.openSignature,
        sweepSignature: result.sweepSignature,
      };

      onPositionsChange([pos, ...safePositions]);
      setBuyIn("");

      // ✅ Immediately trigger balance refresh on success
      // This updates USDC balance (reduced by margin) and positions list
      refreshBalance?.().catch((e) => {
        console.warn("[MultiplierPanel] Balance refresh failed:", e);
      });

      setModal({
        kind: "success",
        openSig: result.openSignature,
        sweepSig: result.sweepSignature,
        warnings: result.warnings,
      });
    } catch (e) {
      const err = e as Error & { raw?: { userMessage?: string } };
      setModal({
        kind: "error",
        errorMessage: err?.message || err?.raw?.userMessage || "Trade failed",
      });
    }
  }, [
    canSubmit,
    busy,
    openHook,
    owner,
    sym,
    lev,
    buyInNum,
    marginUsd,
    pDisplay,
    estTokenQty,
    liq,
    onPositionsChange,
    safePositions,
    refreshBalance,
  ]);

  /* ───────── Render ───────── */

  return (
    <>
      {/* PANEL */}
      <div className="glass-panel bg-white/10 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white/90">Amplify</div>
            <div className="mt-0.5 text-xs text-white/45">
              Choose a multiplier and open a long position.
            </div>
          </div>
          <div className="text-right text-xs text-white/45">
            Available
            <div className="mt-0.5 text-white/85 font-semibold">
              {effectiveBalanceLoading
                ? "…"
                : formatMoney(depBal, currencySafe)}
            </div>
          </div>
        </div>

        {/* Buy-in */}
        <div className="mt-4">
          <label className="text-xs text-white/50">Buy-in</label>
          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
            <span className="text-xs text-white/50 px-2">{currencySafe}</span>
            <input
              value={buyIn}
              onChange={(e) => setBuyIn(clampMoneyInput(e.target.value))}
              inputMode="decimal"
              placeholder="0.00"
              disabled={busy}
              className="w-full bg-transparent text-sm text-white/90 outline-none disabled:opacity-60"
            />
            <button
              type="button"
              disabled={busy || effectiveBalanceLoading}
              onClick={() => setBuyIn(money2(depBal))}
              className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white/90 disabled:opacity-60"
            >
              Max
            </button>
          </div>

          <div className="mt-2 text-[11px] text-white/45">
            {buyInNum > 0 && fx > 0 ? (
              <>
                Sent as{" "}
                <span className="text-white/80 font-semibold">
                  {formatMoney(marginUsd, "USD")}
                </span>{" "}
                (USDC)
                <span className="ml-2 text-white/35">
                  • FX: 1 USD = {fx.toFixed(4)} {currencySafe}
                </span>
              </>
            ) : (
              "Sent as USDC (USD) on-chain"
            )}
          </div>

          {/* Validation */}
          {!ownerReady && (
            <div className="mt-2 text-xs text-rose-200/80">
              Wallet not connected.
            </div>
          )}
          {!effectiveBalanceLoading && buyInNum > depBal && buyInNum > 0 && (
            <div className="mt-2 text-xs text-rose-200/80">
              Buy-in exceeds available balance.
            </div>
          )}
          {fx <= 0 && (
            <div className="mt-2 text-xs text-rose-200/80">
              FX rate unavailable.
            </div>
          )}
          {fxLooksInverted && (
            <div className="mt-2 text-xs text-rose-200/80">
              FX rate looks inverted. Refresh and try again.
            </div>
          )}
          {!effectiveBalanceLoading &&
            buyInNum > 0 &&
            marginUsd > depBalUsd && (
              <div className="mt-2 text-xs text-rose-200/80">
                Insufficient USD balance after FX conversion.
              </div>
            )}
        </div>

        {/* Multiplier */}
        <div className="mt-4">
          <label className="text-xs text-white/50">Multiplier</label>
          <div className="mt-1 flex gap-2">
            {leverageOptions.map((opt) => (
              <button
                key={opt}
                disabled={busy}
                onClick={() => setLev(opt)}
                className={[
                  "flex-1 rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                  opt === lev
                    ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-black/25 text-white/70 hover:text-white/90",
                  busy ? "opacity-70 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {opt}x
              </button>
            ))}
          </div>
          
        </div>

        {/* Summary */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-white/45">Exposure (est.)</div>
              <div className="mt-0.5 text-sm font-semibold text-white/85">
                {buyInNum > 0 ? formatMoney(buyInNum * lev, currencySafe) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-white/45">
                Liquidation (est.)
              </div>
              <div className="mt-0.5 text-sm font-semibold text-white/85">
                {liq ? formatMoney(liq, currencySafe) : "—"}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-[11px] text-white/45">
                You receive (est.)
              </div>
              <div className="mt-0.5 text-sm font-semibold text-white/85">
                {estTokenQty ? `${estTokenQty.toFixed(6)} ${sym}` : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <button
          disabled={!canSubmit || busy}
          onClick={onOpen}
          className={[
            "mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 border",
            canSubmit && !busy
              ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25 active:scale-[0.98]"
              : "bg-white/5 border-white/10 text-white/35 cursor-not-allowed",
          ].join(" ")}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening position...
            </>
          ) : (
            <>
              Open Long {lev}x <ArrowUpRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* MODAL */}
      {modal && (
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
            {/* Close button */}
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
                      Position opened!
                    </div>
                    <div className="mt-1 text-sm text-white/50">
                      Your trade is live
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <StageIcon icon="error" />
                  <div className="mt-4">
                    <div className="text-base font-semibold text-rose-100">
                      Trade failed
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
            {modal.kind === "success" && (modal.openSig || modal.sweepSig) && (
              <div className="mt-5 space-y-2">
                {modal.openSig && (
                  <a
                    href={explorerUrl(modal.openSig)}
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
