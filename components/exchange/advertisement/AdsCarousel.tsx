// components/exchange/advertisement/AdsCarousel.tsx
"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";

type AdsCarouselProps = {
  items: React.ReactNode[];
  autoAdvanceMs?: number; // default 5s
};

const AdsCarousel: React.FC<AdsCarouselProps> = ({
  items,
  autoAdvanceMs = 25000,
}) => {
  const [index, setIndex] = useState(0);

  const safeItems = useMemo(() => items.filter(Boolean), [items]);
  const count = safeItems.length;

  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);
  const isSwiping = useRef(false);

  const isSingle = count <= 1;

  // auto-advance
  useEffect(() => {
    if (isSingle) return;

    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, autoAdvanceMs);

    return () => clearInterval(id);
  }, [count, autoAdvanceMs, isSingle]);

  // no carousel needed with 0 or 1 item
  if (isSingle) {
    return <div className="mb-4">{safeItems[0] ?? null}</div>;
  }

  const goPrev = () => {
    setIndex((prev) => (prev - 1 + count) % count);
  };

  const goNext = () => {
    setIndex((prev) => (prev + 1) % count);
  };

  // touch / swipe handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
    isSwiping.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isSwiping.current || touchStartX.current == null) return;
    const currentX = e.touches[0].clientX;
    touchDeltaX.current = currentX - touchStartX.current;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current) return;

    const threshold = 40; // px to trigger swipe
    if (touchDeltaX.current > threshold) {
      goPrev();
    } else if (touchDeltaX.current < -threshold) {
      goNext();
    }

    touchStartX.current = null;
    touchDeltaX.current = 0;
    isSwiping.current = false;
  };

  return (
    <section className="mb-4">
      <div
        className="relative overflow-hidden "
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* slides */}
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {safeItems.map((item, i) => (
            <div key={i} className="w-full shrink-0 ">
              {item}
            </div>
          ))}
        </div>

        

        {/* dots */}
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
          {safeItems.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? "w-4 bg-emerald-400"
                  : "w-2 bg-zinc-600 hover:bg-zinc-400"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default AdsCarousel;
