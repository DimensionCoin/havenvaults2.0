// app/(app)/invest/exchange/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Star, X } from "lucide-react";
import { IoIosArrowBack } from "react-icons/io";
import Link from "next/link";

import TokensTable from "@/components/exchange/TokensTable";
import TrendingStrip from "@/components/exchange/TrendingStrip";


import type {
  Token,
  PriceEntry,
  TokensApiResponse,
  PricesResponse,
} from "@/components/exchange/types";

import {
  TOKENS,
  type TokenCategory,
  type TokenMeta,
} from "@/lib/tokenConfig";

import { useBalance } from "@/providers/BalanceProvider";

// shadcn
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WishlistResponse = {
  wishlist: string[];
};


// derive category list once (from tokenConfig)
const CATEGORY_OPTIONS: TokenCategory[] = Array.from(
  new Set(
    TOKENS.flatMap((meta: TokenMeta) => meta.categories ?? []).filter(Boolean)
  )
).sort((a, b) => a.localeCompare(b));

const Exchange: React.FC = () => {
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(true);

  // main tokens
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);

  // trending tokens
  const [trendingTokens, setTrendingTokens] = useState<Token[]>([]);
  const [loadingTrendingTokens, setLoadingTrendingTokens] = useState(true);

  // prices map
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // pagination
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(25);

  // filters
  const [search, setSearch] = useState("");
  const [onlyWishlist, setOnlyWishlist] = useState(false);
  const [category, setCategory] = useState<"all" | TokenCategory>("all");

  // FX
  const { displayCurrency, fxRate } = useBalance();

  const wishlistSet = useMemo(() => new Set(wishlist), [wishlist]);

  // ───────────────── Wishlist load ─────────────────
  useEffect(() => {
    const loadWishlist = async () => {
      try {
        const res = await fetch("/api/user/wishlist", {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          setWishlist([]);
          return;
        }

        const data: WishlistResponse = await res.json();
        setWishlist(data.wishlist ?? []);
      } catch {
        setWishlist([]);
      } finally {
        setWishlistLoading(false);
      }
    };

    loadWishlist();
  }, []);

  // ───────────────── Tokens load (paged + searchable + category-aware) ─────────────────
  useEffect(() => {
    const controller = new AbortController();

    const loadTokens = async () => {
      try {
        setLoadingTokens(true);
        setError(null);

        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });

        if (search.trim()) params.set("q", search.trim());
        if (category !== "all") params.set("category", String(category));

        const res = await fetch(`/api/tokens?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "Failed to load tokens");
        }

        const data: TokensApiResponse = await res.json();
        setTokens(data.tokens || []);
        setHasMore(data.pagination?.hasMore || false);
        setTotal(data.pagination?.total || 0);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load tokens");
      } finally {
        setLoadingTokens(false);
      }
    };

    loadTokens();
    return () => controller.abort();
  }, [page, pageSize, search, category]);

  // ───────────────── Trending tokens (global) ─────────────────
  useEffect(() => {
    const controller = new AbortController();

    const loadTrendingTokens = async () => {
      try {
        setLoadingTrendingTokens(true);

        const params = new URLSearchParams({ page: "1", pageSize: "100" });
        const res = await fetch(`/api/tokens?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
        });

        if (!res.ok) {
          setTrendingTokens([]);
          return;
        }

        const data: TokensApiResponse = await res.json();
        setTrendingTokens(data.tokens || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setTrendingTokens([]);
      } finally {
        setLoadingTrendingTokens(false);
      }
    };

    loadTrendingTokens();
    return () => controller.abort();
  }, []);

  // ───────────────── Prices ─────────────────
  useEffect(() => {
    const controller = new AbortController();

    const loadPrices = async () => {
      const allTokensForPricing = [...tokens, ...trendingTokens];
      if (!allTokensForPricing.length) {
        setPrices({});
        return;
      }

      try {
        setLoadingPrices(true);

        const uniqueMints = Array.from(
          new Set(allTokensForPricing.map((t) => t.mint))
        );

        const res = await fetch("/api/prices/jup", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mints: uniqueMints }),
        });

        if (!res.ok) {
          setPrices({});
          return;
        }

        const data: PricesResponse = await res.json();
        setPrices(data.prices || {});
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setLoadingPrices(false);
      }
    };

    loadPrices();
    return () => controller.abort();
  }, [tokens, trendingTokens]);

  // ───────────────── Derived ─────────────────
  const displayedTokens = useMemo(() => {
    let base = tokens;
    if (onlyWishlist) base = base.filter((t) => wishlistSet.has(t.mint));
    return base;
  }, [tokens, onlyWishlist, wishlistSet]);

  const totalPages = useMemo(
    () => (total && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1),
    [total, pageSize]
  );

  const isTrendingLoading = loadingTrendingTokens || loadingPrices;

  
  // ───────────────── Wishlist toggle ─────────────────
  const handleToggleWishlist = async (
    mint: string,
    isCurrentlyWishlisted: boolean
  ) => {
    setWishlist((prev) => {
      if (isCurrentlyWishlisted) return prev.filter((m) => m !== mint);
      if (prev.includes(mint)) return prev;
      return [...prev, mint];
    });

    try {
      const method = isCurrentlyWishlisted ? "DELETE" : "POST";
      const res = await fetch("/api/user/wishlist", {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mint }),
      });

      if (!res.ok) {
        // revert
        setWishlist((prev) => {
          if (isCurrentlyWishlisted) return [...prev, mint];
          return prev.filter((m) => m !== mint);
        });
        return;
      }

      const data = (await res
        .json()
        .catch(() => null)) as WishlistResponse | null;
      if (data?.wishlist) setWishlist(data.wishlist);
    } catch {
      // revert
      setWishlist((prev) => {
        if (isCurrentlyWishlisted) return [...prev, mint];
        return prev.filter((m) => m !== mint);
      });
    }
  };

  
  const clearFilters = () => {
    setSearch("");
    setCategory("all");
    setOnlyWishlist(false);
    setPage(1);
  };

  const hasActiveFilters =
    !!search.trim() || category !== "all" || onlyWishlist;

  return (
    <div className="min-h-screen text-zinc-50">
      <div className="mx-auto flex flex-col px-2 pb-10 pt-2">
        <header className="mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Link href={"/invest"}>
              <IoIosArrowBack className="h-4 w-4" />
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Exchange
            </h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Track markets, discover top movers, and buy tokens directly from
            your Haven vault.
          </p>
        </header>

        <main className="rounded-3xl bg-black/25 p-1 sm:p-2">
          {/* ───────── Trending ───────── */}
          <section className="mt-3 sm:mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100 sm:text-base">
                  Trending
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Top movers across Haven markets (24h change)
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                24h · Top 5
              </span>
            </div>

            <TrendingStrip
              tokens={trendingTokens}
              prices={prices}
              wishlistSet={wishlistSet}
              isLoading={isTrendingLoading}
              onToggleWishlist={handleToggleWishlist}
              displayCurrency={displayCurrency}
              fxRate={fxRate}
            />
          </section>

          {/* ───────── All markets ───────── */}
          <section className="mt-6 sm:mt-8">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-zinc-100 sm:text-base">
                All markets
              </h2>
              <p className="text-[11px] text-zinc-500 sm:text-xs">
                Search, filter, star favorites, and tap a token to buy.
              </p>
            </div>

            {/* ✅ NEW: Compact sticky filter bar */}
            <div className="sticky top-2 z-10 mb-3">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-2 backdrop-blur-xl">
                {/* Row 1: search */}
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <Search className="h-4 w-4 text-zinc-500" />
                  </span>
                  <input
                    value={search}
                    onChange={(e) => {
                      setPage(1);
                      setSearch(e.target.value);
                    }}
                    placeholder="Search token (e.g. SOL, JUP, BONK)"
                    className="w-full rounded-full border border-zinc-800 bg-zinc-950/80 py-2 pl-9 pr-10 text-sm text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-2"
                  />

                  {search.trim() && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => {
                        setSearch("");
                        setPage(1);
                      }}
                      className="absolute inset-y-0 right-2 flex items-center rounded-full border border-zinc-800 bg-zinc-950/60 px-2 text-zinc-300 hover:bg-zinc-900"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Row 2: dropdown + favorites + clear */}
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  {/* Category */}
                  <div className="flex-1">
                    <Select
                      value={category}
                      onValueChange={(v) => {
                        setCategory(v as "all" | TokenCategory);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="h-10 w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 text-sm text-zinc-100">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                        <SelectItem value="all">All categories</SelectItem>
                        {CATEGORY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Favorites */}
                  <button
                    type="button"
                    disabled={wishlistLoading}
                    onClick={() => {
                      setOnlyWishlist((v) => !v);
                      setPage(1);
                    }}
                    className={[
                      "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-medium transition",
                      onlyWishlist
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                        : "border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-200",
                      wishlistLoading ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <Star className="h-4 w-4" />
                    Favorites
                    {!wishlistLoading && wishlist.length > 0 && (
                      <span className="ml-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-200">
                        {wishlist.length}
                      </span>
                    )}
                  </button>

                  {/* Clear */}
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="inline-flex h-10 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 text-sm text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Small “what’s active” hint (grandma-friendly) */}
                {hasActiveFilters && (
                  <div className="mt-2 flex flex-wrap gap-2 px-1 text-[11px] text-zinc-400">
                    {category !== "all" && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                        Category: {category}
                      </span>
                    )}
                    {onlyWishlist && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                        Favorites only
                      </span>
                    )}
                    {!!search.trim() && (
                      <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-200">
                        Search: “{search.trim()}”
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Your existing table */}
            <TokensTable
              tokens={tokens}
              displayedTokens={displayedTokens}
              prices={prices}
              wishlistSet={wishlistSet}
              wishlistCount={wishlist.length}
              total={total}
              onlyWishlist={onlyWishlist}
              loadingTokens={loadingTokens}
              loadingPrices={loadingPrices}
              error={error}
              page={page}
              totalPages={totalPages}
              hasMore={hasMore}
              onPageChange={setPage}
              onToggleWishlist={handleToggleWishlist}
              // keep these props so your table API doesn’t break
              category={category}
              onCategoryChange={(c) => {
                setCategory(c);
                setPage(1);
              }}
              displayCurrency={displayCurrency}
              fxRate={fxRate}
            />
          </section>

         
        </main>
      </div>
    </div>
  );
};

export default Exchange;
