// components/shared/BottomBar.tsx
"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LineChart, Zap, ArrowDownUp, Layers } from "lucide-react";

const navItems = [
  // ✅ Order: Markets, Portfolio, Home, Bundles, Multiply
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
      className="fixed inset-x-0 z-50 md:hidden"
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 0px)",
      }}
    >
      <div className="mx-auto max-w-md px-3">
        {/* Clean, friendly pill */}
        <div className="rounded-3xl border border-white/10 bg-background/85 backdrop-blur-xl shadow-lg shadow-black/20">
          <div className="relative grid grid-cols-5 items-end px-2 py-2">
            {navItems.map(({ href, label, Icon, center }) => {
              const isActive =
                href === "/dashboard"
                  ? pathname === href
                  : pathname.startsWith(href);

              // ✅ Keep everything aligned by giving every item the same "slot"
              const slotCls = "flex flex-col items-center justify-end gap-1";

              const labelCls = [
                "text-[10px] font-medium leading-none",
                isActive ? "text-foreground" : "text-muted-foreground",
              ].join(" ");

              // ✅ Icon button styles
              const baseBtn =
                "grid place-items-center rounded-2xl border transition-all active:scale-[0.98]";

              // Center button is the same baseline (no translate) so it doesn't float above others.
              const btnCls = center
                ? [
                    baseBtn,
                    "h-11 w-11",
                    isActive
                      ? "border-primary/30 bg-primary/20"
                      : "border-white/10 bg-white/[0.06]",
                  ].join(" ")
                : [
                    baseBtn,
                    "h-10 w-10",
                    isActive
                      ? "border-primary/25 bg-primary/15"
                      : "border-white/10 bg-white/[0.06] hover:bg-white/[0.09]",
                  ].join(" ");

              return (
                <Link
                  key={href}
                  href={href}
                  className={slotCls}
                  aria-current={isActive ? "page" : undefined}
                >
                  <div className={btnCls}>
                    {center ? (
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

                  <span className={labelCls}>{label}</span>

                  {/* ✅ Tiny active indicator keeps it feeling "app-like" */}
                  <span
                    className={[
                      "mt-0.5 h-[3px] w-6 rounded-full transition-opacity",
                      isActive ? "opacity-100 bg-primary/80" : "opacity-0",
                    ].join(" ")}
                  />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
