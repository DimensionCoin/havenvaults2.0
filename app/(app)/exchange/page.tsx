// app/(app)/exchange/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Star, X, ArrowUpDown } from "lucide-react";
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
  getCluster,
  getMintFor,
  type TokenCategory,
  type TokenMeta,
} from "@/lib/tokenConfig";

import { useBalance } from "@/providers/BalanceProvider";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type WishlistResponse = { wishlist: string[] };
type SortKey = "trending" | "change24h" | "price" | "az" | "za";

const CLUSTER = getCluster();
const PRICE_CHUNK = 120; // safe chunk size for your /api/prices/jup

const CATEGORY_OPTIONS: TokenCategory[] = Array.from(
  new Set(
    TOKENS.flatMap((meta: TokenMeta) => meta.categories ?? []).filter(
      (c): c is TokenCategory => Boolean(c)
    )
  )
).sort((a, b) => a.localeCompare(b));

const toTokenFromMeta = (meta: TokenMeta): Token | null => {
  const mint = getMintFor(meta, CLUSTER);
  if (!mint) return null;
  return {
    mint,
    symbol: meta.symbol ?? "",
    name: meta.name ?? meta.symbol ?? "Unknown",
    logoURI: meta.logo ?? null,
  };
};

const Exchange: React.FC = () => {
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(true);

  const [trendingTokens, setTrendingTokens] = useState<Token[]>([]);
  const [loadingTrendingTokens, setLoadingTrendingTokens] = useState(true);

  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // client pagination (global)
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);

  // filters
  const [search, setSearch] = useState("");
  const [onlyWishlist, setOnlyWishlist] = useState(false);
  const [category, setCategory] = useState<"all" | TokenCategory>("all");
  const [sortKey, setSortKey] = useState<SortKey>("trending");

  const { displayCurrency, fxRate } = useBalance();
  const wishlistSet = useMemo(() => new Set(wishlist), [wishlist]);

  // FULL catalog (this is your “Amazon catalog”)
  const catalog: Token[] = useMemo(() => {
    return TOKENS.map(toTokenFromMeta).filter((t): t is Token => Boolean(t));
  }, []);

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

  // ───────────────── Trending tokens (still from API) ─────────────────
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

  const handleToggleWishlist = async (mint: string, isWishlisted: boolean) => {
    try {
      const res = await fetch("/api/user/wishlist", {
        method: isWishlisted ? "DELETE" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      });

      if (!res.ok) return;

      setWishlist((prev) =>
        isWishlisted ? prev.filter((m) => m !== mint) : [...prev, mint]
      );
    } catch {
      // silent fail – UX shouldn’t break
    }
  };


  // ───────────────── Filter catalog globally ─────────────────
  const filtered: Token[] = useMemo(() => {
    let list = catalog;

    if (onlyWishlist) list = list.filter((t) => wishlistSet.has(t.mint));

    if (category !== "all") {
      // category is narrowed to TokenCategory here (no `any`)
      const allowedMints = new Set(
        TOKENS.filter((m) => (m.categories ?? []).includes(category))
          .map((m) => getMintFor(m, CLUSTER))
          .filter((x): x is string => Boolean(x))
      );
      list = list.filter((t) => allowedMints.has(t.mint));
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const sym = (t.symbol || "").toLowerCase();
        const nm = (t.name || "").toLowerCase();
        const mint = (t.mint || "").toLowerCase();
        return sym.includes(q) || nm.includes(q) || mint.includes(q);
      });
    }

    return list;
  }, [catalog, onlyWishlist, wishlistSet, category, search]);

  // If you change filters/sort, always go back to page 1
  useEffect(() => {
    setPage(1);
  }, [search, category, onlyWishlist, sortKey]);

  // ───────────────── Price loading for sorting across WHOLE list ─────────────────
  const priceReqId = useRef(0);

  useEffect(() => {
    const needsPricesForSort =
      sortKey === "price" || sortKey === "change24h" || sortKey === "trending";
    const mints = filtered.map((t) => t.mint);

    const requiredMints = Array.from(
      new Set([...mints, ...trendingTokens.map((t) => t.mint)])
    );

    if (requiredMints.length === 0) {
      setPrices({});
      return;
    }

    const targetMints = needsPricesForSort
      ? requiredMints
      : Array.from(
          new Set([
            ...trendingTokens.map((t) => t.mint),
            ...filtered
              .slice((page - 1) * pageSize, page * pageSize)
              .map((t) => t.mint),
          ])
        );

    const myReq = ++priceReqId.current;
    const controller = new AbortController();

    const fetchChunk = async (chunk: string[]) => {
      const res = await fetch("/api/prices/jup", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mints: chunk }),
      });
      if (!res.ok) return {} as Record<string, PriceEntry>;
      const data: PricesResponse = await res.json();
      return data.prices || {};
    };

    const loadPrices = async () => {
      try {
        setLoadingPrices(true);
        setError(null);

        const next: Record<string, PriceEntry> = needsPricesForSort
          ? {}
          : { ...prices };

        for (let i = 0; i < targetMints.length; i += PRICE_CHUNK) {
          if (priceReqId.current !== myReq) return;
          const chunk = targetMints.slice(i, i + PRICE_CHUNK);
          const got = await fetchChunk(chunk);
          Object.assign(next, got);
        }

        if (priceReqId.current !== myReq) return;
        setPrices(next);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // don’t hard fail UI for pricing issues
      } finally {
        if (priceReqId.current === myReq) setLoadingPrices(false);
      }
    };

    loadPrices();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, trendingTokens, sortKey, page, pageSize]);

  // ───────────────── Global sort (entire filtered list) ─────────────────
  const sorted: Token[] = useMemo(() => {
    const list = [...filtered];

    const getPrice = (mint: string) => prices[mint]?.price ?? -Infinity;
    const getChg = (mint: string) =>
      prices[mint]?.priceChange24hPct ?? -Infinity;

    list.sort((a, b) => {
      if (sortKey === "az") {
        return (a.symbol || a.name || "").localeCompare(
          b.symbol || b.name || ""
        );
      }
      if (sortKey === "za") {
        return (b.symbol || b.name || "").localeCompare(
          a.symbol || a.name || ""
        );
      }
      if (sortKey === "price") {
        return getPrice(b.mint) - getPrice(a.mint);
      }
      if (sortKey === "change24h") {
        return getChg(b.mint) - getChg(a.mint);
      }

      // trending: abs change desc, then price desc
      const absA = Math.abs(getChg(a.mint));
      const absB = Math.abs(getChg(b.mint));
      if (absB !== absA) return absB - absA;
      return getPrice(b.mint) - getPrice(a.mint);
    });

    return list;
  }, [filtered, prices, sortKey]);

  // ───────────────── Client pagination AFTER global sort ─────────────────
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageClamped = Math.min(Math.max(1, page), totalPages);

  const rows = useMemo(() => {
    const start = (pageClamped - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, pageClamped, pageSize]);

  const clearFilters = () => {
    setSearch("");
    setCategory("all");
    setOnlyWishlist(false);
    setSortKey("trending");
    setPage(1);
  };

  const hasActiveFilters =
    !!search.trim() ||
    category !== "all" ||
    onlyWishlist ||
    sortKey !== "trending";

  const isTrendingLoading = loadingTrendingTokens || loadingPrices;

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
            Discover markets, favorite assets, and trade with your Cash balance.
          </p>
        </header>

        <main className="rounded-3xl bg-black/25 p-1 sm:p-2">
          {/* Trending */}
          <section className="mt-3 sm:mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100 sm:text-base">
                  Trending
                </h2>
                <p className="text-[11px] text-zinc-500">
                  Top movers across markets (24h change)
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

          {/* Markets */}
          <section className="mt-6 sm:mt-8">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-zinc-100 sm:text-base">
                Markets
              </h2>
              <p className="text-[11px] text-zinc-500 sm:text-xs">
                Search, filter, favorite, and tap a market to trade.
              </p>
            </div>

            {/* Filter bar */}
            <div className="sticky top-2 z-10 mb-3">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-2 backdrop-blur-xl">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <Search className="h-4 w-4 text-zinc-500" />
                  </span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search (SOL, JUP, BONK, …)"
                    className="w-full rounded-full border border-zinc-800 bg-zinc-950/80 py-2 pl-9 pr-10 text-sm text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-2"
                  />
                  {search.trim() && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearch("")}
                      className="absolute inset-y-0 right-2 flex items-center rounded-full border border-zinc-800 bg-zinc-950/60 px-2 text-zinc-300 hover:bg-zinc-900"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <Select
                      value={category}
                      onValueChange={(v: string) =>
                        setCategory(v === "all" ? "all" : (v as TokenCategory))
                      }
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

                  <div className="flex-1 sm:max-w-[220px]">
                    <Select
                      value={sortKey}
                      onValueChange={(v: string) => setSortKey(v as SortKey)}
                    >
                      <SelectTrigger className="h-10 w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 text-sm text-zinc-100">
                        <span className="mr-2 inline-flex items-center gap-2 text-zinc-300">
                          <ArrowUpDown className="h-4 w-4" />
                        </span>
                        <SelectValue placeholder="Sort" />
                      </SelectTrigger>
                      <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                        <SelectItem value="trending">Trending</SelectItem>
                        <SelectItem value="change24h">24h change</SelectItem>
                        <SelectItem value="price">Price</SelectItem>
                        <SelectItem value="az">A → Z</SelectItem>
                        <SelectItem value="za">Z → A</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <button
                    type="button"
                    disabled={wishlistLoading}
                    onClick={() => setOnlyWishlist((v) => !v)}
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
              </div>
            </div>

            <TokensTable
              rows={rows}
              prices={prices}
              wishlistSet={wishlistSet}
              wishlistCount={wishlist.length}
              total={total}
              onlyWishlist={onlyWishlist}
              loading={wishlistLoading}
              loadingPrices={loadingPrices}
              error={error}
              page={pageClamped}
              totalPages={totalPages}
              onPageChange={setPage}
              onToggleWishlist={() => {}}
              category={category}
              displayCurrency={displayCurrency}
              fxRate={fxRate ?? 1}
            />
          </section>
        </main>
      </div>
    </div>
  );
};

export default Exchange;
