// components/exchange/CategoryTabs.tsx
"use client";

import React from "react";

export type CategoryTabOption<T extends string = string> = {
  key: T;
  label: string;
  count?: number;
};

type Props<T extends string> = {
  options: CategoryTabOption<T>[];

  value: T | "all";
  onChange: (v: T | "all") => void;

  className?: string;
};

export default function CategoryTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: Props<T>) {
  return (
    <div
      className={[
        "flex items-center gap-2 overflow-x-auto no-scrollbar",
        // small padding so the first/last pill doesn't feel cut off
        "py-1",
        className ?? "",
      ].join(" ")}
      role="tablist"
      aria-label="Categories"
    >
      <Tab
        label="All"
        meta={undefined}
        active={value === "all"}
        onClick={() => onChange("all")}
      />

      {options.map((opt) => (
        <Tab
          key={opt.key}
          label={opt.label}
          meta={typeof opt.count === "number" ? String(opt.count) : undefined}
          active={value === opt.key}
          onClick={() => onChange(opt.key)}
        />
      ))}
    </div>
  );
}

function Tab({
  label,
  meta,
  active,
  onClick,
}: {
  label: string;
  meta?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "group inline-flex items-center gap-2 whitespace-nowrap",
        "rounded-full border px-3 py-1.5 text-xs font-semibold",
        "shadow-fintech-sm transition",
        "active:scale-[0.985]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? // selected: mint wash, strong text, subtle glow
            "border-primary/25 bg-primary/10 text-foreground"
          : // idle: calm pill that lifts on hover
            "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>

      {meta ? (
        <span
          className={[
            "ml-0.5 rounded-full border px-2 py-0.5 text-[11px] tabular-nums",
            active
              ? "border-primary/20 bg-primary/10 text-foreground"
              : "border-border bg-card/60 text-muted-foreground group-hover:text-foreground",
          ].join(" ")}
        >
          {meta}
        </span>
      ) : null}
    </button>
  );
}
