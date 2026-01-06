// components/exchange/SearchBar.tsx
"use client";

import React, { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search markets...",
  autoFocus = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
        <Search className="h-5 w-5 text-zinc-500" />
      </div>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-zinc-900/40 py-3.5 pl-12 pr-12 text-base text-zinc-100 outline-none ring-1 ring-zinc-800 transition-all placeholder:text-zinc-500 focus:bg-zinc-900 focus:ring-2 focus:ring-emerald-500/50"
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute inset-y-0 right-0 flex items-center pr-4"
          aria-label="Clear search"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700 transition-colors hover:bg-zinc-600">
            <X className="h-3.5 w-3.5 text-zinc-300" />
          </div>
        </button>
      )}
    </div>
  );
};

export default SearchBar;
