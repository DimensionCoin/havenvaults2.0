// components/exchange/CategoryTabs.tsx
"use client";

import React, { useRef, useEffect, useMemo } from "react";
import {
  Star,
  TrendingUp,
  Landmark,
  Coins,
  Layers,
  Laugh,
  Droplets,
  Cpu,
  Gamepad2,
  Image as ImageIcon,
  Wrench,
  CircleDot,
  HatGlasses,
} from "lucide-react";
import {
  TOKENS,
  getCluster,
  getMintFor,
  type TokenCategory,
} from "@/lib/tokenConfig";
import type { MarketTab } from "./types";

const CLUSTER = getCluster();

type CategoryTabsProps = {
  activeTab: MarketTab;
  onTabChange: (tab: MarketTab) => void;
  favoritesCount: number;
};

// Icon mapping for categories
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  all: <TrendingUp className="h-4 w-4" />,
  favorites: <Star className="h-4 w-4" />,
  "Top MC": <CircleDot className="h-4 w-4" />,
  Stocks: <Landmark className="h-4 w-4" />,
  DeFi: <Coins className="h-4 w-4" />,
  Infrastructure: <Layers className="h-4 w-4" />,
  Meme: <Laugh className="h-4 w-4" />,
  LST: <Droplets className="h-4 w-4" />,
  DePin: <Cpu className="h-4 w-4" />,
  Gaming: <Gamepad2 className="h-4 w-4" />,
  NFT: <ImageIcon className="h-4 w-4" />,
  Privacy: <HatGlasses className="h-4 w-4" />,
  Utility: <Wrench className="h-4 w-4" />,
};

// Display labels (can customize if needed)
const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  favorites: "Favorites",
  "Top MC": "Top",
  Stocks: "Stocks",
  DeFi: "DeFi",
  Infrastructure: "Infra",
  Meme: "Meme",
  LST: "LST",
  DePin: "DePin",
  Gaming: "Gaming",
  NFT: "NFT",
  Privacy: "Privacy",
  Utility: "Utility",
};

const CategoryTabs: React.FC<CategoryTabsProps> = ({
  activeTab,
  onTabChange,
  favoritesCount,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Dynamically get categories that have tokens in the current cluster
  const availableCategories = useMemo(() => {
    const categorySet = new Set<TokenCategory>();

    TOKENS.forEach((token) => {
      // Only include tokens that have a mint for this cluster
      if (getMintFor(token, CLUSTER)) {
        token.categories.forEach((cat) => categorySet.add(cat));
      }
    });

    // Define the order we want categories to appear
    const categoryOrder: TokenCategory[] = [
      "Top MC",
      "Stocks",
      "DeFi",
      "Meme",
      "LST",
      "Infrastructure",
      "DePin",
      "Gaming",
      "NFT",
      "Privacy",
      "Utility",
    ];

    // Filter to only categories that exist and sort by our preferred order
    return categoryOrder.filter((cat) => categorySet.has(cat));
  }, []);

  // Build tabs array: All + Categories + Favorites
  const tabs = useMemo(() => {
    const result: { id: MarketTab; label: string; icon: React.ReactNode }[] = [
      {
        id: "all",
        label: CATEGORY_LABELS["all"],
        icon: CATEGORY_ICONS["all"],
      },
    ];

    // Add category tabs
    availableCategories.forEach((cat) => {
      result.push({
        id: cat,
        label: CATEGORY_LABELS[cat] || cat,
        icon: CATEGORY_ICONS[cat] || <CircleDot className="h-4 w-4" />,
      });
    });

    // Add favorites at the end
    result.push({
      id: "favorites",
      label: CATEGORY_LABELS["favorites"],
      icon: CATEGORY_ICONS["favorites"],
    });

    return result;
  }, [availableCategories]);

  // Scroll active tab into view on mount/change
  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const button = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();

      if (buttonRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - buttonRect.left + 16;
      } else if (buttonRect.right > containerRect.right) {
        container.scrollLeft += buttonRect.right - containerRect.right + 16;
      }
    }
  }, [activeTab]);

  return (
    <div
      ref={scrollRef}
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const showCount = tab.id === "favorites" && favoritesCount > 0;

        return (
          <button
            key={tab.id}
            ref={isActive ? activeRef : undefined}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
              isActive
                ? "bg-zinc-100 text-zinc-900"
                : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {showCount && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  isActive
                    ? "bg-zinc-900 text-zinc-100"
                    : "bg-zinc-700 text-zinc-300"
                }`}
              >
                {favoritesCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default CategoryTabs;
