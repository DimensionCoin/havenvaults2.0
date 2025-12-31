export function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/**
 * Bare-bones liquidation estimate (placeholder).
 * Replace once you wire a real perp engine.
 */
export function estimateLiquidationPrice(entryPrice: number, leverage: number) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 1) return 0;
  return Math.max(0, entryPrice * (1 - 1 / leverage));
}
