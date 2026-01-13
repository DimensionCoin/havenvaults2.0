// components/shared/BottomBar.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LineChart, Zap, ArrowDownUp, Layers } from "lucide-react";

const navItems = [
  { href: "/exchange", label: "Markets", Icon: ArrowDownUp, center: false },
  { href: "/invest", label: "Portfolio", Icon: LineChart, center: false },
  { href: "/dashboard", label: "Home", Icon: null, center: true },
  { href: "/bundles", label: "Bundles", Icon: Layers, center: false },
  { href: "/amplify", label: "Multiply", Icon: Zap, center: false },
];

export default function BottomBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 md:hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Subtle gradient fade behind the bar for polish */}
      <div
        className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, hsl(var(--background)) 0%, transparent 100%)",
        }}
      />

      <div className="relative mx-auto max-w-md px-3 pb-1">
        {/* Floating pill navigation */}
        <div className="rounded-2xl border border-white/[0.08] bg-background/90 backdrop-blur-2xl shadow-xl shadow-black/25">
          <div className="relative grid grid-cols-5 items-end px-1.5 py-1.5">
            {navItems.map(({ href, label, Icon, center }) => {
              const isActive =
                href === "/dashboard"
                  ? pathname === href
                  : pathname.startsWith(href);

              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center justify-end gap-0.5 py-1"
                  aria-current={isActive ? "page" : undefined}
                >
                  {/* Icon button */}
                  <div
                    className={[
                      "grid place-items-center rounded-xl transition-all duration-200 active:scale-95",
                      center ? "h-12 w-12 -mt-3" : "h-9 w-9",
                      isActive
                        ? center
                          ? "bg-primary shadow-lg shadow-primary/30"
                          : "bg-primary/15"
                        : "bg-transparent hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    {center ? (
                      <div className="relative h-7 w-7 overflow-hidden rounded-xl">
                        <Image
                          src="/logo.jpg"
                          alt="Haven"
                          fill
                          sizes="28px"
                          className="object-contain"
                          priority
                        />
                      </div>
                    ) : (
                      Icon && (
                        <Icon
                          className={[
                            "h-[18px] w-[18px] transition-colors duration-200",
                            isActive ? "text-primary" : "text-muted-foreground",
                          ].join(" ")}
                        />
                      )
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={[
                      "text-[10px] font-medium leading-none transition-colors duration-200",
                      isActive ? "text-foreground" : "text-muted-foreground/70",
                    ].join(" ")}
                  >
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
