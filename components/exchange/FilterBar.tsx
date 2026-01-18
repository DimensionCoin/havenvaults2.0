// components/exchange/FilterBar.tsx
"use client";

import React from "react";
import type { PriceFilterMode, SortMode } from "./types";
import { SlidersHorizontal, ArrowUpDown } from "lucide-react";

type Props = {
  priceMode: PriceFilterMode;
  onPriceModeChange: (v: PriceFilterMode) => void;

  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;

  className?: string;
};

export default function FilterBar({
  priceMode,
  onPriceModeChange,
  sortMode,
  onSortModeChange,
  className,
}: Props) {
  return (
    <div
      className={["flex flex-wrap items-center gap-2", className ?? ""].join(
        " "
      )}
    >
      <HavenSelect
        icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
        label="Price"
        value={priceMode}
        onChange={(v) => onPriceModeChange(v as PriceFilterMode)}
        options={[
          ["all", "All prices"],
          ["under1", "Under $1"],
          ["1to10", "$1–$10"],
          ["10to100", "$10–$100"],
          ["over100", "Over $100"],
        ]}
      />

      <HavenSelect
        icon={<ArrowUpDown className="h-3.5 w-3.5" />}
        label="Sort"
        value={sortMode}
        onChange={(v) => onSortModeChange(v as SortMode)}
        options={[
          ["featured", "Featured"],
          ["price_desc", "Price: High → Low"],
          ["price_asc", "Price: Low → High"],
          ["change_desc", "Change: High → Low"],
          ["change_asc", "Change: Low → High"],
          ["volume_desc", "Volume: High → Low"],
        ]}
      />
    </div>
  );
}

function HavenSelect({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label
      className={[
        "inline-flex items-center gap-2 rounded-full border bg-secondary px-3 py-2",
        "text-[11px] font-medium text-muted-foreground shadow-fintech-sm",
        "hover:bg-accent transition-colors",
      ].join(" ")}
    >
      {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      <span className="text-muted-foreground">{label}</span>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "bg-transparent text-[11px] font-semibold text-foreground outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring rounded-full",
        ].join(" ")}
      >
        {options.map(([k, v]) => (
          <option
            key={k}
            value={k}
            className="bg-popover text-popover-foreground"
          >
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
