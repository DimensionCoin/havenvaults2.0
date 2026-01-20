"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCluster } from "@/lib/tokenConfig";

const CLUSTER = getCluster();

export function NotFoundView() {
  const router = useRouter();

  return (
    <main className="haven-app">
      <div className="mx-auto w-full max-w-[520px] px-3 pb-10 pt-4 sm:px-4">
        <div className="haven-card overflow-hidden">
          <div className="flex items-center gap-2 border-b bg-card/60 px-3 py-3 backdrop-blur-xl sm:px-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-card/80 shadow-fintech-sm transition-colors hover:bg-secondary active:scale-[0.98]"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4 text-foreground/70" />
            </button>

            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                Exchange
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">
                Asset not found on {CLUSTER}.
              </p>
            </div>
          </div>

          <div className="p-3 sm:p-4">
            <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-foreground">
              This asset isn&apos;t available for the current network. Go back
              and select an asset from Exchange.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
