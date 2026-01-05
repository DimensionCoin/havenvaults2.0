"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  /** Pull distance required to trigger refresh (default: 80) */
  threshold?: number;
  /** Max pull distance (default: 120) */
  maxPull?: number;
  /** Disable pull to refresh */
  disabled?: boolean;
};

export default function PullToRefresh({
  onRefresh,
  children,
  threshold = 80,
  maxPull = 120,
  disabled = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const canPull = useCallback(() => {
    if (disabled || isRefreshing) return false;
    // Only allow pull when at top of page
    return window.scrollY <= 0;
  }, [disabled, isRefreshing]);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!canPull()) return;
      startYRef.current = e.touches[0].clientY;
      currentYRef.current = startYRef.current;
    },
    [canPull]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!canPull() && !isPulling) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      // Only activate if pulling down from top
      if (diff > 0 && window.scrollY <= 0) {
        // Start pulling
        if (!isPulling && diff > 10) {
          setIsPulling(true);
        }

        if (isPulling) {
          // Prevent default scroll behavior
          e.preventDefault();

          // Apply resistance - gets harder to pull as you go
          const resistance = 0.5;
          const adjustedDiff = Math.min(diff * resistance, maxPull);

          currentYRef.current = currentY;
          setPullDistance(adjustedDiff);
        }
      }
    },
    [canPull, isPulling, maxPull]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling) return;

    setIsPulling(false);

    if (pullDistance >= threshold) {
      // Trigger refresh
      setIsRefreshing(true);
      setPullDistance(threshold * 0.6); // Hold at smaller height while refreshing

      try {
        await onRefresh();
      } catch (err) {
        console.error("Refresh failed:", err);
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      // Snap back
      setPullDistance(0);
    }

    startYRef.current = 0;
    currentYRef.current = 0;
  }, [isPulling, pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use passive: false to allow preventDefault on touchmove
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Calculate visual states
  const progress = Math.min(pullDistance / threshold, 1);
  const showIndicator = pullDistance > 10 || isRefreshing;
  const willRefresh = pullDistance >= threshold;

  return (
    <div ref={containerRef} className="relative min-h-screen">
      {/* Pull indicator */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center overflow-hidden pointer-events-none z-50"
        style={{
          height: pullDistance,
          top: 0,
          transition: isPulling ? "none" : "height 0.2s ease-out",
        }}
      >
        {showIndicator && (
          <div
            className={`flex items-center justify-center rounded-full transition-all duration-200 ${
              willRefresh || isRefreshing
                ? "bg-emerald-500/20 border-emerald-500/30"
                : "bg-white/10 border-white/20"
            } border`}
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
                className={`h-5 w-5 transition-transform duration-200 ${
                  willRefresh ? "text-emerald-400" : "text-white/60"
                }`}
                style={{
                  transform: `rotate(${progress * 180}deg)`,
                }}
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

      {/* Content with transform */}
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
