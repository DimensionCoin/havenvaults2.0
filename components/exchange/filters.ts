// components/exchange/filters.ts
import type { AssetRow, PriceFilterMode, SortMode } from "./types";

export function applyQuery(assets: AssetRow[], q: string): AssetRow[] {
  const query = q.trim().toLowerCase();
  if (!query) return assets;

  return assets.filter((a) => {
    const name = (a.name || "").toLowerCase();
    const symbol = (a.symbol || "").toLowerCase();
    return name.includes(query) || symbol.includes(query);
  });
}

export function applyPriceFilter(
  assets: AssetRow[],
  mode: PriceFilterMode
): AssetRow[] {
  if (mode === "all") return assets;

  return assets.filter((a) => {
    const p = a.priceUsd;
    if (typeof p !== "number" || !Number.isFinite(p)) return false;

    switch (mode) {
      case "under1":
        return p < 1;
      case "1to10":
        return p >= 1 && p < 10;
      case "10to100":
        return p >= 10 && p < 100;
      case "over100":
        return p >= 100;
      default:
        return true;
    }
  });
}

export function applySort(assets: AssetRow[], mode: SortMode): AssetRow[] {
  const arr = [...assets];

  const num = (v?: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : -Infinity;

  switch (mode) {
    case "price_desc":
      return arr.sort((a, b) => num(b.priceUsd) - num(a.priceUsd));
    case "price_asc":
      return arr.sort((a, b) => num(a.priceUsd) - num(b.priceUsd));
    case "change_desc":
      return arr.sort((a, b) => num(b.changePct24h) - num(a.changePct24h));
    case "change_asc":
      return arr.sort((a, b) => num(a.changePct24h) - num(b.changePct24h));
    case "volume_desc":
      return arr.sort((a, b) => num(b.volumeUsd24h) - num(a.volumeUsd24h));
    case "featured":
    default:
      return arr;
  }
}
