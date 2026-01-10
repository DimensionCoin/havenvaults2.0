// components/shared/BottomBar.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LineChart, // Invest
  Zap, // Amplify
  ArrowDownUp, // Markets
  User2Icon, // Profile
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>> | null;
  center?: boolean;
};

const navItems: NavItem[] = [
  { href: "/invest", label: "Assets", Icon: LineChart, center: false },
  { href: "/exchange", label: "Markets", Icon: ArrowDownUp, center: false },
  { href: "/dashboard", label: "Home", Icon: null, center: true },
  { href: "/amplify", label: "Amplify", Icon: Zap, center: false },
  { href: "/profile", label: "Profile", Icon: User2Icon, center: false },
];

const BottomBar: React.FC = () => {
  const pathname = usePathname();

  return (
    <nav
      className={[
        "fixed inset-x-1 bottom-0 z-30 md:hidden",
        // ✅ don’t pad the nav itself (this is what was lifting it)
        "pb-1",
      ].join(" ")}
      aria-label="Primary"
    >
      <div className="mx-auto max-w-md px-2">
        {/* Background container */}
        <div className="haven-bottom-nav ">
          {/* ✅ Actual nav content (sits low + tiny padding) */}
          <div className="flex items-end justify-between gap-1 pb-2 pt-2">
            {navItems.map(({ href, label, Icon, center }) => {
              const isActive =
                href === "/dashboard"
                  ? pathname === href
                  : pathname.startsWith(href);

              const common =
                "flex flex-col items-center justify-center gap-1 select-none";

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
                  className={common}
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
                          priority={false}
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

                  {!center && <span className={labelCls}>{label}</span>}
                </Link>
              );
            })}
          </div>

          {/* ✅ Safe-area spacer BELOW content (extends background down without lifting icons) */}
          <div aria-hidden className="h-[env(safe-area-inset-bottom)]" />
        </div>
      </div>
    </nav>
  );
};

export default BottomBar;
