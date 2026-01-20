import { TOKENS, getCluster, getMintFor } from "@/lib/tokenConfig";
import type { ResolvedToken } from "./types";

const CLUSTER = getCluster();

export function resolveTokenFromSlug(slug: string): ResolvedToken | null {
  const normalized = slug.toLowerCase();

  for (const meta of TOKENS) {
    const mint = getMintFor(meta, CLUSTER);
    if (!mint) continue;

    const symbol = meta?.symbol?.toLowerCase();
    const id = meta?.id?.toLowerCase();
    const mintLower = mint.toLowerCase();

    if (
      normalized === id ||
      normalized === symbol ||
      normalized === mintLower
    ) {
      return { meta, mint };
    }
  }

  return null;
}

export function formatMoneyNoCode(v?: number | null) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: n < 1 ? 6 : 2,
  });
}

export function formatPct(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "0.00%";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function formatQty(v?: number | null, maxFrac = 6) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

export function clampNumber(n: number) {
  return Number.isFinite(n) ? n : 0;
}

export function safeParse(s: string) {
  const n = parseFloat((s || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function explorerUrl(sig: string) {
  return `https://solscan.io/tx/${sig}`;
}

export function grossUpForFee(netAmount: number, feeRate: number): number {
  if (feeRate <= 0 || feeRate >= 1) return netAmount;
  return netAmount / (1 - feeRate);
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function formatTimeLabel(t: number, tf: "1D" | "7D" | "30D" | "90D") {
  const d = new Date(t);
  if (tf === "1D") {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
