// components/shared/BottomBar.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LineChart, Zap, ArrowDownUp, User2Icon } from "lucide-react";

const navItems = [
  { href: "/invest", label: "Assets", Icon: LineChart, center: false },
  { href: "/exchange", label: "Markets", Icon: ArrowDownUp, center: false },
  { href: "/dashboard", label: "Home", Icon: null, center: true },
  { href: "/amplify", label: "Amplify", Icon: Zap, center: false },
  { href: "/profile", label: "Profile", Icon: User2Icon, center: false },
];

export default function BottomBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 z-50 md:hidden pointer-events-none"
      style={{
        // ✅ sits on the REAL bottom (safe-area aware) + slight float
        bottom: "calc(env(safe-area-inset-bottom) + 1px)",
      }}
    >
      <div className="mx-auto max-w-md px-2 pointer-events-auto">
        <div className="haven-bottom-nav">
          <div className="flex items-end justify-between gap-1 py-2">
            {navItems.map(({ href, label, Icon, center }) => {
              const isActive =
                href === "/dashboard"
                  ? pathname === href
                  : pathname.startsWith(href);

              const iconWrapBase =
                "grid place-items-center rounded-2xl border transition-all";

              const iconWrap = center
                ? [
                    iconWrapBase,
                    "h-12 w-12 -translate-y-3",
                    isActive
                      ? "border-primary/30 bg-primary/20 glow-mint"
                      : "border-border bg-card/70",
                  ].join(" ")
                : [
                    iconWrapBase,
                    "h-10 w-10",
                    isActive
                      ? "border-primary/25 bg-primary/15"
                      : "border-border bg-card/70 hover:bg-secondary",
                  ].join(" ");

              const labelCls = [
                "text-[10px] font-medium",
                isActive ? "text-foreground" : "text-muted-foreground",
              ].join(" ");

              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-center gap-1 select-none"
                  aria-current={isActive ? "page" : undefined}
                >
                  <div className={iconWrap}>
                    {center ? (
                      <div className="relative h-8 w-8 overflow-hidden rounded-[14px]">
                        <Image
                          src="/logo.jpg"
                          alt="Haven"
                          fill
                          sizes="32px"
                          className="object-contain"
                        />
                      </div>
                    ) : (
                      Icon && (
                        <Icon
                          className={[
                            "h-[18px] w-[18px]",
                            isActive
                              ? "text-foreground"
                              : "text-muted-foreground",
                          ].join(" ")}
                        />
                      )
                    )}
                  </div>

                  {/* ✅ show Home under the center Haven logo too */}
                  <span className={labelCls}>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
