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
  User2Icon, // Swap
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Home", Icon: Home },
  { href: "/invest", label: "Invest", Icon: LineChart },
  { href: "/exchange", label: "Exchange", Icon: ArrowDownUp },
  { href: "/amplify", label: "Amplify", Icon: Zap },
  { href: "/profile", label: "Profile", Icon: User2Icon },
];

const Sidebar: React.FC = () => {
  const pathname = usePathname();

  return (
    // hidden on small, visible md+; thin left sidebar
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-20 lg:w-23 flex-col border-r border-zinc-800 bg-black/40 backdrop-blur-xl">
      {/* Nav items */}
      <nav className="mt-7 flex flex-1 flex-col items-center gap-2">
        {navItems.map(({ href, label, Icon }) => {
          const isActive =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);

          const baseItem =
            "group flex w-16 lg:w-18 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-medium transition";
          const itemClasses = isActive
            ? `${baseItem} bg-primary text-black`
            : `${baseItem} text-zinc-400 hover:bg-zinc-900/80`;

          return (
            <Link key={href} href={href} className={itemClasses}>
              <Icon
                className={`${
                  isActive
                    ? "text-black"
                    : "text-zinc-200 group-hover:text-white"
                } ${href === "/dashboard" ? "h-5 w-5" : "h-4 w-4"}`}
              />
              <span
                className={
                  isActive ? "text-[10px]" : "text-[10px] text-zinc-400"
                }
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* bottom spacer if you want something later (settings, etc.) */}
      <div className="h-6" />
    </aside>
  );
};

export default Sidebar;
