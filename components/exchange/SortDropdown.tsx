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
  className?: string;
};

const OPTIONS: { value: SortOption; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "gainers", label: "Top Gainers" },
  { value: "losers", label: "Top Losers" },
  { value: "price-high", label: "Price: High to Low" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "name", label: "Name: A to Z" },
];

const SortDropdown: React.FC<SortDropdownProps> = ({
  value,
  onChange,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabel = OPTIONS.find((o) => o.value === value)?.label || "Sort";

  // Close on outside click + Esc
  useEffect(() => {
    if (!isOpen) return;

    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={["relative", className].join(" ")}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={[
          "inline-flex items-center gap-2",
          "h-10 rounded-full px-4",
          "border border-border bg-card/80 backdrop-blur-xl",
          "shadow-fintech-sm",
          "text-[13px] font-medium text-foreground/90",
          "transition-colors hover:bg-secondary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ].join(" ")}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Sort markets"
      >
        <span className="max-w-[180px] truncate">{selectedLabel}</span>
        <ChevronDown
          className={[
            "h-4 w-4 text-muted-foreground transition-transform",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Sort options"
          className={[
            "absolute right-0 top-full z-50 mt-2 min-w-[220px] overflow-hidden",
            "rounded-2xl border border-border",
            "bg-popover/95 backdrop-blur-xl",
            "shadow-fintech-lg",
            "p-1",
          ].join(" ")}
        >
          {OPTIONS.map((option) => {
            const active = value === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={[
                  "flex w-full items-center justify-between",
                  "rounded-xl px-3 py-2.5 text-left",
                  "text-[13px] transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-foreground/80 hover:bg-secondary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ].join(" ")}
                role="option"
                aria-selected={active}
              >
                <span className="truncate">{option.label}</span>
                {active && (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
                    <Check className="h-4 w-4 text-foreground" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SortDropdown;
