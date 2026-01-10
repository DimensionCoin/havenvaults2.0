"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  threshold?: number;
  maxPull?: number;
  disabled?: boolean;

  /** ID of your scroll container (in RootLayout you have id="app") */
  scrollContainerId?: string;
};

export default function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  maxPull = 120,
  disabled = false,
  scrollContainerId = "app",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Track gesture
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lockRef = useRef<"x" | "y" | null>(null);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const getScrollEl = useCallback(() => {
    // Your app scrolls inside #app (RootLayout)
    const el = document.getElementById(scrollContainerId);
    return el;
  }, [scrollContainerId]);

  const getScrollTop = useCallback(() => {
    const el = getScrollEl();
    if (!el) return 0;
    return el.scrollTop;
  }, [getScrollEl]);

  const canStartPull = useCallback(() => {
    if (disabled || isRefreshing) return false;
    // Only allow pull when REAL scroll container is at top
    return getScrollTop() <= 0;
  }, [disabled, isRefreshing, getScrollTop]);

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!canStartPull()) return;

      lockRef.current = null;
      startXRef.current = e.touches[0].clientX;
      startYRef.current = e.touches[0].clientY;
    },
    [canStartPull]
  );

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (disabled || isRefreshing) return;

      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;

      const dx = x - startXRef.current;
      const dy = y - startYRef.current;

      // Decide gesture direction once user moves enough
      if (lockRef.current === null) {
        const intentThreshold = 8;
        if (Math.abs(dx) < intentThreshold && Math.abs(dy) < intentThreshold) {
          return;
        }
        lockRef.current = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      }

      // If horizontal gesture, never interfere (lets carousels feel native)
      if (lockRef.current === "x") return;

      // Vertical gesture: only pull when at top and pulling DOWN
      if (dy > 0 && getScrollTop() <= 0) {
        if (!isPulling && dy > 10) setIsPulling(true);

        if (isPulling) {
          // Stop iOS rubber-band / browser refresh
          e.preventDefault();

          // Resistance curve
          const resistance = 0.5;
          const adjusted = Math.min(dy * resistance, maxPull);
          setPullDistance(adjusted);
        }
      }
    },
    [disabled, isRefreshing, getScrollTop, isPulling, maxPull]
  );

  const onTouchEnd = useCallback(async () => {
    if (!isPulling) {
      lockRef.current = null;
      return;
    }

    setIsPulling(false);

    if (pullDistance >= threshold) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.6);

      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }

    lockRef.current = null;
  }, [isPulling, pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  const progress = Math.min(pullDistance / threshold, 1);
  const showIndicator = pullDistance > 10 || isRefreshing;
  const willRefresh = pullDistance >= threshold;

  return (
    <div ref={containerRef} className="relative min-h-[100dvh]">
      {/* Indicator */}
      <div
        className="absolute left-0 right-0 top-0 z-50 flex items-center justify-center pointer-events-none"
        style={{
          height: pullDistance,
          transition: isPulling ? "none" : "height 0.2s ease-out",
        }}
      >
        {showIndicator && (
          <div
            className={[
              "flex items-center justify-center rounded-full border transition-all duration-200",
              willRefresh || isRefreshing
                ? "bg-emerald-500/20 border-emerald-500/30"
                : "bg-white/10 border-white/20",
            ].join(" ")}
            style={{
              width: 40,
              height: 40,
              opacity: Math.min(progress * 1.5, 1),
              transform: `scale(${0.5 + progress * 0.5})`,
            }}
          >
            {isRefreshing ? (
              <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
            ) : (
              <svg
                className={[
                  "h-5 w-5 transition-transform duration-200",
                  willRefresh ? "text-emerald-400" : "text-white/60",
                ].join(" ")}
                style={{ transform: `rotate(${progress * 180}deg)` }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling ? "none" : "transform 0.2s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
