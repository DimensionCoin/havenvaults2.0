// app/(app)/exchange/page.tsx
"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import Link from "next/link";
import { ChevronLeft, RefreshCw } from "lucide-react";

import SearchBar from "@/components/exchange/SearchBar";
import CategoryTabs from "@/components/exchange/CategoryTabs";
import SortDropdown, {
  type SortOption,
} from "@/components/exchange/SortDropdown";
import FeaturedMovers from "@/components/exchange/FeaturedMovers";
import MarketList from "@/components/exchange/MarketList";

import type {
  Token,
  PriceEntry,
  PricesResponse,
  MarketTab,
} from "@/components/exchange/types";

import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokenConfig";

import { useBalance } from "@/providers/BalanceProvider";

type WishlistResponse = { wishlist: string[] };

const CLUSTER = getCluster();
const PRICE_CHUNK = 100;

// Convert TokenMeta to Token
const toToken = (meta: TokenMeta): Token | null => {
  const mint = getMintFor(meta, CLUSTER);
  if (!mint) return null;
  return {
    mint,
    symbol: meta.symbol ?? "",
    name: meta.name ?? meta.symbol ?? "Unknown",
    logoURI: meta.logo ?? undefined,
    kind: meta.kind,
    tags: meta.tags,
    categories: meta.categories,
  };
};

// Build full catalog from tokenConfig
const CATALOG: Token[] = TOKENS.map(toToken).filter((t): t is Token =>
  Boolean(t)
);

