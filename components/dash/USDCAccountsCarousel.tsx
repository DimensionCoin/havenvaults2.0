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
import FlexSavingsAccountCard from "@/components/accounts/FlexSavingsAccountCard";
import PlusSavingsAccountCard from "@/components/accounts/PlusSavingsAccountCard";
import DepositFlex from "@/components/accounts/flex/Deposit";

type SlideKey = "deposit" | "flex" | "plus";

/**
 * Decimal128 strings come back as "0", "12.34", etc.
 * Convert safely for UI display.
 */
function d128ToNumber(v: unknown): number {
  if (typeof v !== "string") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type FxPayload = {
  base?: string;
  target?: string;
  rate?: number;
};

const USDCAccountsCarousel: React.FC = () => {
  // ✅ provider exposes derived savings helpers + flags
  const {
    user,
    loading: userLoading,
    savingsFlex,
    savingsPlus,
  } = useUser();

  // `cashBalanceDisplay` is already in the user's display currency (per your BalanceProvider)
  const { loading: balanceLoading, usdcUsd: cashBalanceDisplay } = useBalance();

  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  // FX (base -> display). We use it to convert the savings aggregates for display.
  // No separate hook — kept local to this component.
  const [fxRate, setFxRate] = useState<number>(1);
  const [fxReady, setFxReady] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      // If user isn't loaded yet, skip.
      if (!user) return;

      // If display currency is USD, rate is 1.
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

        // server returns base->target rate
        if (!Number.isFinite(rate) || rate <= 0) throw new Error("Bad FX rate");

        if (!alive) return;
        setFxRate(rate);
        setFxReady(true);
      } catch {
        // Fail soft: still render with rate=1
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

  // === layout / drag state for MOBILE carousel ===
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);

  const PEEK_FRACTION = 0.06;

  const isInteractiveElement = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;

    let el: HTMLElement | null = target;
    while (el && el !== trackRef.current) {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");

      if (
        tag === "button" ||
        tag === "a" ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        role === "button" ||
        el.hasAttribute("onclick") ||
        el.style.cursor === "pointer"
      ) {
        return true;
      }

      el = el.parentElement;
    }

    return false;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (isInteractiveElement(e.target)) return;
    const el = trackRef.current;
    if (!el) return;
    el.style.scrollSnapType = "none";
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartX.current = e.clientX;
    dragStartScroll.current = el.scrollLeft;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const el = trackRef.current;
    if (!el) return;
    const dx = e.clientX - dragStartX.current;
    el.scrollLeft = dragStartScroll.current - dx;
  };

  const endDrag = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {}
    setDragging(false);
    el.style.scrollSnapType = "x mandatory";
  };

  // set card width so active card has peeks on both sides
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const safePeek = Math.max(0, Math.min(0.2, PEEK_FRACTION));

    const compute = () => {
      const cardWidth = el.clientWidth * (1 - 2 * safePeek);
      const cards = el.querySelectorAll<HTMLElement>("[data-carousel-card]");
      cards.forEach((c) => {
        c.style.width = `${cardWidth}px`;
      });
    };

    compute();
    const id = requestAnimationFrame(compute);

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, []);

  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const cards = el.querySelectorAll<HTMLElement>("[data-carousel-card]");
    if (!cards.length) return;

    const viewportCenter = el.scrollLeft + el.clientWidth / 2;

    let bestIndex = 0;
    let bestDist = Infinity;

    cards.forEach((card, idx) => {
      const cardLeft = card.offsetLeft;
      const cardCenter = cardLeft + card.clientWidth / 2;
      const dist = Math.abs(cardCenter - viewportCenter);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = idx;
      }
    });

    setActiveIndex((prev) => (prev !== bestIndex ? bestIndex : prev));
  }, []);

  const scrollToIndex = (index: number) => {
    const el = trackRef.current;
    if (!el) return;
    const cards = el.querySelectorAll<HTMLElement>("[data-carousel-card]");
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
    { key: "deposit", label: "Deposit Account", index: 0 },
    { key: "flex", label: "Flex Account", index: 1 },
    { key: "plus", label: "Plus Account", index: 2 },
  ];

  const goPrev = () => {
    const nextIndex = activeIndex === 0 ? slides.length - 1 : activeIndex - 1;
    scrollToIndex(nextIndex);
  };

  const goNext = () => {
    const nextIndex = activeIndex === slides.length - 1 ? 0 : activeIndex + 1;
    scrollToIndex(nextIndex);
  };

  const mainWallet = user?.walletAddress || "";

  /**
   * ✅ Adapt new savings shape to cards:
   * Cards expect { walletAddress, totalDeposited } where totalDeposited is in DISPLAY currency.
   * We treat “opened” as: marginfiAccountPk present.
   */
  const flexAccount = useMemo(() => {
    if (!savingsFlex?.walletAddress) return undefined;
    if (!savingsFlex.marginfiAccountPk) return undefined;

    const base = d128ToNumber(savingsFlex.principalDeposited); // base units (USD)
    const display = base * fxRate;

    return {
      walletAddress: savingsFlex.walletAddress,
      totalDeposited: display,
    };
  }, [savingsFlex, fxRate]);

  const plusAccount = useMemo(() => {
    if (!savingsPlus?.walletAddress) return undefined;
    if (!savingsPlus.marginfiAccountPk) return undefined;

    const base = d128ToNumber(savingsPlus.principalDeposited);
    const display = base * fxRate;

    return {
      walletAddress: savingsPlus.walletAddress,
      totalDeposited: display,
    };
  }, [savingsPlus, fxRate]);

  // If user is fully resolved and absent, hide component
  if (!user && !userLoading) return null;

  // Actions
  const handleDepositClick = (type: SlideKey) => {
    if (type === "flex") {
      setFlexDepositOpen(true);
      return;
    }
    // TODO: wire plus + main deposit flows
  };

  const handleWithdrawClick = (type: SlideKey) => {
    if (type === "flex") {
      setFlexDepositOpen(true);
      return;
    }
    // TODO: wire withdraw flows for other account types
  };

  const handleOpenAccountClick = (type: SlideKey) => {
    // In this flow, open + deposit is the same path.
    if (type === "flex") {
      setFlexDepositOpen(true);
      return;
    }
    // TODO: wire plus open/deposit
  };

  const handleTransferClick = (type: SlideKey) => {
    if (type === "flex") {
      setFlexDepositOpen(true);
      return;
    }
    // TODO: wire transfer flow for other account types
  };

  const flexOpened = !!savingsFlex?.marginfiAccountPk;

  return (
    <>
      {/* Flex deposit modal (open+deposit if needed) */}
      <DepositFlex
        open={flexDepositOpen}
        onOpenChange={setFlexDepositOpen}
        hasAccount={flexOpened}
      />

      {/* MOBILE / TABLET: carousel (up to lg) */}
      <section className="w-full space-y-2 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {slides.map((s) => {
              const isActive = s.index === activeIndex;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => scrollToIndex(s.index)}
                  className={`rounded-full px-3 py-1 text-[10px] font-medium transition ${
                    isActive
                      ? "bg-primary text-black shadow-[0_0_16px_rgba(190,242,100,0.6)]"
                      : "bg-zinc-900 text-zinc-400"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goPrev}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="-mx-2 px-2">
          <div
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onScroll={handleScroll}
            className={`
              relative flex gap-2 overflow-x-auto
              snap-x snap-mandatory
              select-none
              [-ms-overflow-style:'none'] [scrollbar-width:'none']
              ${dragging ? "cursor-grabbing" : "cursor-grab"}
              touch-pan-x
              [touch-action:pan-x]
              [will-change:scroll-position]
            `}
            style={{ scrollSnapType: "x mandatory" }}
          >
            <style>{`div::-webkit-scrollbar{ display: none; }`}</style>

            {/* Deposit slide */}
            <div
              data-carousel-card
              className="snap-center shrink-0 rounded-2xl"
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

            {/* Flex savings slide */}
            <div
              data-carousel-card
              className="snap-center shrink-0 rounded-2xl"
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

            {/* Plus savings slide */}
            <div
              data-carousel-card
              className="snap-center shrink-0 rounded-2xl"
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
          </div>
        </div>
      </section>

      {/* DESKTOP: stack all three horizontally */}
      <section className="hidden w-full gap-3 lg:flex">
        <DepositAccountCard
          loading={loading}
          walletAddress={mainWallet}
          balanceOverride={cashBalanceDisplay}
          onDeposit={() => handleDepositClick("deposit")}
          onWithdraw={() => handleWithdrawClick("deposit")}
          onTransfer={() => handleTransferClick("deposit")}
        />

        <FlexSavingsAccountCard
          account={flexAccount}
          loading={loading}
          displayCurrency={displayCurrency}
          onDeposit={() => handleDepositClick("flex")}
          onWithdraw={() => handleWithdrawClick("flex")}
          onOpenAccount={() => handleOpenAccountClick("flex")}
        />

        <PlusSavingsAccountCard
          account={plusAccount}
          loading={loading}
          displayCurrency={displayCurrency}
          onDeposit={() => handleDepositClick("plus")}
          onWithdraw={() => handleWithdrawClick("plus")}
          onOpenAccount={() => handleOpenAccountClick("plus")}
        />
      </section>
    </>
  );
};

export default USDCAccountsCarousel;
