// components/amplify/utils.ts

/* ----------------------------- formatting ----------------------------- */

export function formatMoney(value: number, currency: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";

  const cur = (currency || "USD").toUpperCase();

  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    });

    const parts = formatter.formatToParts(n);

    return parts
      .map((part) => {
        if (part.type !== "currency") return part.value;
        return part.value.replace(/[A-Za-z]/g, "");
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    const symbol =
      cur === "USD" || cur === "CAD" || cur === "AUD" || cur === "NZD"
        ? "$"
        : cur === "EUR"
          ? "€"
          : cur === "GBP"
            ? "£"
            : "";

    return `${symbol}${n.toFixed(2)}`;
  }
}

/* --------------------------- Jupiter Liquidation Calc --------------------------- */

/**
 * Jupiter Perpetuals Liquidation Calculation
 *
 * Jupiter liquidates positions when:
 *   collateral - losses - borrowFees <= positionSize * maxLeverage^-1
 *
 * Which translates to liquidation occurring when your remaining collateral
 * can no longer meet the maintenance margin requirement.
 *
 * For LONGS:  liquidationPrice = entryPrice * (1 - (collateral - fees) / positionSize + maintenanceMargin)
 * For SHORTS: liquidationPrice = entryPrice * (1 + (collateral - fees) / positionSize - maintenanceMargin)
 */

export interface LiquidationParams {
  entryPrice: number; // Entry price of the position
  positionSizeUsd: number; // Total position size in USD (collateral * leverage)
  collateralUsd: number; // Collateral amount in USD
  leverage: number; // Leverage used
  isLong: boolean; // True for long, false for short
  accumulatedBorrowFees?: number; // Accumulated borrow/funding fees (optional)
}

// Jupiter's maintenance margin is ~1% (varies slightly by market)
const MAINTENANCE_MARGIN_RATE = 0.01;

// Jupiter charges a liquidation fee of 0.5%
const LIQUIDATION_FEE_RATE = 0.005;

/**
 * Calculate liquidation price matching Jupiter's methodology
 *
 * Jupiter's formula essentially:
 * - Long: Liquidation when price drops such that losses exceed (collateral - maintenanceMargin - fees)
 * - Short: Liquidation when price rises such that losses exceed (collateral - maintenanceMargin - fees)
 */
export function calculateJupiterLiquidationPrice(
  params: LiquidationParams
): number {
  const {
    entryPrice,
    positionSizeUsd,
    collateralUsd,
    leverage,
    isLong,
    accumulatedBorrowFees = 0,
  } = params;

  // Validate inputs
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(positionSizeUsd) || positionSizeUsd <= 0) return 0;
  if (!Number.isFinite(collateralUsd) || collateralUsd <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage < 1) return 0;

  // Calculate maintenance margin requirement
  const maintenanceMargin = positionSizeUsd * MAINTENANCE_MARGIN_RATE;

  // Calculate liquidation fee
  const liquidationFee = positionSizeUsd * LIQUIDATION_FEE_RATE;

  // Available collateral after fees and maintenance margin
  const availableCollateral =
    collateralUsd - accumulatedBorrowFees - maintenanceMargin - liquidationFee;

  if (availableCollateral <= 0) {
    // Already liquidatable
    return isLong ? entryPrice : entryPrice;
  }

  // Max loss before liquidation as a percentage of position size
  const maxLossPercent = availableCollateral / positionSizeUsd;

  if (isLong) {
    // For longs, liquidation happens when price drops
    // loss = (entryPrice - currentPrice) / entryPrice * positionSize
    // Liquidation when: (entryPrice - liqPrice) / entryPrice = maxLossPercent
    // liqPrice = entryPrice * (1 - maxLossPercent)
    const liquidationPrice = entryPrice * (1 - maxLossPercent);
    return Math.max(0, liquidationPrice);
  } else {
    // For shorts, liquidation happens when price rises
    // loss = (currentPrice - entryPrice) / entryPrice * positionSize
    // Liquidation when: (liqPrice - entryPrice) / entryPrice = maxLossPercent
    // liqPrice = entryPrice * (1 + maxLossPercent)
    const liquidationPrice = entryPrice * (1 + maxLossPercent);
    return liquidationPrice;
  }
}

/**
 * Simplified version that derives position size from collateral and leverage
 * This is what you'd use when opening a new position
 */
export function estimateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  isLong: boolean = true,
  accumulatedBorrowFees: number = 0,
  collateralUsd?: number
): number {
  const p = Number(entryPrice);
  const lev = Number(leverage);

  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(lev) || lev < 1) return 0;

  // Use a nominal collateral if not provided (result is the same ratio-wise)
  const collateral = collateralUsd ?? 100;
  const positionSize = collateral * lev;

  return calculateJupiterLiquidationPrice({
    entryPrice: p,
    positionSizeUsd: positionSize,
    collateralUsd: collateral,
    leverage: lev,
    isLong,
    accumulatedBorrowFees,
  });
}

/**
 * Calculate the distance to liquidation as a percentage
 */
export function calculateLiquidationDistance(
  currentPrice: number,
  liquidationPrice: number,
  isLong: boolean
): number {
  if (liquidationPrice <= 0 || currentPrice <= 0) return 100;

  if (isLong) {
    // For longs, distance is how much price can drop
    return ((currentPrice - liquidationPrice) / currentPrice) * 100;
  } else {
    // For shorts, distance is how much price can rise
    return ((liquidationPrice - currentPrice) / currentPrice) * 100;
  }
}

/**
 * Check if a position is at risk of liquidation (within threshold)
 */
export function isLiquidationRisk(
  currentPrice: number,
  liquidationPrice: number,
  isLong: boolean,
  riskThresholdPercent: number = 10
): boolean {
  const distance = calculateLiquidationDistance(
    currentPrice,
    liquidationPrice,
    isLong
  );
  return distance <= riskThresholdPercent;
}

/**
 * Legacy simple calculation (kept for backwards compatibility)
 * NOTE: This is less accurate than calculateJupiterLiquidationPrice
 */
export function estimateLiquidationPriceSimple(
  entryPrice: number,
  leverage: number
): number {
  const p = Number(entryPrice);
  const lev = Number(leverage);

  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(lev) || lev <= 1) return 0;

  return Math.max(0, p * (1 - 1 / lev));
}

/* ----------------------- Safe helpers ----------------------- */

export function safeStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

export function shortBase58(v: unknown, head = 4, tail = 4): string {
  const s = safeStr(v, "");
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

export function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function safeDateLabel(v: unknown): string {
  const s = safeStr(v, "");
  if (!s) return "—";

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString();
}
