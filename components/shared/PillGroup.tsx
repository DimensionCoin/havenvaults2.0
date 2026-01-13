"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, Loader2 } from "lucide-react";

type LogoutButtonProps = {
  className?: string;
};

export function LogoutButton({ className = "" }: LogoutButtonProps) {
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
          "flex w-full items-center gap-2",
          "rounded-xl px-3 py-2.5",
          "text-sm font-medium",
          "text-primary",
          "hover:bg-accent transition",
          "disabled:opacity-60",
        ].join(" ")
      }
      aria-label="Log out"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <LogOut className="h-4 w-4 text-muted-foreground" />
      )}
      <span>Logout</span>
    </button>
  );
}
