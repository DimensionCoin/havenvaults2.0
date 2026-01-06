// components/exchange/SortDropdown.tsx
"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export type SortOption =
  | "trending"
  | "gainers"
  | "losers"
  | "price-high"
  | "price-low"
  | "name";

type SortDropdownProps = {
  value: SortOption;
  onChange: (value: SortOption) => void;
};

const OPTIONS: { value: SortOption; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "gainers", label: "Top Gainers" },
  { value: "losers", label: "Top Losers" },
  { value: "price-high", label: "Price: High to Low" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "name", label: "Name: A to Z" },
];

const SortDropdown: React.FC<SortDropdownProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel = OPTIONS.find((o) => o.value === value)?.label || "Sort";

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-xl bg-zinc-900/60 px-4 py-2.5 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 transition-all hover:bg-zinc-800/80 hover:text-zinc-100"
      >
        <span>{selectedLabel}</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[200px] overflow-hidden rounded-xl bg-zinc-900/80 p-1 shadow-xl ring-1 ring-zinc-800">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                value === option.value
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <span>{option.label}</span>
              {value === option.value && (
                <Check className="h-4 w-4 text-emerald-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SortDropdown;
