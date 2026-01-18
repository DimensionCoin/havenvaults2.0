// app/(app)/stocks/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AssetList,
  CategoryTabs,
  FeaturedMovers,
  FilterBar,
  SearchBar,
  applyPriceFilter,
  applySort,
  type AssetRow,
  type Movers,
  type PriceFilterMode,
  type SortMode,
} from "@/components/exchange";
import type { TokenCategory } from "@/lib/tokenConfig";

/* ----------------------------- API types ----------------------------- */

type TokenSummary = {
  mint: string;
  symbol: string;
  name: string;
  logoURI: string;
  kind: "crypto" | "stock";
  categories: TokenCategory[];
  tags?: string[];
};

type TokensApiResponse = {
  cluster: "mainnet" | "devnet";
  tokens: TokenSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};

type JupPriceResponse = {
  prices: Record<
    string,
    {
      price: number;
      priceChange24hPct: number | null;
      mcap: number | null;
      fdv: number | null;
      liquidity: number | null;
      volume24h: number | null;
      marketCapRank: number | null;
    }
  >;
};

/* ----------------------------- helpers ----------------------------- */

function categoryLabel(c: TokenCategory): string {
  if (c === "Top MC") return "Top";
  if (c === "PreMarket") return "Pre";
  return c;
}

function toAssetRow(
  t: TokenSummary,
  quote?: JupPriceResponse["prices"][string]
): AssetRow {
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    logoURI: t.logoURI,
    kind: "stock",
    categories: t.categories ?? [],
    tags: t.tags ?? [],
    priceUsd: quote?.price ?? undefined,
    changePct24h: quote?.priceChange24hPct ?? undefined,
    volumeUsd24h: quote?.volume24h ?? undefined,
    marketCapUsd: quote?.mcap ?? undefined,
  };
}

function computeMovers(rows: AssetRow[]): Movers {
  const withChange = rows.filter(
    (r) => typeof r.changePct24h === "number" && Number.isFinite(r.changePct24h)
  );

  const gainers = [...withChange].sort(
    (a, b) => (b.changePct24h ?? -Infinity) - (a.changePct24h ?? -Infinity)
  );
  const losers = [...withChange].sort(
    (a, b) => (a.changePct24h ?? Infinity) - (b.changePct24h ?? Infinity)
  );

  return {
    gainers: gainers.slice(0, 10),
    losers: losers.slice(0, 10),
  };
}

/* ----------------------------- Page ----------------------------- */

export default function StockExchange() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [allAssets, setAllAssets] = useState<AssetRow[]>([]);

  // Search is ONLY for the combobox dropdown (does NOT filter the list)
  const [q, setQ] = useState("");

  // Browse controls (affect list)
  const [category, setCategory] = useState<TokenCategory | "all">("all");
  const [priceMode, setPriceMode] = useState<PriceFilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("featured");

  // avoid double fetch in dev strict mode
  const didLoadRef = useRef(false);

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1) Fetch stock token catalog
        const tokensRes = await fetch("/api/tokens?kind=stock&pageSize=200", {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!tokensRes.ok) {
          const text = await tokensRes.text().catch(() => "");
          throw new Error(
            `Failed to load stocks (${tokensRes.status}) ${text.slice(0, 200)}`
          );
        }

        const tokensJson = (await tokensRes.json()) as TokensApiResponse;
        const tokens = (tokensJson.tokens ?? []).filter(
          (t) => t.kind === "stock"
        );

        // 2) Fetch prices for all mints (<=100)
        const mints = tokens.map((t) => t.mint).filter(Boolean);

        const pricesRes = await fetch("/api/prices/jup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mints }),
        });

        if (!pricesRes.ok) {
          const text = await pricesRes.text().catch(() => "");
          throw new Error(
            `Failed to load prices (${pricesRes.status}) ${text.slice(0, 200)}`
          );
        }

        const pricesJson = (await pricesRes.json()) as JupPriceResponse;
        const byMint = pricesJson.prices ?? {};

        // 3) Merge to AssetRow
        const rows = tokens.map((t) => toAssetRow(t, byMint[t.mint]));
        setAllAssets(rows);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  const categoriesForTabs = useMemo(() => {
    // Stocks page: show stocks-ish categories (exclude crypto-only buckets)
    const allCatsSet = new Set<TokenCategory>();
    for (const a of allAssets) {
      for (const c of a.categories ?? []) {
        // 🚫 exclude crypto buckets from stock tabs
        if (
          c === "DeFi" ||
          c === "Infrastructure" ||
          c === "LST" ||
          c === "DePin" ||
          c === "Meme" ||
          c === "NFT" ||
          c === "Privacy" ||
          c === "Utility" ||
          c === "Gaming"
        )
          continue;

        allCatsSet.add(c);
      }
    }

    const allCats = Array.from(allCatsSet);

    // preferred order for stocks
    const preferred: TokenCategory[] = ["Top MC", "Stocks", "PreMarket"];
    const preferredSet = new Set<TokenCategory>(preferred);

    const ordered: TokenCategory[] = [
      ...preferred.filter((c) => allCatsSet.has(c)),
      ...allCats.filter((c) => !preferredSet.has(c)),
    ];

    return ordered.map((c) => ({
      key: c,
      label: categoryLabel(c),
      count: allAssets.filter((a) => (a.categories ?? []).includes(c)).length,
    }));
  }, [allAssets]);

  const movers: Movers = useMemo(() => computeMovers(allAssets), [allAssets]);

  // ✅ Browse list = only category + filters + sort (NOT q)
  const filtered: AssetRow[] = useMemo(() => {
    let rows = allAssets;

    if (category !== "all")
      rows = rows.filter((a) => a.categories.includes(category));

    rows = applyPriceFilter(rows, priceMode);
    rows = applySort(rows, sortMode);

    return rows;
  }, [allAssets, category, priceMode, sortMode]);

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
                {loading ? "Loading…" : `${allAssets.length} assets`}
              </div>
            </div>
          </div>

          {/* Search (combobox dropdown; does NOT filter list) */}
          <div className="mt-4">
            <SearchBar
              value={q}
              onChange={setQ}
              placeholder="Search GOOGL, TSLA, NVDA…"
              hint="Search by name or ticker"
              assets={allAssets}
              limit={8}
              onSelectAsset={(a) => {
                setQ("");
                console.log("selected:", a.symbol);
              }}
            />
          </div>
        </div>

        {/* Error state */}
        {error ? (
          <div className="mb-6 rounded-3xl border border-destructive/25 bg-destructive/10 p-4 shadow-fintech-sm">
            <div className="text-sm font-semibold text-foreground">
              Couldn’t load market
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{error}</div>
            <div className="mt-3 text-xs text-muted-foreground">
              Check <span className="font-mono">JUP_API_KEY</span> and keep your
              stock list under 100 mints.
            </div>
          </div>
        ) : null}

        {/* Movers */}
        <div className="mb-8">
          <FeaturedMovers movers={movers} loading={loading} limit={5} />
        </div>

        {/* Browse */}
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="haven-kicker">Browse</div>
            <div className="text-sm font-semibold text-foreground">
              {loading ? "Loading…" : `${filtered.length} results`}
            </div>
          </div>
        </div>

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
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <AssetList
            assets={filtered}
            emptyLabel="No matches. Try a different category or filter."
          />
        )}
      </div>
    </div>
  );
}

/* ----------------------------- skeleton ----------------------------- */

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="haven-row h-[74px] animate-pulse opacity-60" />
      ))}
    </div>
  );
}
