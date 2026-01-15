// components/dash/USDCAccountsCarousel.tsx
"use client";

import React, {
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import { ArrowLeft, ArrowRight } from "lucide-react";

import DepositAccountCard from "@/components/accounts/DepositAccountCard";
import SpendingAccountCard from "@/components/accounts/SpendingAccountCard";
import FlexSavingsAccountCard from "@/components/accounts/FlexSavingsAccountCard";
import PlusSavingsAccountCard from "@/components/accounts/PlusSavingsAccountCard";
import DepositFlex from "@/components/accounts/flex/Deposit";
import DevEmailGate from "../shared/DevEmailGate";

type SlideKey = "deposit" | "flex" | "plus" | "spending";
type FxPayload = { base?: string; target?: string; rate?: number };

function d128ToNumber(v: unknown): number {
  if (typeof v !== "string") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PEEK_FRACTION = 0.06;
const DRAG_THRESHOLD = 6; // px

const USDCAccountsCarousel: React.FC = () => {
  const { user, loading: userLoading, savingsFlex, savingsPlus } = useUser();
  const { loading: balanceLoading, usdcUsd: cashBalanceDisplay } = useBalance();

  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  // FX (base -> display)
  const [fxRate, setFxRate] = useState(1);
  const [fxReady, setFxReady] = useState(false);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (!user) return;

      if (displayCurrency === "USD") {
        if (!alive) return;
        setFxRate(1);
        setFxReady(true);
        return;
      }

      try {
        const res = await fetch("/api/fx", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) throw new Error(`FX failed (HTTP ${res.status})`);

        const raw = (await res.json().catch(() => ({}))) as FxPayload;
        const rate = Number(raw?.rate);
        if (!Number.isFinite(rate) || rate <= 0) throw new Error("Bad FX rate");

        if (!alive) return;
        setFxRate(rate);
        setFxReady(true);
      } catch {
        if (!alive) return;
        setFxRate(1);
        setFxReady(true);
      }
    };

    setFxReady(false);
    run();

    return () => {
      alive = false;
    };
  }, [user, displayCurrency]);

  const loading = userLoading || balanceLoading || !fxReady;

  const [activeIndex, setActiveIndex] = useState(0);

  // Flex deposit modal
  const [flexDepositOpen, setFlexDepositOpen] = useState(false);

  // Track ref
  const trackRef = useRef<HTMLDivElement | null>(null);

  const getCards = () => {
    const el = trackRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>("[data-carousel-card]"));
  };

  // ✅ Prevent carousel drag logic from hijacking real interactive elements
  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest('button,a,input,select,textarea,[role="button"]')
    );
  };

  // --- ✅ Desktop drag (mouse only), click-friendly ---
  const mouseDown = useRef(false);
  const dragStarted = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const startScroll = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;

    // ✅ keep mobile native
    if (e.pointerType !== "mouse") return;

    // ✅ do not hijack clicks on buttons/links inside cards
    if (isInteractiveTarget(e.target)) return;

    mouseDown.current = true;
    dragStarted.current = false;

    startX.current = e.clientX;
    startY.current = e.clientY;
    startScroll.current = el.scrollLeft;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    if (!mouseDown.current) return;

    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    // ✅ only enter drag mode after threshold (so clicks still work)
    if (!dragStarted.current) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD)
        return;

      dragStarted.current = true;

      try {
        el.setPointerCapture(e.pointerId);
      } catch {}

      // Disable snapping during real drag for smoothness
      el.style.scrollSnapType = "none";
      el.classList.add("is-dragging");
    }

    // Drag scroll
    el.scrollLeft = startScroll.current - dx;
  };

  const endDrag = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;

    if (!mouseDown.current) return;
    mouseDown.current = false;

    // ✅ If we never actually dragged, don't touch anything (clicks go through)
    if (!dragStarted.current) return;

    dragStarted.current = false;

    try {
      el.releasePointerCapture(e.pointerId);
    } catch {}

    el.style.scrollSnapType = "x mandatory";
    el.classList.remove("is-dragging");
  };

  // ✅ Set card width: mobile shows 1 card, desktop shows 2 cards
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const compute = () => {
      const cards = getCards();
      if (!cards.length) return;

      const w = el.clientWidth;

      // Tailwind lg breakpoint (approx)
      const isDesktop = w >= 1024;

      // Slightly smaller peek on desktop so 2-up looks clean
      const peek = isDesktop ? 0.04 : PEEK_FRACTION;
      const safePeek = Math.max(0, Math.min(0.2, peek));

      // How many cards visible at once
      const visible = isDesktop ? 2 : 1;

      // Track uses gap-2 => 8px
      const GAP_PX = 8;
      const gapsTotal = (visible - 1) * GAP_PX;

      // Available width after peeks + gaps
      const available = w * (1 - 2 * safePeek) - gapsTotal;

      // Card width
      const cardWidth = available / visible;

      cards.forEach((c) => (c.style.width = `${cardWidth}px`));
      el.style.scrollPaddingInline = `${w * safePeek}px`;
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  // rAF-throttled active index calc
  const rafRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;

      const el = trackRef.current;
      if (!el) return;

      const cards = getCards();
      if (!cards.length) return;

      const viewportCenter = el.scrollLeft + el.clientWidth / 2;

      let bestIndex = 0;
      let bestDist = Infinity;

      cards.forEach((card, idx) => {
        const center = card.offsetLeft + card.clientWidth / 2;
        const dist = Math.abs(center - viewportCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = idx;
        }
      });

      setActiveIndex((prev) => (prev !== bestIndex ? bestIndex : prev));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const scrollToIndex = (index: number) => {
    const el = trackRef.current;
    if (!el) return;

    const cards = getCards();
    const clamped = Math.max(0, Math.min(cards.length - 1, index));
    const target = cards[clamped];
    if (!target) return;

    target.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
    setActiveIndex(clamped);
  };

  const slides: { key: SlideKey; label: string; index: number }[] = [
    { key: "deposit", label: "Deposit", index: 0 },
    { key: "flex", label: "Flex", index: 1 },
    { key: "plus", label: "Plus", index: 2 },
    { key: "spending", label: "Spend", index: 3 },
  ];

  const goPrev = () =>
    scrollToIndex(activeIndex === 0 ? slides.length - 1 : activeIndex - 1);
  const goNext = () =>
    scrollToIndex(activeIndex === slides.length - 1 ? 0 : activeIndex + 1);

  const mainWallet = user?.walletAddress || "";

  const flexAccount = useMemo(() => {
    if (!savingsFlex?.walletAddress) return undefined;
    if (!savingsFlex.marginfiAccountPk) return undefined;
    const base = d128ToNumber(savingsFlex.principalDeposited);
    return {
      walletAddress: savingsFlex.walletAddress,
      totalDeposited: base * fxRate,
    };
  }, [savingsFlex, fxRate]);

  const plusAccount = useMemo(() => {
    if (!savingsPlus?.walletAddress) return undefined;
    if (!savingsPlus.marginfiAccountPk) return undefined;
    const base = d128ToNumber(savingsPlus.principalDeposited);
    return {
      walletAddress: savingsPlus.walletAddress,
      totalDeposited: base * fxRate,
    };
  }, [savingsPlus, fxRate]);

  if (!user && !userLoading) return null;

  const flexOpened = !!savingsFlex?.marginfiAccountPk;

  const handleDepositClick = (type: SlideKey) =>
    type === "flex" && setFlexDepositOpen(true);
  const handleWithdrawClick = (type: SlideKey) =>
    type === "flex" && setFlexDepositOpen(true);
  const handleOpenAccountClick = (type: SlideKey) =>
    type === "flex" && setFlexDepositOpen(true);
  const handleTransferClick = (type: SlideKey) =>
    type === "flex" && setFlexDepositOpen(true);

  // Spending card placeholder data
  const spendingBalance = 0;
  const spendingLast4 = "••••";
  const spendingHolder = "Haven User";
  const spendingExpires = "••/••";

  return (
    <>
      <DepositFlex
        open={flexDepositOpen}
        onOpenChange={setFlexDepositOpen}
        hasAccount={flexOpened}
      />

      {/* CAROUSEL (ALL SIZES) */}
      <section className="w-full space-y-2">
        <div className="flex items-center justify-between gap-3">
          {/* Tabs */}
          <div className="flex gap-1.5">
            {slides.map((s) => {
              const isActive = s.index === activeIndex;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => scrollToIndex(s.index)}
                  className={[
                    "rounded-full px-3 py-1 text-[11px] font-medium transition border",
                    "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground",
                    isActive
                      ? "bg-primary text-primary-foreground border-primary/30 shadow-[0_10px_26px_rgba(41,198,104,0.18)] dark:shadow-[0_12px_30px_rgba(63,243,135,0.14)]"
                      : "",
                  ].join(" ")}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Prev / Next */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goPrev}
              className="haven-icon-btn"
              aria-label="Previous"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="haven-icon-btn"
              aria-label="Next"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="-mx-2 px-2 lg:-mx-3 lg:px-3">
          <div
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={endDrag}
            onScroll={handleScroll}
            className={[
              "carousel-track",
              "relative flex gap-2 overflow-x-auto snap-x snap-mandatory",
              "scrollbar-hide",
              "[-webkit-overflow-scrolling:touch]",
              "[touch-action:pan-x]",
              "[overscroll-behavior-x:contain] [overscroll-behavior-y:auto]",
            ].join(" ")}
            style={{ scrollSnapType: "x mandatory" }}
          >
            <div
              data-carousel-card
              className="snap-center shrink-0 [scroll-snap-stop:always]"
            >
              <DepositAccountCard
                loading={loading}
                walletAddress={mainWallet}
                balanceOverride={cashBalanceDisplay}
                onDeposit={() => handleDepositClick("deposit")}
                onWithdraw={() => handleWithdrawClick("deposit")}
                onTransfer={() => handleTransferClick("deposit")}
              />
            </div>

            <div
              data-carousel-card
              className="snap-center shrink-0 [scroll-snap-stop:always]"
            >
              <FlexSavingsAccountCard
                account={flexAccount}
                loading={loading}
                displayCurrency={displayCurrency}
                onDeposit={() => handleDepositClick("flex")}
                onWithdraw={() => handleWithdrawClick("flex")}
                onOpenAccount={() => handleOpenAccountClick("flex")}
              />
            </div>

            <div
              data-carousel-card
              className="snap-center shrink-0 [scroll-snap-stop:always]"
            >
              <PlusSavingsAccountCard
                account={plusAccount}
                loading={loading}
                displayCurrency={displayCurrency}
                onDeposit={() => handleDepositClick("plus")}
                onWithdraw={() => handleWithdrawClick("plus")}
                onOpenAccount={() => handleOpenAccountClick("plus")}
              />
            </div>

            <div
              data-carousel-card
              className="snap-center shrink-0 [scroll-snap-stop:always]"
            >
              <div
                data-carousel-card
                className="snap-center shrink-0 [scroll-snap-stop:always]"
              >
                <DevEmailGate
                  allowEmails={["nick.vassallo97@gmail.com", "test@yourdomain.com"]}
                  title="Spending is temporarily restricted"
                  message="We’re currently in approval/testing. This feature will be enabled for everyone soon."
                >
                  <SpendingAccountCard
                    loading={loading}
                    balance={spendingBalance}
                    last4={spendingLast4}
                    holderName={spendingHolder}
                    expires={spendingExpires}
                    onDeposit={() => handleDepositClick("spending")}
                    onWithdraw={() => handleWithdrawClick("spending")}
                  />
                </DevEmailGate>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default USDCAccountsCarousel;
