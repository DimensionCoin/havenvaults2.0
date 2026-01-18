// components/exchange/AssetList.tsx
"use client";

import React from "react";
import type { AssetRow } from "./types";
import AssetCard from "./AssetCard";

type Props = {
  assets: AssetRow[];
  onAssetClick?: (asset: AssetRow) => void;
  emptyLabel?: string;
  className?: string;
};

export default function AssetList({
  assets,
  onAssetClick,
  emptyLabel = "No assets found.",
  className,
}: Props) {
  if (!assets.length) {
    return (
      <div className={["haven-card-soft px-4 py-4", className ?? ""].join(" ")}>
        <div className="text-sm font-semibold text-foreground">
          Nothing here
        </div>
        <div className="mt-1 text-[12px] text-muted-foreground">
          {emptyLabel}
        </div>
      </div>
    );
  }

  return (
    <div className={["flex flex-col gap-2", className ?? ""].join(" ")}>
      {assets.map((a) => (
        <AssetCard
          key={`${a.kind}:${a.mint}`} // mint is safest unique key
          asset={a}
          onClick={onAssetClick}
        />
      ))}
    </div>
  );
}
