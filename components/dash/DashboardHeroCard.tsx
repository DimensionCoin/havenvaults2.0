// components/dash/DashboardHeroCard.tsx
"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  ArrowDownRight,
  MoreHorizontal,
  User,
  Settings,
} from "lucide-react";

import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import HistoryChart from "@/components/dash/Chart";
import ThemeToggle from "../shared/ThemeToggle";
import NotificationButton from "../shared/NotificationButton";
import { LogoutButton } from "@/components/shared/LogoutButton";

/* ---------------- helpers ---------------- */

const formatTotalUsd = (value?: number | null): string => {
  if (value === undefined || value === null || Number.isNaN(value))
    return "$0.00";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/* ---------------- pill shell ---------------- */

function PillShell({
  children,
  className,
  ariaLabel = "Quick actions",
}: {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={[
        "flex items-center",
        "gap-2.5",
        "rounded-full border border-border",
        "bg-card/80 backdrop-blur-xl",
        "shadow-fintech-sm",
        "px-2.5 py-2",
        className || "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function PillDivider({ className }: { className?: string }) {
  return (
    <div className={["h-8 w-px bg-border/70", className || ""].join(" ")} />
  );
}

function PillIconButton({
  children,
  ariaLabel,
  onClick,
  className,
  asButton = true,
}: {
  children: React.ReactNode;
  ariaLabel?: string;
  onClick?: () => void;
  className?: string;
  asButton?: boolean;
}) {
  const base = [
    "flex items-center justify-center",
    "h-10 w-10",
    "rounded-full border border-border",
    "bg-card/80 shadow-fintech-sm",
    "text-foreground/80 hover:text-foreground",
    "hover:bg-secondary transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className || "",
  ].join(" ");

  if (!asButton) {
    return (
      <div aria-label={ariaLabel} className={base}>
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={base}
    >
      {children}
    </button>
  );
}

/* ---------------- account dropdown (PORTAL) ---------------- */

type MenuPos = { top: number; left: number; width: number };

function AccountDropdown() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);

  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  const items = useMemo(
    () => [
      { href: "/profile", label: "Profile", Icon: User },
      { href: "/settings", label: "Settings", Icon: Settings },
    ],
    []
  );

  useEffect(() => setMounted(true), []);

  // close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // position menu (fixed) under the button
  useLayoutEffect(() => {
    if (!open) return;
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;

    const width = 208;
    const left = Math.min(
      window.innerWidth - 12 - width,
      Math.max(12, b.right - width)
    );

    setPos({
      top: b.bottom + 10,
      left,
      width,
    });
  }, [open]);

  // close on outside click + ESC
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;

      const inBtn = !!btnRef.current && btnRef.current.contains(t);
      const inMenu = !!menuRef.current && menuRef.current.contains(t);

      if (!inBtn && !inMenu) setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("touchstart", onPointerDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const menu =
    open && mounted && pos
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Account options"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
            className={[
              "z-[99999]",
              "rounded-2xl border border-border",
              "bg-popover",
              "backdrop-blur-xl",
              "shadow-fintech-lg",
              "p-1.5",
            ].join(" ")}
          >
            {items.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={[
                  "flex items-center gap-2",
                  "rounded-xl px-3 py-2.5",
                  "text-sm font-medium",
                  "text-primary",
                  "hover:bg-accent transition",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{label}</span>
              </Link>
            ))}

            <div className="my-1.5 h-px bg-border" />

            <LogoutButton />
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center justify-center",
          "h-10 w-10",
          "rounded-full border border-border",
          "bg-card/80 shadow-fintech-sm",
          "text-foreground/80 hover:text-foreground",
          "hover:bg-secondary transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ].join(" ")}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {menu}
    </>
  );
}

/* ---------------- main card ---------------- */

const DashboardHeroCard: React.FC = () => {
  const { user } = useUser();
  const {
    totalUsd,
    totalChange24hUsd,
    totalChange24hPct,
    loading: balanceLoading,
  } = useBalance();

  if (!user) return null;

  const avatarUrl = user.profileImageUrl || null;
  const displayName = user.firstName || "Investor";

  const initials =
    !avatarUrl && user
      ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()
      : "HV";

  const formattedTotal = formatTotalUsd(totalUsd);

  const changeUsd =
    typeof totalChange24hUsd === "number" && !Number.isNaN(totalChange24hUsd)
      ? totalChange24hUsd
      : 0;

  const changePct =
    typeof totalChange24hPct === "number" && !Number.isNaN(totalChange24hPct)
      ? totalChange24hPct * 100
      : 0;

  const isPositive = changeUsd >= 0;

  return (
    <section className="w-full">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card pt-5 md:px-6 md:pt-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-foreground/10 to-transparent dark:from-foreground/12" />

        {/* Header row */}
        <div className="relative z-10 flex items-center justify-between gap-4 px-4 md:px-0">
          <div className="flex items-center gap-3 md:gap-4">
            <Link
              href="/profile"
              className="
                relative flex h-12 w-12 md:h-14 md:w-14 items-center justify-center overflow-hidden rounded-full
                border border-border bg-secondary
                shadow-[0_10px_22px_rgba(0,0,0,0.10)] dark:shadow-[0_14px_38px_rgba(0,0,0,0.55)]
                transition hover:border-primary/30
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              "
              aria-label="Go to profile"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-[12px] font-semibold text-foreground/85">
                  {initials}
                </span>
              )}
            </Link>

            <div className="flex flex-col leading-tight">
              <span className="text-[11px] md:text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.22em]">
                Welcome back
              </span>
              <span className="text-[22px] md:text-4xl font-semibold tracking-tight text-foreground">
                {displayName}
              </span>
            </div>
          </div>

          <PillShell>
            <PillIconButton ariaLabel="Theme" asButton={false}>
              <ThemeToggle />
            </PillIconButton>

            <PillDivider />

            <PillIconButton ariaLabel="Notifications" asButton={false}>
              <NotificationButton />
            </PillIconButton>

            <PillDivider />

            <AccountDropdown />
          </PillShell>
        </div>

        {/* Balance + 24h change */}
        <div className="relative z-10 mt-5 flex items-end justify-between gap-4 px-4 md:px-0">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.20em] text-muted-foreground">
              Total account balance
            </p>
            <p className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
              {balanceLoading ? "…" : formattedTotal}
            </p>
          </div>

          <div
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[10px] md:text-xs font-semibold border",
              isPositive
                ? "bg-primary/10 text-foreground border-primary/20"
                : "bg-destructive/10 text-foreground border-destructive/20",
            ].join(" ")}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background/60 border border-border">
              {isPositive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
            </span>
            <span className="tabular-nums">
              ${Math.abs(changeUsd).toFixed(2)} (
              {Math.abs(changePct).toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Chart block */}
        <div className="relative z-10 mt-5 mb-0 md:mb-3 rounded-2xl border border-border bg-secondary px-3 pt-2 pb-2">
          <HistoryChart />
        </div>
      </div>
    </section>
  );
};

export default DashboardHeroCard;
