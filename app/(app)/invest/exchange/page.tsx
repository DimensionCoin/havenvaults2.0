// app/(app)/invest/exchange/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { IoIosArrowBack } from "react-icons/io";
import TokensTable from "@/components/exchange/TokensTable";
import AdsCarousel from "@/components/exchange/advertisement/AdsCarousel";
import LSTYieldAd from "@/components/exchange/advertisement/adds/LSTYieldAd";
import TrendingStrip from "@/components/exchange/TrendingStrip";
import InstantTradesAd from "@/components/exchange/advertisement/adds/InstantTradesAd";
import AmplifyTop3Ad from "@/components/exchange/advertisement/adds/AmplifyTop3Ad";

import type {
  Token,
  PriceEntry,
  TokensApiResponse,
  PricesResponse,
} from "@/components/exchange/types";
import type { TokenCategory } from "@/lib/tokenConfig";
import Link from "next/link";

import { useBalance } from "@/providers/BalanceProvider";

type WishlistResponse = {
  wishlist: string[];
};

const Exchange: React.FC = () => {
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(true);

  // main table tokens (paged + searchable)
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);

  // trending tokens (independent of search)
  const [trendingTokens, setTrendingTokens] = useState<Token[]>([]);
  const [loadingTrendingTokens, setLoadingTrendingTokens] = useState(true);

  // shared prices map (covers both tokens + trendingTokens)
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(25);

  const [search, setSearch] = useState("");
  const [onlyWishlist, setOnlyWishlist] = useState(false);

  // 🔑 Category filter (“all”, “LST”, “DeFi”, “Stocks”, etc.)
  const [category, setCategory] = useState<"all" | TokenCategory>("all");

  // FX
  const { displayCurrency, fxRate } = useBalance();

  // ───────────────── Wishlist load ─────────────────
  useEffect(() => {
    const loadWishlist = async () => {
      try {
        const res = await fetch("/api/user/wishlist", {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          console.error("Wishlist load failed:", res.status);
          setWishlist([]);
          return;
        }

        const data: WishlistResponse = await res.json();
        setWishlist(data.wishlist ?? []);
      } catch (err) {
        console.error("Error loading wishlist:", err);
        setWishlist([]);
      } finally {
        setWishlistLoading(false);
      }
    };

    loadWishlist();
  }, []);

  // ───────────────── Tokens load (paged + searchable + ✅ category-aware) ─────────────────
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

        if (search.trim()) {
          params.set("q", search.trim());
        }

        // ✅ NEW: send category to API so pagination/total works per category
        if (category !== "all") {
          params.set("category", String(category));
        }

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
        console.error("Error loading tokens:", err);
        const message =
          err instanceof Error ? err.message : "Something went wrong loading tokens";
        setError(message);
      } finally {
        setLoadingTokens(false);
      }
    };

    loadTokens();

    return () => controller.abort();
    // ✅ NEW: include category so we refetch when filter changes
  }, [page, pageSize, search, category]);

  // ───────────────── Trending tokens load (keep global; ignore category) ─────────────────
  useEffect(() => {
    const controller = new AbortController();

    const loadTrendingTokens = async () => {
      try {
        setLoadingTrendingTokens(true);

        const params = new URLSearchParams({
          page: "1",
          pageSize: "100",
        });

        const res = await fetch(`/api/tokens?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
        });

        if (!res.ok) {
          console.error(
            "Trending tokens load failed:",
            res.status,
            await res.text().catch(() => "")
          );
          setTrendingTokens([]);
          return;
        }

        const data: TokensApiResponse = await res.json();
        setTrendingTokens(data.tokens || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Error loading trending tokens:", err);
        setTrendingTokens([]);
      } finally {
        setLoadingTrendingTokens(false);
      }
    };

    loadTrendingTokens();

    return () => controller.abort();
  }, []);

  // ───────────────── Prices (USD) ─────────────────
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
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mints: uniqueMints }),
        });

        if (!res.ok) {
          console.error("Failed to load prices from Jup:", res.status);
          setPrices({});
          return;
        }

        const data: PricesResponse = await res.json();
        setPrices(data.prices || {});
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Error loading prices:", err);
      } finally {
        setLoadingPrices(false);
      }
    };

    loadPrices();

    return () => controller.abort();
  }, [tokens, trendingTokens]);

  // ───────────────── Derived data ─────────────────
  const wishlistSet = useMemo(() => new Set(wishlist), [wishlist]);

  const lstTokens = useMemo(() => {
    const all = [...tokens, ...trendingTokens];
    const uniqueByMint = new Map<string, Token>();

    for (const t of all) {
      if ((t.category || "").toUpperCase() !== "LST") continue;
      if (!uniqueByMint.has(t.mint)) uniqueByMint.set(t.mint, t);
    }

    return Array.from(uniqueByMint.values());
  }, [tokens, trendingTokens]);

  // ✅ Now that server filters by category, displayedTokens should only handle wishlist
  const displayedTokens = useMemo(() => {
    let base = tokens;
    if (onlyWishlist) base = base.filter((t) => wishlistSet.has(t.mint));
    return base;
  }, [tokens, onlyWishlist, wishlistSet]);

  const totalPages = useMemo(
    () => (total && pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1),
    [total, pageSize]
  );

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
        console.error(
          "Wishlist update failed:",
          res.status,
          await res.text().catch(() => "")
        );
        // revert
        setWishlist((prev) => {
          if (isCurrentlyWishlisted) {
            if (prev.includes(mint)) return prev;
            return [...prev, mint];
          }
          return prev.filter((m) => m !== mint);
        });
        return;
      }

      const data = (await res
        .json()
        .catch(() => null)) as WishlistResponse | null;

      if (data?.wishlist) setWishlist(data.wishlist);
    } catch (err) {
      console.error("Error toggling wishlist:", err);
      // revert
      setWishlist((prev) => {
        if (isCurrentlyWishlisted) {
          if (prev.includes(mint)) return prev;
          return [...prev, mint];
        }
        return prev.filter((m) => m !== mint);
      });
    }
  };

  // when user taps the LST ad: set category + reset to page 1
  const handleFilterLSTs = useCallback(() => {
    setCategory("LST" as TokenCategory);
    setPage(1);
  }, []);

  // when user hits a category pill inside TokensTable
  const handleCategoryChange = useCallback((cat: "all" | TokenCategory) => {
    setCategory(cat);
    setPage(1);
  }, []);

  const ads = useMemo(
    () => [
      <LSTYieldAd
        key="lst-yield"
        lstTokens={lstTokens}
        onFilterLSTs={handleFilterLSTs}
      />,
      <InstantTradesAd
        key="instant-trades"
        tokens={trendingTokens.length ? trendingTokens : tokens}
      />,
      <AmplifyTop3Ad
        key="amplify-top3"
        tokens={trendingTokens.length ? trendingTokens : tokens}
      />,
    ],
    [lstTokens, handleFilterLSTs, trendingTokens, tokens]
  );

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
            Track markets, discover top movers, and buy Solana tokens directly
            from your Haven vault.
          </p>
        </header>

        <main className="rounded-3xl bg-black/25 p-1 sm:p-2">
          <AdsCarousel items={ads} />

          <section className="mt-6 sm:mt-8">
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

          <section className="mt-6 sm:mt-8">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100 sm:text-base">
                  All markets
                </h2>
                <p className="text-[11px] text-zinc-500 sm:text-xs">
                  Search Solana tokens, star your favorites, and tap to open the
                  buy flow.
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <div className="relative flex-1 sm:w-64">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                    <Search className="h-4 w-4 text-zinc-500" />
                  </span>
                  <input
                    value={search}
                    onChange={(e) => {
                      setPage(1);
                      setSearch(e.target.value);
                    }}
                    placeholder="Search by name or symbol"
                    className="w-full rounded-full border border-zinc-800 bg-zinc-950/80 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none ring-emerald-500/30 placeholder:text-zinc-500 focus:border-emerald-500 focus:ring-2"
                  />
                </div>

                <button
                  type="button"
                  disabled={wishlistLoading || !wishlist.length}
                  onClick={() => setOnlyWishlist((v) => !v)}
                  className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition ${
                    onlyWishlist
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                      : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-200"
                  } ${wishlistLoading ? "opacity-60" : ""}`}
                >
                  <Star className="mr-1 h-3 w-3" />
                  {wishlistLoading
                    ? "Loading wishlist..."
                    : wishlist.length
                    ? onlyWishlist
                      ? "Showing wishlist"
                      : "Wishlist only"
                    : "Wishlist (empty)"}
                </button>
              </div>
            </div>

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
              category={category}
              onCategoryChange={handleCategoryChange}
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
