// components/shared/BottomBar.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LineChart, // Invest
  Zap, // Amplify
  ArrowDownUp, // For You
  User2Icon, // Swap
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>> | null;
  center?: boolean;
};

const navItems: NavItem[] = [
  { href: "/invest", label: "Invest", Icon: LineChart, center: false },
  {
    href: "/exchange",
    label: "Exchange",
    Icon: ArrowDownUp,
    center: false,
  },
  { href: "/dashboard", label: "Home", Icon: null, center: true },
  { href: "/amplify", label: "Amplify", Icon: Zap, center: false },
  { href: "/profile", label: "Profile", Icon: User2Icon, center: false },
];

const BottomBar: React.FC = () => {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t  border-zinc-800 bg-black/40 backdrop-blur-xl rounded-lg md:hidden">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2 mb-6 sm:mb-1">
        {navItems.map(({ href, label, Icon, center }) => {
          const isActive =
            href === "/dashboard"
              ? pathname === href
              : pathname.startsWith(href);

          const baseCircle =
            "flex items-center justify-center rounded-full transition";
          const circleClasses = center
            ? `${baseCircle} h-12 w-12 -translate-y-2 ${
                isActive
                  ? "bg-primary text-black shadow-[0_0_20px_rgba(190,242,100,0.7)]"
                  : "bg-zinc-900 text-zinc-200"
              }`
            : `${baseCircle} h-9 w-9 ${
                isActive
                  ? "bg-primary/90 text-black shadow-[0_0_14px_rgba(190,242,100,0.6)]"
                  : "bg-zinc-900/80 text-zinc-300"
              }`;

          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-1 text-[10px] font-medium text-zinc-400"
            >
              <div className={circleClasses}>
                {center ? (
                  <Image
                    src="/logo.jpg"
                    alt="Haven"
                    width={28}
                    height={28}
                    className="h-11.5 w-11.5 rounded-full object-cover"
                  />
                ) : (
                  Icon && <Icon className={center ? "h-5 w-5" : "h-4 w-4"} />
                )}
              </div>
              {!center && (
                <span className={isActive ? "text-primary" : ""}>{label}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomBar;
