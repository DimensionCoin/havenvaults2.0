// app/(main)/bundles/page.tsx
"use client";

import { useState } from "react";
import { Layers, Sparkles } from "lucide-react";
import BundlesPanel from "@/components/bundles/BundlesPanel";
import UserBundles from "@/components/bundles/UserBundles";
import MakeBundle from "@/components/bundles/MakeBundle";
import { useUser } from "@/providers/UserProvider";

type TabId = "haven" | "community";

export default function BundlesPage() {
  const { user } = useUser();
  const ownerBase58 = user?.walletAddress?.trim() || "";
  const currentUserId = user?.id?.toString();

  const [activeTab, setActiveTab] = useState<TabId>("haven");

  return (
    <div className="min-h-screen text-foreground">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">
        {/* Page Header with Tabs */}
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-secondary/50 border border-border">
            <button
              type="button"
              onClick={() => setActiveTab("haven")}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                transition-all duration-200
                ${
                  activeTab === "haven"
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }
              `}
            >
              <Layers className="h-4 w-4" />
              <span className="hidden sm:inline">Haven</span> Bundles
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("community")}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                transition-all duration-200
                ${
                  activeTab === "community"
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }
              `}
            >
              <Sparkles className="h-4 w-4" />
              Community
            </button>
          </div>

          {/* Create Bundle Button - Shows on both tabs */}
          {activeTab === "haven" && ownerBase58 && (
            <MakeBundle ownerBase58={ownerBase58} />
          )}
        </div>

        {/* Tab Content */}
        {activeTab === "haven" ? (
          <BundlesPanel ownerBase58={ownerBase58} />
        ) : (
          <UserBundles
            ownerBase58={ownerBase58}
            currentUserId={currentUserId}
          />
        )}
      </div>
    </div>
  );
}
