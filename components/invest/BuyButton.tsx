// components/invest/BuyButton.tsx
"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const BuyButton: React.FC = () => {
  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-50 md:bottom-6 sm:right-6">
      <Link
        href="/invest/exchange"
        className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/70 bg-white/10 text-xs font-semibold text-white/80 shadow-lg shadow-emerald-500/30 px-3 py-2 sm:px-4 sm:py-2.5 hover:bg-emerald-400 hover:border-emerald-300 active:scale-95 transition hover:text-black"
        aria-label="Open Haven Exchange"
      >
        <span className="hidden sm:inline">Open Exchange</span>
        <span className="sm:hidden">Trade</span>
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
};

export default BuyButton;
