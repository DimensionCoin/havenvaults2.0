"use client";

import React, { useMemo } from "react";
import { useUser } from "@/providers/UserProvider";

type DevEmailGateProps = {
  allowEmails: string[];
  children: React.ReactNode;
  title?: string;
  message?: string;
  blurPx?: number;
  className?: string;
  blockWhileLoading?: boolean; // default false
};

export default function DevEmailGate({
  allowEmails,
  children,
  title = "Onramp is temporarily restricted",
  message = "We’re currently in approval/testing. This feature will be enabled for everyone soon.",
  blurPx = 14,
  className,
  blockWhileLoading = false,
}: DevEmailGateProps) {
  const { user, loading } = useUser();

  const email = useMemo(
    () =>
      String(user?.email || "")
        .trim()
        .toLowerCase(),
    [user?.email]
  );

  const isAllowed = useMemo(() => {
    const allow = (allowEmails || [])
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean);
    if (!email) return false;
    return allow.includes(email);
  }, [allowEmails, email]);

  const blocked = (blockWhileLoading && loading) || !isAllowed;

  return (
    <div className={["relative", className || ""].join(" ")}>
      {/* Blurred preview */}
      <div
        className={blocked ? "select-none" : ""}
        style={
          blocked ? { filter: `blur(${blurPx}px)`, opacity: 0.55 } : undefined
        }
        aria-hidden={blocked ? true : undefined}
      >
        {children}
      </div>

      {/* IMPORTANT: overlay must catch clicks so they don't hit the modal backdrop */}
      {blocked ? (
        <div
          className="absolute inset-0 z-10 pointer-events-auto flex items-center justify-center"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {/* full click-catcher */}
          <div className="absolute inset-0" />

          <div className="relative mx-3 w-full max-w-md rounded-2xl border border-border bg-card/95 p-4 shadow-fintech-lg">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {message}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
