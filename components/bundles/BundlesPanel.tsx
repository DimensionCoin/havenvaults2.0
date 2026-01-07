// components/bundles/BundlesPanel.tsx
"use client";

import React, { useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";

import { BUNDLES, type BundleDef, type RiskLevel } from "./bundlesConfig";
import {
  findTokenBySymbol,
  requireMintBySymbol,
  type TokenMeta,
} from "@/lib/tokenConfig";
import { useServerSponsoredUsdcSwap } from "@/hooks/useServerSponsoredUsdcSwap";

type Props = {
  ownerBase58: string;
  displayCurrency: string;
  fxRate: number; // display per USD (same convention you use elsewhere)
  maxSpendDisplay?: number; // optional: cap based on balance
};

type BuyRow = {
  symbol: string;
  status:
    | "idle"
    | "building"
    | "signing"
    | "sending"
    | "confirming"
    | "done"
    | "error";
  sig?: string;
  error?: string;
  amountDisplay: number;
};

function riskPill(risk: RiskLevel) {
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold";
  if (risk === "low")
    return `${base} border-emerald-400/20 bg-emerald-500/10 text-emerald-200`;
  if (risk === "medium")
    return `${base} border-sky-400/20 bg-sky-500/10 text-sky-200`;
  if (risk === "high")
    return `${base} border-amber-400/20 bg-amber-500/10 text-amber-200`;
  return `${base} border-rose-400/20 bg-rose-500/10 text-rose-200`;
}

function cleanNumberInput(raw: string) {
  const s = raw.replace(/[^\d.]/g, "");
  const parts = s.split(".");
  if (parts.length <= 1) return s;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

export default function BundlesPanel({
  ownerBase58,
  displayCurrency,
  fxRate,
  maxSpendDisplay,
}: Props) {
  const swap = useServerSponsoredUsdcSwap();

  const [selectedId, setSelectedId] = useState<string>(BUNDLES[0]?.id ?? "");
  const [amountDisplay, setAmountDisplay] = useState<string>("");

  const selected = useMemo(
    () => BUNDLES.find((b) => b.id === selectedId) ?? BUNDLES[0],
    [selectedId]
  );

  const tokenMetas = useMemo(() => {
    return (selected?.symbols ?? [])
      .map((s) => findTokenBySymbol(s))
      .filter(Boolean) as TokenMeta[];
  }, [selected]);

  const perTokenDisplay = useMemo(() => {
    const amt = Number(amountDisplay);
    const n = selected?.symbols.length ?? 0;
    if (!Number.isFinite(amt) || amt <= 0 || n <= 0) return 0;
    return amt / n;
  }, [amountDisplay, selected]);

  const [rows, setRows] = useState<BuyRow[]>([]);
  const busy = swap.isBusy;

  const canBuy = useMemo(() => {
    const amt = Number(amountDisplay);
    if (!ownerBase58) return false;
    if (!selected) return false;
    if (!Number.isFinite(amt) || amt <= 0) return false;
    if (maxSpendDisplay !== undefined && amt > maxSpendDisplay) return false;
    if ((selected.symbols?.length ?? 0) < 3) return false;
    return true;
  }, [amountDisplay, ownerBase58, selected, maxSpendDisplay]);

  const startBundleBuy = useCallback(async () => {
    if (!canBuy || !selected) return;

    const amt = Number(amountDisplay);
    const symbols = selected.symbols;

    const per = amt / symbols.length;

    // seed UI rows
    setRows(
      symbols.map((symbol) => ({
        symbol,
        status: "idle",
        amountDisplay: per,
      }))
    );

    // sequential execution (simple & safest)
    for (const symbol of symbols) {
      const outputMint = requireMintBySymbol(symbol);

      // mark as building
      setRows((prev) =>
        prev.map((r) =>
          r.symbol === symbol ? { ...r, status: "building" } : r
        )
      );

      try {
        // run the swap (hook drives its own overall status;
        // we still show per-token progress with coarse stages)
        // We'll mirror stages best-effort by updating around the call.
        setRows((prev) =>
          prev.map((r) =>
            r.symbol === symbol ? { ...r, status: "signing" } : r
          )
        );

        const res = await swap.swap({
          kind: "buy",
          fromOwnerBase58: ownerBase58,
          outputMint,
          amountDisplay: per,
          fxRate,
          slippageBps: 50,
        });

        setRows((prev) =>
          prev.map((r) =>
            r.symbol === symbol
              ? { ...r, status: "done", sig: res.signature }
              : r
          )
        );
      } catch (e) {
        const msg = String((e as Error)?.message || "Swap failed");
        setRows((prev) =>
          prev.map((r) =>
            r.symbol === symbol ? { ...r, status: "error", error: msg } : r
          )
        );
        // Continue buying remaining tokens (better UX than aborting everything)
      }
    }
  }, [canBuy, selected, amountDisplay, ownerBase58, fxRate, swap]);

  return (
    <div className="glass-panel-soft p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white/90">Bundles</div>
          <div className="mt-1 text-xs text-white/45">
            Pick a bundle, enter an amount, and we split it evenly across
            tokens.
          </div>
        </div>

        {selected ? (
          <span className={riskPill(selected.risk)}>
            {selected.risk.toUpperCase()}
          </span>
        ) : null}
      </div>

      {/* Selector */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="text-xs font-semibold text-white/70">
            Choose bundle
          </div>

          <div className="mt-2 space-y-2">
            {BUNDLES.map((b) => {
              const isActive = b.id === selectedId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={[
                    "w-full text-left rounded-2xl border px-3 py-3 transition",
                    isActive
                      ? "border-emerald-300/30 bg-emerald-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white/90">
                        {b.name}
                      </div>
                      <div className="text-xs text-white/50">{b.subtitle}</div>
                    </div>
                    <span className={riskPill(b.risk)}>{b.risk}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {b.symbols.map((s) => {
                      const meta = findTokenBySymbol(s);
                      return (
                        <span
                          key={s}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] text-white/70"
                        >
                          <Image
                            src={meta?.logo || "/placeholder.svg"}
                            alt={`${s} logo`}
                            width={16}
                            height={16}
                            className="h-4 w-4 rounded-full border border-white/10 bg-white/5"
                          />
                          {s}
                        </span>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount + preview */}
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="text-xs font-semibold text-white/70">Amount</div>

          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
            <span className="px-2 text-xs text-white/50">
              {displayCurrency}
            </span>
            <input
              value={amountDisplay}
              inputMode="decimal"
              onChange={(e) =>
                setAmountDisplay(cleanNumberInput(e.target.value))
              }
              placeholder="0.00"
              disabled={busy}
              className="w-full bg-transparent text-sm text-white/90 outline-none disabled:opacity-60"
            />
          </div>

          {maxSpendDisplay !== undefined ? (
            <div className="mt-2 text-[11px] text-white/40">
              Available: {maxSpendDisplay.toFixed(2)} {displayCurrency}
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs font-semibold text-white/70">
              Split preview
            </div>
            <div className="mt-2 text-sm text-white/85">
              {selected?.symbols.length ?? 0} tokens •{" "}
              <span className="font-semibold">
                {perTokenDisplay > 0 ? perTokenDisplay.toFixed(2) : "0.00"}{" "}
                {displayCurrency}
              </span>{" "}
              each
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {(selected?.symbols ?? []).map((s) => {
                const meta = findTokenBySymbol(s);
                return (
                  <div
                    key={s}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/70"
                  >
                    <Image
                      src={meta?.logo || "/placeholder.svg"}
                      alt={`${s} logo`}
                      width={16}
                      height={16}
                      className="h-4 w-4 rounded-full border border-white/10 bg-white/5"
                    />
                    <span className="font-semibold text-white/80">{s}</span>
                    <span className="text-white/40">•</span>
                    <span>
                      {perTokenDisplay > 0
                        ? perTokenDisplay.toFixed(2)
                        : "0.00"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={startBundleBuy}
            disabled={!canBuy || busy}
            className={[
              "mt-4 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 border",
              canBuy && !busy
                ? "bg-emerald-500/20 border-emerald-300/30 text-emerald-100 hover:bg-emerald-500/25 active:scale-[0.98]"
                : "bg-white/5 border-white/10 text-white/35 cursor-not-allowed",
            ].join(" ")}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Building bundle...
              </>
            ) : (
              <>
                Buy bundle
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <div className="mt-3 text-[11px] text-white/40">
            Note: this currently executes one swap per token. We’ll optimize
            later.
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mt-4">
        <div className="text-xs font-semibold text-white/70">Execution</div>

        <div className="mt-2 space-y-2">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/45">
              No bundle orders yet.
            </div>
          ) : (
            rows.map((r) => {
              const meta = findTokenBySymbol(r.symbol);
              const ok = r.status === "done";
              const bad = r.status === "error";

              return (
                <div
                  key={r.symbol}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Image
                      src={meta?.logo || "/placeholder.svg"}
                      alt={`${r.symbol} logo`}
                      width={20}
                      height={20}
                      className="h-5 w-5 rounded-full border border-white/10 bg-white/5"
                    />
                    <div>
                      <div className="text-sm font-semibold text-white/85">
                        {r.symbol}
                      </div>
                      <div className="text-[11px] text-white/45">
                        {r.amountDisplay.toFixed(2)} {displayCurrency}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    ) : bad ? (
                      <XCircle className="h-4 w-4 text-rose-300" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-white/60 animate-spin" />
                    )}

                    <div className="text-xs text-white/60">
                      {ok ? "Done" : bad ? "Failed" : r.status}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {swap.error ? (
          <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200/80">
            {swap.error.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
