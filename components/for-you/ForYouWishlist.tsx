// components/for-you/ForYouWishlist.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Star } from "lucide-react";

import { useWishlist } from "@/hooks/useWishlist";
import { getCluster, findTokenByMint, type TokenMeta } from "@/lib/tokenConfig";
import toast from "react-hot-toast";

type WishlistEntry = {
  mint: string;
  token: TokenMeta | null;
};

const getTokenSlug = (token: TokenMeta | null, mint: string) =>
  (token?.symbol || mint).toLowerCase();

export const ForYouWishlist: React.FC = () => {
  const { wishlist, loading: wishlistLoading } = useWishlist();
  const [localMints, setLocalMints] = useState<string[]>([]);
  const [removingMint, setRemovingMint] = useState<string | null>(null);

  // local copy so UI feels instant
  useEffect(() => {
    if (Array.isArray(wishlist)) {
      setLocalMints(wishlist);
    }
  }, [wishlist]);

  const cluster = useMemo(() => getCluster(), []);

  const entries: WishlistEntry[] = useMemo(() => {
    if (!localMints?.length) return [];
    return localMints.map((mint) => ({
      mint,
      token: findTokenByMint(mint, cluster) ?? null,
    }));
  }, [localMints, cluster]);

  const handleRemove = async (mint: string) => {
    if (!mint || removingMint) return;
    setRemovingMint(mint);

    try {
      const res = await fetch("/api/user/wishlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[wishlist] DELETE failed:", data);
        toast.error(data.error || "Could not update wishlist");
        return;
      }

      setLocalMints((prev) => prev.filter((m) => m !== mint));
      toast.success("Removed from wishlist", { duration: 1200 });
    } catch (e) {
      console.error("[wishlist] DELETE error:", e);
      toast.error("Could not update wishlist");
    } finally {
      setRemovingMint(null);
    }
  };

  const isEmpty = !wishlistLoading && entries.length === 0;

  return (
    <section className="mt-6 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Your wishlist</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Shortlisted tokens from your swipe deck.
          </p>
        </div>
        {entries.length > 0 && (
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400">
            {entries.length} saved
          </span>
        )}
      </div>

      {/* Strip container */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/90 px-3 py-2.5">
        {/* Skeleton state */}
        {wishlistLoading && !entries.length && (
          <div className="trending-scroll flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 w-40 animate-pulse rounded-2xl bg-zinc-900/80"
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="px-1 py-2 text-xs text-zinc-500">
            No tokens in your wishlist yet. Swipe right on ideas from the For
            you deck to save them here.
          </div>
        )}

        {/* Wishlist strip */}
        {!isEmpty && (
          <div className="trending-scroll -mx-1 flex gap-2 overflow-x-auto pb-1 pl-1 pr-3">
            {entries.map(({ mint, token }) => {
              const isRemoving = removingMint === mint;
              const symbol =
                token?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
              const name = token?.name ?? "Unknown token";
              const logo = token?.logo;
              const slug = getTokenSlug(token, mint);

              return (
                <div
                  key={mint}
                  className="relative flex w-44 shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/90 px-3 py-3"
                >
                  {/* wishlist star (toggle = remove) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      void handleRemove(mint);
                    }}
                    className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs transition ${
                      isRemoving
                        ? "border-zinc-700 bg-zinc-900/80 text-zinc-400"
                        : "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                    }`}
                  >
                    {isRemoving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Star className="h-3 w-3 fill-emerald-300 text-emerald-300" />
                    )}
                  </button>

                  <Link href={`/invest/${slug}`} className="block pt-1">
                    <div className="mb-2 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-zinc-800 bg-zinc-900 text-[10px] font-semibold text-zinc-200">
                        {logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logo}
                            alt={name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          symbol.slice(0, 3).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{symbol}</p>
                        <p className="truncate text-[11px] text-zinc-500">
                          {name}
                        </p>
                      </div>
                    </div>

                    <p className="text-[11px] text-zinc-500">
                      Tap to view on Exchange.
                    </p>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
