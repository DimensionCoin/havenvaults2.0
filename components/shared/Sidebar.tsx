// components/shared/Sidebar.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LineChart, // Portfolio
  Zap, // Multiply
  ArrowDownUp, // Markets
  Layers, // Bundles
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>> | null;
  isHome: boolean;
};

const navItems: NavItem[] = [
  // ✅ Home at top (logo icon)
  { href: "/dashboard", label: "Home", Icon: null, isHome: true },

  // ✅ Same order as bottom bar (after Home):
  // Markets, Portfolio, Bundles, Multiply
  { href: "/exchange", label: "Markets", Icon: ArrowDownUp, isHome: false },
  { href: "/invest", label: "Portfolio", Icon: LineChart, isHome: false },
  { href: "/bundles", label: "Bundles", Icon: Layers, isHome: false },
  { href: "/amplify", label: "Amplify", Icon: Zap, isHome: false },
];

const Sidebar: React.FC = () => {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-20 lg:w-24 flex-col border-r border-border bg-card/80 backdrop-blur-xl shadow-fintech-lg">
      {/* Top logo/home */}
      <div className="pt-5 px-2">
        {(() => {
          const href = "/dashboard";
          const isActive = pathname === href;

          return (
            <Link
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={[
                "group mx-auto flex w-full max-w-[64px] flex-col items-center gap-1 rounded-2xl px-2 py-2",
                "text-[10px] font-medium transition-colors",
                "border",
                isActive
                  ? "bg-primary/15 border-primary/30 text-foreground shadow-[0_10px_28px_rgba(41,198,104,0.18)] dark:shadow-[0_12px_30px_rgba(63,243,135,0.14)]"
                  : "bg-white/[0.02] border-white/10 text-muted-foreground hover:bg-secondary hover:text-foreground hover:border-border",
              ].join(" ")}
            >
              <div
                className={[
                  "grid place-items-center rounded-2xl border transition-all",
                  "h-11 w-11",
                  isActive
                    ? "border-primary/30 bg-primary/20"
                    : "border-white/10 bg-white/[0.06] group-hover:bg-white/[0.09]",
                ].join(" ")}
              >
                <div className="relative h-7 w-7 overflow-hidden rounded-[14px]">
                  <Image
                    src="/logo.jpg"
                    alt="Haven"
                    fill
                    sizes="28px"
                    className="object-contain"
                    priority
                  />
                </div>
              </div>

              <span className={isActive ? "text-foreground" : ""}>Home</span>

              <span
                className={[
                  "mt-0.5 h-[3px] w-6 rounded-full transition-opacity",
                  isActive ? "opacity-100 bg-primary/80" : "opacity-0",
                ].join(" ")}
              />
            </Link>
          );
        })()}
      </div>

      {/* Divider */}
      <div className="mx-4 mt-3 mb-2 h-px bg-white/10" />

      {/* Nav items */}
      <nav className="mt-2 flex flex-1 flex-col items-center gap-2 px-2">
        {navItems
          .filter((x) => !x.isHome)
          .map(({ href, label, Icon }) => {
            const isActive = pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "group flex w-full max-w-[64px] flex-col items-center gap-1 rounded-2xl px-2 py-2",
                  "text-[10px] font-medium transition-colors",
                  "border",
                  isActive
                    ? "bg-primary/15 border-primary/30 text-foreground shadow-[0_10px_28px_rgba(41,198,104,0.18)] dark:shadow-[0_12px_30px_rgba(63,243,135,0.14)]"
                    : "bg-transparent border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground hover:border-border",
                ].join(" ")}
              >
                <div
                  className={[
                    "grid place-items-center rounded-2xl border transition-all",
                    "h-10 w-10",
                    isActive
                      ? "border-primary/25 bg-primary/15"
                      : "border-white/10 bg-white/[0.06] group-hover:bg-white/[0.09]",
                  ].join(" ")}
                >
                  {Icon ? (
                    <Icon
                      className={[
                        "h-[18px] w-[18px]",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground",
                      ].join(" ")}
                    />
                  ) : null}
                </div>

                <span className={isActive ? "text-foreground" : ""}>
                  {label}
                </span>

                <span
                  className={[
                    "mt-0.5 h-[3px] w-6 rounded-full transition-opacity",
                    isActive ? "opacity-100 bg-primary/80" : "opacity-0",
                  ].join(" ")}
                />
              </Link>
            );
          })}
      </nav>

      {/* Bottom spacer (future: settings/help) */}
      <div className="h-6" />
    </aside>
  );
};

export default Sidebar;
