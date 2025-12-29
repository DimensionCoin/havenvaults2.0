// components/LogoutButton.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut } from "lucide-react";

export function LogoutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { logout } = usePrivy();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);

    try {
      // 1) Clear Privy session (access token, local storage, etc.)
      await logout();
    } catch (err) {
      console.error("Privy logout error:", err);
      // we still proceed to clear our cookie
    }

    try {
      // 2) Clear our HttpOnly app session cookie
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("API logout error:", err);
    }

    // 3) Send user to landing page
    router.replace("/");
    // Optional: hard reload if you want to nuke all client state:
    // window.location.href = "/";
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={handleLogout}
        disabled={loading}
        className={
          className ||
          "flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white/80 backdrop-blur-md hover:bg-black/40 transition"
        }
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
