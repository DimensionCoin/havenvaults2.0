// app/(app)/stocks/StocksClient.tsx
"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  AssetList,
  CategoryTabs,
  FeaturedMovers,
  FilterBar,
  SearchBar,
  applyPriceFilter,
  applySort,
  type Movers,
  type PriceFilterMode,
  type SortMode,
} from "@/components/exchange";

import type { AssetRow } from "@/components/exchange/types";
import type { TokenCategory } from "@/lib/tokenConfig";

function computeMovers(rows: AssetRow[]): Movers {
  const withChange = rows.filter(
    (r) =>
      typeof r.changePct24h === "number" && Number.isFinite(r.changePct24h),
  );

  const gainers = [...withChange].sort(
    (a, b) => (b.changePct24h ?? -Infinity) - (a.changePct24h ?? -Infinity),
  );
  const losers = [...withChange].sort(
    (a, b) => (a.changePct24h ?? Infinity) - (b.changePct24h ?? Infinity),
  );

  return { gainers: gainers.slice(0, 10), losers: losers.slice(0, 10) };
}

function categoryLabel(c: TokenCategory): string {
  if (c === "Top MC") return "Top";
  if (c === "PreMarket") return "Pre";
  return c;
}

type NormalizedToken = {
  price: number;
  priceChange24hPct: number | null;
  mcap: number | null;
  volume24h: number | null;
};

// Split array into chunks
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default function StocksClient({
  initialRows,
}: {
  initialRows: AssetRow[];
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<TokenCategory | "all">("all");
  const [priceMode, setPriceMode] = useState<PriceFilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("featured");

  const [rows, setRows] = useState<AssetRow[]>(initialRows);
  const [loadingPrices, setLoadingPrices] = useState(true);

  // Fetch prices in parallel batches
  useEffect(() => {
    const mints = initialRows.map((r) => r.mint);
    if (mints.length === 0) {
      setLoadingPrices(false);
      return;
    }

    let cancelled = false;

    async function fetchAllPrices() {
      try {
        // Split into 2 batches of 100 max each (or however many you have)
        const batches = chunk(mints, 100);

        // Fetch all batches in parallel
        const batchPromises = batches.map((batch) =>
          fetch("/api/prices/jup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mints: batch }),
          }).then((res) => res.json()),
        );

        const results = await Promise.all(batchPromises);

        if (cancelled) return;

        // Merge all price data
        const allPrices: Record<string, NormalizedToken> = {};
        for (const result of results) {
          Object.assign(allPrices, result.prices || {});
        }

        // Update rows with all prices at once
        setRows((prevRows) =>
          prevRows.map((row) => {
            const priceData = allPrices[row.mint];
            if (!priceData) return row;

            return {
              ...row,
              priceUsd: priceData.price,
              changePct24h: priceData.priceChange24hPct ?? undefined,
              volumeUsd24h: priceData.volume24h ?? undefined,
              marketCapUsd: priceData.mcap ?? undefined,
            };
          }),
        );

        setLoadingPrices(false);
      } catch (error) {
        console.error("Error fetching prices:", error);
        if (!cancelled) setLoadingPrices(false);
      }
    }

    fetchAllPrices();

    return () => {
      cancelled = true;
    };
  }, []); // Empty deps - only run once on mount

  const movers = useMemo(() => computeMovers(rows), [rows]);

  const categoriesForTabs = useMemo(() => {
    const set = new Set<TokenCategory>();
    for (const a of initialRows) {
      for (const c of a.categories ?? []) set.add(c);
    }

    const preferred: TokenCategory[] = ["Top MC", "Stocks", "PreMarket"];
    const preferredSet = new Set(preferred);

    const rest = Array.from(set)
      .filter((c) => !preferredSet.has(c))
      .sort((a, b) => a.localeCompare(b));

    const ordered = [...preferred.filter((c) => set.has(c)), ...rest];

    return ordered.map((c) => ({
      key: c,
      label: categoryLabel(c),
      count: initialRows.filter((a) => (a.categories ?? []).includes(c)).length,
    }));
  }, [initialRows]);

  const filtered = useMemo(() => {
    let filteredRows = rows;

    if (category !== "all") {
      filteredRows = filteredRows.filter((a) =>
        (a.categories ?? []).includes(category),
      );
    }

    filteredRows = applyPriceFilter(filteredRows, priceMode);
    filteredRows = applySort(filteredRows, sortMode);

    return filteredRows;
  }, [rows, category, priceMode, sortMode]);

  return (
    <div className="">
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">
        {/* Header */}
        <div className="mb-6">
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <div className="haven-kicker">Exchange</div>
              <div className="haven-title">Stocks</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Browse tokenized stocks and track moves in real-time.
              </div>
            </div>

            <div className="hidden md:block text-right">
              <div className="haven-kicker">Market</div>
              <div className="text-sm font-semibold text-foreground">
                {`${initialRows.length} assets`}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <SearchBar
              value={q}
              onChange={setQ}
              placeholder="Search GOOGL, TSLA, NVDA…"
              hint="Search by name or ticker"
              assets={rows}
              limit={8}
              onSelectAsset={() => setQ("")}
            />
          </div>
        </div>

        {/* Movers */}
        <div className="mb-8">
          <FeaturedMovers movers={movers} loading={loadingPrices} limit={5} />
        </div>

        {/* Browse */}
        <div className="mb-4 space-y-3">
          <CategoryTabs
            options={categoriesForTabs}
            value={category}
            onChange={setCategory}
          />

          <div className="haven-card-soft p-3">
            <FilterBar
              priceMode={priceMode}
              onPriceModeChange={setPriceMode}
              sortMode={sortMode}
              onSortModeChange={setSortMode}
            />
          </div>
        </div>

        {/* List */}
        <AssetList
          assets={filtered}
          emptyLabel="No matches. Try a different category or filter."
        />
      </div>
    </div>
  );
}
