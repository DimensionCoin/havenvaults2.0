// app/(app)/for-you/page.tsx
"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { ForYouSwipeSection } from "@/components/for-you/ForYouSwipeSection";
import { ForYouWishlist } from "@/components/for-you/ForYouWishlist";

const ForYouPage: React.FC = () => {
  return (
    <div className="min-h-screen text-zinc-50">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-3 pb-8 pt-4 sm:px-4 lg:px-6">
        <header className="mb-3 sm:mb-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                For you
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                A swipe deck of tokens tuned to your risk, experience, and
                portfolio.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-black/70 px-3 py-1 text-[11px] text-zinc-400">
              <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
              Personalized ideas
            </span>
          </div>
        </header>

        {/* Swipe engine */}
        <ForYouSwipeSection />

        {/* Wishlist block */}
        <ForYouWishlist />
      </div>
    </div>
  );
};

export default ForYouPage;
