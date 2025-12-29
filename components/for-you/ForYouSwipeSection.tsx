// components/for-you/ForYouSwipeSection.tsx
"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";

import { useTokenRecommendations } from "@/hooks/useTokenRecommendations";
import { ForYouSwipeDeck } from "@/components/for-you/ForYouSwipeDeck";
import { Button } from "@/components/ui/button";

export const ForYouSwipeSection: React.FC = () => {
  const { loading, recommendations, marketByMint, marketLoading } =
    useTokenRecommendations();

  const [deckOpen, setDeckOpen] = useState(false);

  const hasRecs = recommendations.length > 0;

  // 🧠 State 1: still computing recs
  if (loading && !hasRecs) {
    return (
      <main className="flex-1 rounded-3xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.9)] sm:p-5">
        <div className="flex flex-col items-center justify-center text-sm text-zinc-300">
          <div className="mb-1 text-xs uppercase tracking-[0.22em] text-zinc-500">
            GATHERING SIGNALS
          </div>
          <div>We&apos;re scanning your wallet and profile for ideas…</div>
          <div className="mt-2 text-[11px] text-zinc-500">
            This runs on Haven and doesn&apos;t move any funds.
          </div>
        </div>
      </main>
    );
  }

  // 🧠 State 2: no recs yet
  if (!loading && !hasRecs) {
    return (
      <main className="flex-1 rounded-3xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.9)] sm:p-5">
        <div className="flex h-40 flex-col items-center justify-center text-sm text-zinc-300">
          <div>No suggestions yet.</div>
          <div className="mt-1 text-[11px] text-zinc-500">
            Try buying your first asset on the Exchange tab. As your wallet
            changes, this feed will unlock.
          </div>
        </div>
      </main>
    );
  }

  // 🧠 State 3: we have recommendations
  return (
    <>
      {/* Main card shell with banner */}
        <main className="mb-3 sm:mb-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black/80 px-3 py-2 sm:px-4 sm:py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  Your Haven mix
                </div>
              </div>
              <p className="mt-0.5 text-xs text-zinc-200">
                We found{" "}
                <span className="font-semibold text-emerald-300">
                  {recommendations.length}
                </span>{" "}
                tokens that fit your profile. Swipe to shortlist your next
                moves.
              </p>
              {marketLoading && (
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  Updating live prices…
                </p>
              )}
            </div>
            <Button
              type="button"
              disabled={loading}
              onClick={() => setDeckOpen(true)}
              className="
                shrink-0
                rounded-full
                bg-[rgb(182,255,62)]
                px-3 py-1.5
                text-[11px] font-semibold
                text-black
                shadow-[0_0_18px_rgba(190,242,100,0.6)]
                hover:bg-[rgb(182,255,62)]/90
              "
            >
              Open swipe deck
            </Button>
          </div>
        </main>

        

      {/* Swipe modal lives here so the page stays dumb */}
      <AnimatePresence>
        {deckOpen && hasRecs && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeckOpen(false)}
            />

            {/* Dialog */}
            <motion.div
              className="
                relative z-50
                flex h-[80vh] w-full max-w-md flex-col
                overflow-hidden
                rounded-3xl
                border border-zinc-800
                bg-zinc-950
                shadow-[0_30px_120px_rgba(0,0,0,0.9)]
              "
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Swipe your picks
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-300">
                    Right to wishlist, left to skip.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDeckOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Deck */}
              <div className="flex-1 p-3">
                <ForYouSwipeDeck
                  recommendations={recommendations}
                  marketDataByMint={marketByMint}
                  marketLoading={marketLoading}
                  onFinished={() => setDeckOpen(false)}
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
