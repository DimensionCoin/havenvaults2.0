// hooks/useTokenRecommendations.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import { useWishlist } from "@/hooks/useWishlist";
import {
  buildTokenRecommendations,
  type TokenRecommendation,
} from "@/lib/recommendations";
import { getCluster, getMintFor } from "@/lib/tokenConfig";

export type TokenMarketSnapshot = {
  price: number;
  priceChange24hPct: number | null;
  mcap: number | null;
  fdv: number | null;
  liquidity: number | null;
  volume24h: number | null;
  marketCapRank: number | null;
};
export function useTokenRecommendations(): {
  loading: boolean;
  /** algo-based recs (no prices baked in) */
  recommendations: TokenRecommendation[];
  /** mint -> live market snapshot from Jupiter */
  marketByMint: Record<string, TokenMarketSnapshot>;
  /** just the Jup phase loading flag, if you want it separately */
  marketLoading: boolean;
} {
  const { user, loading: userLoading } = useUser();
  const { tokens, loading: balanceLoading } = useBalance();
  const { wishlist, loading: wishlistLoading } = useWishlist();

  const [marketByMint, setMarketByMint] = useState<
    Record<string, TokenMarketSnapshot>
  >({});
  const [marketLoading, setMarketLoading] = useState(false);

  const cluster = useMemo(() => getCluster(), []);

  // 1️⃣ Build recommendations (risk + portfolio + wishlist)
  const recommendations = useMemo(() => {
    if (!user) return [];
    return buildTokenRecommendations(user, tokens, {
      wishlistMints: wishlist,
    });
  }, [user, tokens, wishlist]);

  // 2️⃣ Fetch Jup data for just those recommended mints
  useEffect(() => {
    const mints = Array.from(
      new Set(
        recommendations
          .map((rec) => getMintFor(rec.token, cluster))
          .filter((m): m is string => !!m)
      )
    );

    if (!mints.length) {
      setMarketByMint({});
      setMarketLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setMarketLoading(true);

        const res = await fetch("/api/prices/jup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mints }),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          console.error("[useTokenRecommendations] Jup fetch failed:", txt);
          if (!cancelled) {
            setMarketByMint({});
          }
          return;
        }

        const json = (await res.json()) as {
          prices?: Record<string, TokenMarketSnapshot>;
        };

        if (cancelled) return;
        setMarketByMint(json.prices || {});
      } catch (e) {
        console.error("[useTokenRecommendations] Jup fetch error:", e);
        if (!cancelled) {
          setMarketByMint({});
        }
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recommendations, cluster]);

  // overall loading: algo + balances + wishlist + prices
  const loading =
    userLoading || balanceLoading || wishlistLoading || marketLoading;

  return {
    loading,
    recommendations,
    marketByMint,
    marketLoading,
  };
}
