// lib/boosterFees.ts

const DEFAULT_PERP_OPEN_FEE_RATE = 0.02; // 2% fallback
const MAX_PERP_OPEN_FEE_RATE = 0.2; // hard cap at 20%

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parsePerpOpenFeeRate(raw: unknown): number {
  const n =
    typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_PERP_OPEN_FEE_RATE;
  const normalized = n > 1 ? n / 100 : n;
  return clamp(normalized, 0, MAX_PERP_OPEN_FEE_RATE);
}

export const PERP_OPEN_FEE_RATE = parsePerpOpenFeeRate(
  process.env.NEXT_PUBLIC_PERP_OPEN_FEE_UI ?? DEFAULT_PERP_OPEN_FEE_RATE,
);

export const PERP_OPEN_FEE_BPS = Math.round(PERP_OPEN_FEE_RATE * 10_000);
export const PERP_OPEN_FEE_PCT = PERP_OPEN_FEE_RATE * 100;
