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
const PAGE_SIZE = 20;

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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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
      // activeTab is a TokenCategory - filter by category
      const category = activeTab;
      list = list.filter((t) => {
        const meta = TOKENS.find((m) => getMintFor(m, CLUSTER) === t.mint);
        return meta?.categories?.includes(category) ?? false;
      });
    }

    // Filter by search (symbol, name, AND tags)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const sym = (t.symbol || "").toLowerCase();
        const name = (t.name || "").toLowerCase();

        // Check if any tag matches the search query
        const tags = t.tags || [];
        const tagMatch = tags.some((tag) => tag.toLowerCase().includes(q));

        // Also check categories from tokenConfig
        const meta = TOKENS.find((m) => getMintFor(m, CLUSTER) === t.mint);
        const categories = meta?.categories || [];
        const categoryMatch = categories.some((cat) =>
          cat.toLowerCase().includes(q)
        );

        return sym.includes(q) || name.includes(q) || tagMatch || categoryMatch;
      });
    }

    return list;
  }, [activeTab, wishlistSet, search]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, activeTab, sortOption]);

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

  // Load prices for visible tokens
  useEffect(() => {
    const mints = filteredTokens.map((t) => t.mint);
    loadPrices(mints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTokens.length]);

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
        // Sort by absolute change (most volatile first)
        list.sort(
          (a, b) => Math.abs(getChange(b.mint)) - Math.abs(getChange(a.mint))
        );
        break;
    }

    return list;
  }, [filteredTokens, prices, sortOption]);

  // Get visible tokens (for infinite scroll)
  const visibleTokens = useMemo(() => {
    return sortedTokens.slice(0, visibleCount);
  }, [sortedTokens, visibleCount]);

  // Load more handler
  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, sortedTokens.length));
  }, [sortedTokens.length]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    const mints = filteredTokens.map((t) => t.mint);
    loadPrices(mints, true);
  }, [filteredTokens, loadPrices]);

  const hasMore = visibleCount < sortedTokens.length;
  const showMovers = activeTab === "all" && !search.trim();

  return (
    <div className="min-h-screen  text-zinc-50">
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-4">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/invest"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 transition-colors hover:bg-zinc-800"
              >
                <ChevronLeft className="h-5 w-5 text-zinc-400" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Markets</h1>
                <p className="text-sm text-zinc-500">
                  {CATALOG.length} assets available
                </p>
              </div>
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
            placeholder="Search by name, symbol, or tag (e.g. DEX, AI, Meme)..."
          />
        </div>

        {/* Category Tabs */}
        <div className="mb-6">
          <CategoryTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            favoritesCount={wishlist.length}
          />
        </div>

        {/* Featured Movers (only on "All" tab without search) */}
        {showMovers && (
          <div className="mb-8">
            <FeaturedMovers
              tokens={CATALOG}
              prices={prices}
              displayCurrency={displayCurrency}
              fxRate={fxRate}
              loading={loadingPrices && Object.keys(prices).length === 0}
            />
          </div>
        )}

        {/* Sort & Count */}
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-zinc-500">
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
          </div>
          <SortDropdown value={sortOption} onChange={setSortOption} />
        </div>

        {/* Market List */}
        <MarketList
          tokens={visibleTokens}
          prices={prices}
          wishlistSet={wishlistSet}
          onToggleWishlist={handleToggleWishlist}
          displayCurrency={displayCurrency}
          fxRate={fxRate}
          loading={
            wishlistLoading ||
            (loadingPrices && Object.keys(prices).length === 0)
          }
          emptyMessage={
            activeTab === "favorites"
              ? "No favorites yet. Star an asset to add it here."
              : "No markets match your search"
          }
        />

        {/* Load More */}
        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMore}
              className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              Load more ({sortedTokens.length - visibleCount} remaining)
            </button>
          </div>
        )}

        {/* Currency indicator */}
        <div className="mt-8 text-center text-xs text-zinc-600">
          Prices shown in {displayCurrency}
        </div>
      </div>
    </div>
  );
}
