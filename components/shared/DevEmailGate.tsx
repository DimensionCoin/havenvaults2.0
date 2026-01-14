"use client";

import React, { useMemo } from "react";
import { useUser } from "@/providers/UserProvider";

type DevEmailGateProps = {
  allowEmails: string[]; // emails allowed to see children
  children: React.ReactNode;
  title?: string;
  message?: string;
  blurPx?: number; // blur strength
  className?: string;
};

export default function DevEmailGate({
  allowEmails,
  children,
  title = "Onramp is temporarily restricted",
  message = "We’re currently in approval/testing. This feature will be enabled for everyone soon.",
  blurPx = 14,
  className,
}: DevEmailGateProps) {
  const { user, loading } = useUser();

  const isAllowed = useMemo(() => {
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return false;
    return allowEmails.map((e) => e.trim().toLowerCase()).includes(email);
  }, [user?.email, allowEmails]);

  // While user loads, block to be safe (prevents a flash of content)
  const blocked = loading || !isAllowed;

  return (
    <div className={["relative", className || ""].join(" ")}>
      {/* Always render children, but blur/disable when blocked */}
      <div
        className={blocked ? "pointer-events-none select-none" : ""}
        style={
          blocked ? { filter: `blur(${blurPx}px)`, opacity: 0.55 } : undefined
        }
        aria-hidden={blocked ? true : undefined}
      >
        {children}
      </div>

      {blocked ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="mx-3 w-full max-w-md rounded-2xl border border-border bg-card/95 p-4 shadow-fintech-lg">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {message}
            </div>

            <div className="mt-3 rounded-xl border border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
              Your account isn’t whitelisted for onramp testing yet.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
