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
        // remove letters like "US$" -> "$"
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

/* --------------------------- calc helpers --------------------------- */

export function estimateLiquidationPrice(entryPrice: number, leverage: number) {
  const p = Number(entryPrice);
  const lev = Number(leverage);

  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(lev) || lev <= 1) return 0;

  return Math.max(0, p * (1 - 1 / lev));
}

/* ----------------------- NEW: safe helpers ----------------------- */

/**
 * Safe string coercion:
 * - preserves strings
 * - converts numbers/objects to string if needed (optional)
 * - never returns undefined
 */
export function safeStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;

  // If you ONLY want real strings, delete this line:
  return String(v);
}

/**
 * Safe base58 shortener:
 * - accepts unknown
 * - never crashes
 * - never calls .slice on undefined
 */
export function shortBase58(v: unknown, head = 4, tail = 4): string {
  const s = safeStr(v, "");
  if (!s) return "";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Safe number coercion:
 * - returns fallback if NaN/Infinity
 */
export function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Safe date label:
 * - accepts unknown
 * - handles bad dates
 */
export function safeDateLabel(v: unknown): string {
  const s = safeStr(v, "");
  if (!s) return "—";

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString();
}
