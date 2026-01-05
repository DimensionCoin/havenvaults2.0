// app/(app)/AppLayoutInner.tsx
"use client";

import { useCallback } from "react";
import { useBalance } from "@/providers/BalanceProvider";
import PullToRefresh from "@/components/shared/PullToRefresh";

export default function AppLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const { refresh } = useBalance();

  const handleRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="w-full min-h-screen">{children}</div>
    </PullToRefresh>
  );
}
