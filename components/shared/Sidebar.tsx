// components/shared/Sidebar.tsx
"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LineChart, // Invest
  Zap, // Amplify
  Home, // Dashboard
  ArrowDownUp, // For You
  Layers, // Swap
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Home", Icon: Home },
  { href: "/invest", label: "Portfolio", Icon: LineChart },
  { href: "/exchange", label: "Markets", Icon: ArrowDownUp },
  { href: "/amplify", label: "Amplify", Icon: Zap },
  { href: "/bundles", label: "Bundles", Icon: Layers},
];

const Sidebar: React.FC = () => {
  const pathname = usePathname();

  return (
    // hidden on small, visible md+; thin left sidebar
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-20 lg:w-24 flex-col border-r border-border bg-card/80 backdrop-blur-xl shadow-fintech-lg">
     

      {/* Nav items */}
      <nav className="mt-6 flex flex-1 flex-col items-center gap-2 px-2">
        {navItems.map(({ href, label, Icon }) => {
          const isActive =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={[
                "group flex w-full max-w-[64px] flex-col items-center gap-1 rounded-2xl px-2 py-2",
                "text-[10px] font-medium transition-colors",
                "border border-transparent",
                isActive
                  ? "bg-primary text-primary-foreground border-primary/30 shadow-[0_10px_28px_rgba(41,198,104,0.18)] dark:shadow-[0_12px_30px_rgba(63,243,135,0.14)]"
                  : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground hover:border-border",
              ].join(" ")}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon
                className={[
                  href === "/dashboard" ? "h-5 w-5" : "h-4 w-4",
                  isActive
                    ? "text-secondary-foreground"
                    : "text-foreground/80 group-hover:text-foreground",
                ].join(" ")}
              />
              <span className={isActive ? "text-secondary-foreground" : ""}>
                {label}
              </span>
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
