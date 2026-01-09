// components/exchange/SearchBar.tsx
"use client";

import React, { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = "Search markets…",
  autoFocus = false,
  className = "",
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  return (
    <div className={["relative", className].join(" ")}>
      {/* Search icon */}
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
        <Search className="h-4.5 w-4.5 text-muted-foreground" />
      </div>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // ✅ uses Haven input + slight “exchange” tweaks
        className={[
          "haven-input",
          "py-3 pl-10 pr-11", // room for icons
          "text-[16px]", // iOS: prevent zoom
          "bg-card/70 backdrop-blur-xl", // premium surface like the rest of Haven
        ].join(" ")}
      />

      {/* Clear button */}
      {value?.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={[
            "absolute inset-y-0 right-0 flex items-center pr-2.5",
            "focus-visible:outline-none",
          ].join(" ")}
          aria-label="Clear search"
        >
          <span
            className={[
              "inline-flex h-8 w-8 items-center justify-center rounded-full",
              "border border-border bg-secondary/70 backdrop-blur-xl",
              "shadow-fintech-sm transition-colors",
              "hover:bg-accent active:scale-[0.98]",
              "text-foreground/80 hover:text-foreground",
            ].join(" ")}
          >
            <X className="h-4 w-4" />
          </span>
        </button>
      )}
    </div>
  );
};

export default SearchBar;
