"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, Loader2 } from "lucide-react";

export function LogoutButton({
  className = "",
  iconClassName = "h-4 w-4",
}: {
  className?: string;
  iconClassName?: string;
}) {
  const router = useRouter();
  const { logout } = usePrivy();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);

    try {
      await logout();
    } catch (err) {
      console.error("Privy logout error:", err);
    }

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("API logout error:", err);
    }

    router.replace("/");
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className={
        className ||
        [
          "inline-flex items-center justify-center",
          "h-8 w-8 rounded-full",
          "border bg-card/80 backdrop-blur-xl",
          "shadow-fintech-sm",
          "transition-colors hover:bg-secondary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:opacity-60",
        ].join(" ")
      }
      aria-label="Log out"
      title="Log out"
    >
      {loading ? (
        <Loader2 className={`${iconClassName} animate-spin`} />
      ) : (
        <LogOut className={iconClassName} />
      )}
    </button>
  );
}
