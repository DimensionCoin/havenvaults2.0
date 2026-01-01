"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useBalance } from "@/providers/BalanceProvider";

type Symbol = "BTC" | "ETH" | "SOL";

export function useLiveOraclePrice(symbol: Symbol) {
  const row = useQuery(api.prices.getLatestOne, { symbol });
  const { fxRate, displayCurrency } = useBalance();

  const rate = fxRate && fxRate > 0 ? fxRate : 1;

  const lastUsd = typeof row?.lastPrice === "number" ? row.lastPrice : null;
  const prevUsd =
    typeof row?.prevPrice === "number"
      ? row.prevPrice
      : typeof row?.lastPrice === "number"
        ? row.lastPrice
        : null;

  const price = lastUsd === null ? null : lastUsd * rate;

  let pctChange: number | null = null;
  if (lastUsd !== null && prevUsd !== null && prevUsd > 0) {
    pctChange = ((lastUsd - prevUsd) / prevUsd) * 100;
  }

  return {
    price, // display currency
    pctChange, // percent (already *100)
    displayCurrency,
    isConnecting: row === undefined,
    publishTime: row?.lastPublishTime ?? null,
  };
}
