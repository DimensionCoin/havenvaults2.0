// components/exchange/SearchBar.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { AssetRow } from "./types";
import AssetCard from "./AssetCard";

type Props = {
  value: string;
  onChange: (v: string) => void;

  placeholder?: string;
  autoFocus?: boolean;
  className?: string;

  /** optional: call on submit (Enter) */
  onSubmit?: (v: string) => void;

  /** optional: small hint text under the input */
  hint?: string;

  /** optional: id for labels */
  id?: string;

  /** ✅ assets to search + show in dropdown */
  assets?: AssetRow[];

  /** ✅ max rows to show in dropdown */
  limit?: number;

  /** ✅ called when user selects a result */
  onSelectAsset?: (asset: AssetRow) => void;

  /** ✅ link override (defaults to /invest/<mint>) */
  hrefFor?: (asset: AssetRow) => string;
};

function defaultHrefFor(a: AssetRow) {
  return `/invest/${encodeURIComponent(a.mint)}`;
}

export default function SearchBar({
  value,
  onChange,
  placeholder = "Search by name or symbol…",
  autoFocus,
  className,
  onSubmit,
  hint,
  id = "exchange-search",
  assets = [],
  limit = 6,
  onSelectAsset,
  hrefFor,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const hasValue = value.trim().length > 0;

  const results = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];

    // fast filtering (name/symbol)
    const filtered = assets.filter((a) => {
      const name = (a.name || "").toLowerCase();
      const sym = (a.symbol || "").toLowerCase();
      return name.includes(q) || sym.includes(q);
    });

    return filtered.slice(0, limit);
  }, [assets, value, limit]);

  const showDropdown = open && hasValue && results.length > 0;

  // keep active index in bounds
  useEffect(() => {
    if (!showDropdown) return;
    setActiveIndex((i) => Math.min(i, results.length - 1));
  }, [showDropdown, results.length]);

  const selectAsset = (asset: AssetRow) => {
    onSelectAsset?.(asset);
    setOpen(false);
  };

  const toHref = hrefFor ?? defaultHrefFor;

  return (
    <div ref={rootRef} className={["relative", className ?? ""].join(" ")}>
      {/* Input */}
      <div
        className={[
          "flex items-center gap-2 rounded-2xl border bg-secondary px-3.5 py-2.5",
          "shadow-fintech-sm",
          "focus-within:ring-2 focus-within:ring-ring focus-within:border-primary/40",
        ].join(" ")}
      >
        <Search className="h-4 w-4 text-muted-foreground" />

        <input
          id={id}
          ref={inputRef}
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onChange("");
              setOpen(false);
              return;
            }

            if (e.key === "Enter") {
              // if dropdown open, choose active result first
              if (showDropdown && results[activeIndex]) {
                e.preventDefault();
                selectAsset(results[activeIndex]);
                return;
              }
              onSubmit?.(value.trim());
              setOpen(false);
              return;
            }

            if (!showDropdown) return;

            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={[
            "w-full bg-transparent text-sm outline-none",
            "placeholder:text-muted-foreground",
          ].join(" ")}
        />

        {hasValue && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className={[
              "inline-flex h-8 w-8 items-center justify-center rounded-full",
              "border bg-card/60 text-muted-foreground",
              "shadow-fintech-sm transition hover:bg-accent hover:text-foreground",
              "active:scale-[0.98]",
            ].join(" ")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Hint */}
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}

      {/* Dropdown */}
      {showDropdown ? (
        <div
          className={[
            "absolute left-0 right-0 z-50 mt-2 overflow-hidden",
            "rounded-3xl border bg-card/80 backdrop-blur-xl shadow-fintech-lg",
          ].join(" ")}
          role="listbox"
          aria-label="Search results"
        >
          <div className="px-4 py-3">
            <div className="haven-kicker">Results</div>
          </div>

          <div className="flex flex-col gap-2 px-3 pb-3">
            {results.map((a, idx) => (
              <div
                key={`sr:${a.kind}:${a.mint}`}
                className={[
                  "rounded-3xl",
                  idx === activeIndex ? "ring-2 ring-ring" : "",
                ].join(" ")}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <AssetCard
                  asset={a}
                  href={toHref(a)}
                  onClick={() => selectAsset(a)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
