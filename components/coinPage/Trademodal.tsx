"use client";

import React from "react";
import Link from "next/link";
import {
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Wallet,
  ExternalLink,
} from "lucide-react";
import type { ModalState, StageConfig } from "./types";
import { explorerUrl } from "./utils";

/* ───────── ProgressBar ───────── */

export function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
      <div
        className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

/* ───────── StageIcon ───────── */

export function StageIcon({
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
      <div
        className={`${base} animate-pulse border-amber-500/30 bg-amber-500/10`}
      >
        <Wallet className="h-7 w-7 text-amber-500" />
      </div>
    );
  }

  return (
    <div className={`${base} border-border bg-card/60`}>
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  );
}

/* ───────── TradeModal ───────── */

type TradeModalProps = {
  modal: ModalState;
  stageConfig: StageConfig | null;
  onClose: () => void;
};

export function TradeModal({ modal, stageConfig, onClose }: TradeModalProps) {
  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 px-4 backdrop-blur"
      onClick={(e) => {
        if (e.target === e.currentTarget && modal.kind !== "processing") {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-sm rounded-3xl border bg-card p-5 shadow-fintech-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {modal.kind !== "processing" && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-xl border bg-card/60 p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                <div className="text-base font-semibold text-foreground">
                  {modal.side === "buy"
                    ? "Purchase complete!"
                    : "Sale complete!"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Your {modal.symbol || "asset"}{" "}
                  {modal.side === "buy" ? "purchase" : "sale"} was successful
                </div>
              </div>
            </>
          ) : (
            <>
              <StageIcon icon="error" />
              <div className="mt-4">
                <div className="text-base font-semibold text-foreground">
                  Order failed
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Something went wrong
                </div>
              </div>
            </>
          )}
        </div>

        {modal.kind === "error" && modal.errorMessage && (
          <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-3">
            <div className="text-xs text-foreground text-center">
              {modal.errorMessage}
            </div>
          </div>
        )}

        {modal.kind === "success" && modal.signature && (
          <div className="mt-5">
            <a
              href={explorerUrl(modal.signature)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-2xl border bg-card/60 px-4 py-3 text-sm text-foreground/80 transition hover:bg-secondary"
            >
              <span>View transaction</span>
              <ExternalLink className="h-4 w-4 opacity-60" />
            </a>
          </div>
        )}

        {modal.kind !== "processing" && (
          <div className="mt-5 flex gap-2">
            <button
              onClick={onClose}
              className="haven-btn-secondary flex-1 rounded-2xl px-4 py-3 text-sm font-semibold"
            >
              Close
            </button>

            {modal.kind === "success" && (
              <Link
                href="/invest"
                className="flex-1 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-center text-sm font-semibold text-foreground transition hover:bg-primary/15"
              >
                View assets
              </Link>
            )}
          </div>
        )}

        {modal.kind === "processing" && (
          <div className="mt-6 text-center text-xs text-muted-foreground">
            Please don&apos;t close this window
          </div>
        )}
      </div>
    </div>
  );
}
