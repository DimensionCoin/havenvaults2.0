// hooks/useWishlist.ts
"use client";

import { useEffect, useMemo, useState } from "react";

type WishlistState = {
  wishlist: string[];
  loading: boolean;
  error: string | null;
};

export function useWishlist(): WishlistState {
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/user/wishlist", {
          method: "GET",
          cache: "no-store",
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Failed to fetch wishlist"
          );
        }

        const data = (await res.json()) as { wishlist?: string[] };
        if (!alive) return;

        setWishlist(Array.isArray(data.wishlist) ? data.wishlist : []);
      } catch (err) {
        if (!alive) return;
        console.error("[useWishlist] error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch wishlist"
        );
      } finally {
        if (alive) setLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(
    () => ({
      wishlist,
      loading,
      error,
    }),
    [wishlist, loading, error]
  );
}
