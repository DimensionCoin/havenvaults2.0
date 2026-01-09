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
  Axis3d,
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
  PreMarket: <Axis3d className="h-4 w-4" />,
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

// Display labels
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
  PreMarket: "PreMarket",
};

const CategoryTabs: React.FC<CategoryTabsProps> = ({
  activeTab,
  onTabChange,
  favoritesCount,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const availableCategories = useMemo(() => {
    const categorySet = new Set<TokenCategory>();

    TOKENS.forEach((token) => {
      if (getMintFor(token, CLUSTER)) {
        token.categories.forEach((cat) => categorySet.add(cat));
      }
    });

    const categoryOrder: TokenCategory[] = [
      "Top MC",
      "Stocks",
      "PreMarket",
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

    return categoryOrder.filter((cat) => categorySet.has(cat));
  }, []);

  const tabs = useMemo(() => {
    const result: { id: MarketTab; label: string; icon: React.ReactNode }[] = [
      { id: "all", label: CATEGORY_LABELS.all, icon: CATEGORY_ICONS.all },
    ];

    availableCategories.forEach((cat) => {
      result.push({
        id: cat,
        label: CATEGORY_LABELS[cat] || cat,
        icon: CATEGORY_ICONS[cat] || <CircleDot className="h-4 w-4" />,
      });
    });

    result.push({
      id: "favorites",
      label: CATEGORY_LABELS.favorites,
      icon: CATEGORY_ICONS.favorites,
    });

    return result;
  }, [availableCategories]);

  useEffect(() => {
    if (!activeRef.current || !scrollRef.current) return;

    const container = scrollRef.current;
    const button = activeRef.current;
    const containerRect = container.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();

    if (buttonRect.left < containerRect.left) {
      container.scrollLeft -= containerRect.left - buttonRect.left + 16;
    } else if (buttonRect.right > containerRect.right) {
      container.scrollLeft += buttonRect.right - containerRect.right + 16;
    }
  }, [activeTab]);

  return (
    <div
      ref={scrollRef}
      className={[
        "no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1",
        "pt-1",
      ].join(" ")}
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
            className={[
              "flex shrink-0 items-center gap-2",
              "rounded-full border",
              "px-3.5 py-2",
              "text-[12px] font-semibold tracking-tight",
              "transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",

              // Base chip surface
              "bg-card/70 backdrop-blur-xl",

              // Active vs inactive
              isActive
                ? "border-primary/25 bg-primary/10 text-foreground shadow-fintech-sm"
                : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
            ].join(" ")}
            aria-pressed={isActive}
          >
            <span
              className={[
                "flex h-7 w-7 items-center justify-center rounded-full border",
                isActive
                  ? "border-primary/20 bg-background/60"
                  : "border-border bg-background/40",
              ].join(" ")}
            >
              {tab.icon}
            </span>

            <span className="whitespace-nowrap">{tab.label}</span>

            {showCount && (
              <span
                className={[
                  "ml-0.5 rounded-full border px-2 py-0.5",
                  "text-[10px] font-semibold tabular-nums",
                  isActive
                    ? "border-primary/25 bg-primary/10 text-foreground"
                    : "border-border bg-secondary text-muted-foreground",
                ].join(" ")}
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