export default function ExchangePage() {
  // State
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<MarketTab>("all");
  const [sortOption, setSortOption] = useState<SortOption>("trending");

  // Providers
  const { displayCurrency, fxRate } = useBalance();

  const wishlistSet = useMemo(() => new Set(wishlist), [wishlist]);
  const priceReqId = useRef(0);

  // ───────────────── Load wishlist ─────────────────
  useEffect(() => {
    const loadWishlist = async () => {
      try {
        const res = await fetch("/api/user/wishlist", {
          method: "GET",
          credentials: "include",
        });
        if (res.ok) {
          const data: WishlistResponse = await res.json();
          setWishlist(data.wishlist ?? []);
        }
      } catch {
        // Silent fail
      } finally {
        setWishlistLoading(false);
      }
    };
    loadWishlist();
  }, []);

  // ───────────────── Toggle wishlist ─────────────────
  const handleToggleWishlist = useCallback(
    async (mint: string, isWishlisted: boolean) => {
      // Optimistic update
      setWishlist((prev) =>
        isWishlisted ? prev.filter((m) => m !== mint) : [...prev, mint]
      );

      try {
        const res = await fetch("/api/user/wishlist", {
          method: isWishlisted ? "DELETE" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mint }),
        });

        if (!res.ok) {
          // Revert on failure
          setWishlist((prev) =>
            isWishlisted ? [...prev, mint] : prev.filter((m) => m !== mint)
          );
        }
      } catch {
        // Revert on error
        setWishlist((prev) =>
          isWishlisted ? [...prev, mint] : prev.filter((m) => m !== mint)
        );
      }
    },
    []
  );

  // ───────────────── Filter tokens ─────────────────
  const filteredTokens = useMemo(() => {
    let list = CATALOG;

    // Filter by tab
    if (activeTab === "favorites") {
      list = list.filter((t) => wishlistSet.has(t.mint));
    } else if (activeTab !== "all") {
      // Filter by category
      list = list.filter((t) => t.categories?.includes(activeTab) ?? false);
    }

    // Filter by search (symbol, name, tags, categories)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const sym = (t.symbol || "").toLowerCase();
        const name = (t.name || "").toLowerCase();
        const tags = t.tags || [];
        const categories = t.categories || [];

        return (
          sym.includes(q) ||
          name.includes(q) ||
          tags.some((tag) => tag.toLowerCase().includes(q)) ||
          categories.some((cat) => cat.toLowerCase().includes(q))
        );
      });
    }

    return list;
  }, [activeTab, wishlistSet, search]);

  // ───────────────── Load prices ─────────────────
  const loadPrices = useCallback(
    async (mints: string[], force = false) => {
      if (mints.length === 0) return;

      const myReq = ++priceReqId.current;
      const controller = new AbortController();

      if (force) {
        setRefreshing(true);
      } else {
        setLoadingPrices(true);
      }

      try {
        const next: Record<string, PriceEntry> = force ? {} : { ...prices };

        for (let i = 0; i < mints.length; i += PRICE_CHUNK) {
          if (priceReqId.current !== myReq) return;

          const chunk = mints.slice(i, i + PRICE_CHUNK);
          const res = await fetch("/api/prices/jup", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mints: chunk }),
          });

          if (res.ok) {
            const data: PricesResponse = await res.json();
            Object.assign(next, data.prices || {});
          }
        }

        if (priceReqId.current === myReq) {
          setPrices(next);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        if (priceReqId.current === myReq) {
          setLoadingPrices(false);
          setRefreshing(false);
        }
      }

      return () => controller.abort();
    },
    [prices]
  );

  // Load all prices on mount
  useEffect(() => {
    const mints = CATALOG.map((t) => t.mint);
    loadPrices(mints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────── Sort tokens ─────────────────
  const sortedTokens = useMemo(() => {
    const list = [...filteredTokens];

    const getPrice = (mint: string) => prices[mint]?.price ?? 0;
    const getChange = (mint: string) => prices[mint]?.priceChange24hPct ?? 0;

    switch (sortOption) {
      case "gainers":
        list.sort((a, b) => getChange(b.mint) - getChange(a.mint));
        break;
      case "losers":
        list.sort((a, b) => getChange(a.mint) - getChange(b.mint));
        break;
      case "price-high":
        list.sort((a, b) => getPrice(b.mint) - getPrice(a.mint));
        break;
      case "price-low":
        list.sort((a, b) => getPrice(a.mint) - getPrice(b.mint));
        break;
      case "name":
        list.sort((a, b) =>
          (a.name || a.symbol || "").localeCompare(b.name || b.symbol || "")
        );
        break;
      case "trending":
      default:
        list.sort(
          (a, b) => Math.abs(getChange(b.mint)) - Math.abs(getChange(a.mint))
        );
        break;
    }

    return list;
  }, [filteredTokens, prices, sortOption]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    const mints = CATALOG.map((t) => t.mint);
    loadPrices(mints, true);
  }, [loadPrices]);

  const showMovers = activeTab === "all" && !search.trim();
  const isInitialLoading =
    wishlistLoading || (loadingPrices && Object.keys(prices).length === 0);

  return (
    <div className="min-h-screen text-zinc-50">
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-4">
        {/* Header */}
        <header className="mb-5">
          <div className="flex items-center gap-3">
            <Link
              href="/invest"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 transition-colors hover:bg-zinc-800"
            >
              <ChevronLeft className="h-5 w-5 text-zinc-400" />
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight">Markets</h1>
              <p className="text-sm text-zinc-500">
                {CATALOG.length} assets available
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 transition-colors hover:bg-zinc-800 disabled:opacity-50"
              aria-label="Refresh prices"
            >
              <RefreshCw
                className={`h-5 w-5 text-zinc-400 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </header>

        {/* Search */}
        <div className="mb-4">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search name, symbol, or tag..."
          />
        </div>

        {/* Category Tabs */}
        <div className="mb-5">
          <CategoryTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            favoritesCount={wishlist.length}
          />
        </div>

        {/* Featured Movers */}
        {showMovers && Object.keys(prices).length > 0 && (
          <div className="mb-6">
            <FeaturedMovers
              tokens={CATALOG}
              prices={prices}
              displayCurrency={displayCurrency}
              fxRate={fxRate}
            />
          </div>
        )}

        {/* Results count + Sort */}
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            {sortedTokens.length === 0 ? (
              "No results"
            ) : (
              <>
                <span className="font-medium text-zinc-300">
                  {sortedTokens.length}
                </span>{" "}
                {sortedTokens.length === 1 ? "market" : "markets"}
              </>
            )}
          </p>
          <SortDropdown value={sortOption} onChange={setSortOption} />
        </div>

        {/* Market List */}
        <MarketList
          tokens={sortedTokens}
          prices={prices}
          wishlistSet={wishlistSet}
          onToggleWishlist={handleToggleWishlist}
          displayCurrency={displayCurrency}
          fxRate={fxRate}
          loading={isInitialLoading}
          emptyMessage={
            activeTab === "favorites" ? "No favorites yet" : "No markets found"
          }
        />

        {/* Currency indicator */}
        <p className="mt-8 text-center text-xs text-zinc-600">
          Prices in {displayCurrency}
        </p>
      </div>
    </div>
  );
}
