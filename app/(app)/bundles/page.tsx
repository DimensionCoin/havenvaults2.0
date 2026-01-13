"use client"
import BundlesPanel from "@/components/bundles/BundlesPanel";
import { useUser } from "@/providers/UserProvider";

export default function BundlesPage() {
  const { user } = useUser();
  const ownerBase58 = user?.walletAddress?.trim() || "";

  return (
    <div className="min-h-screen text-foreground">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">

        <BundlesPanel ownerBase58={ownerBase58} />
      </div>
    </div>
  );
}
