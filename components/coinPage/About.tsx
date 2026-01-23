// components/coinPage/About.tsx
"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

type Props = {
  /** Token name/symbol for headings */
  name?: string;
  symbol?: string;

  /** CoinGecko description (we pass this from the parent spot-price fetch) */
  description?: string | null;

  /** Optional extras if you decide to pass them later (safe to ignore now) */
  homepageUrl?: string | null;
};

function stripHtmlToText(html: string): string {
  // CoinGecko descriptions are often HTML. Convert to text safely on the client.
  if (typeof window === "undefined") return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").trim();
}

function clampText(
  s: string,
  maxChars: number,
): { text: string; clipped: boolean } {
  if (s.length <= maxChars) return { text: s, clipped: false };
  return { text: s.slice(0, maxChars).trimEnd() + "…", clipped: true };
}

export default function About({
  name,
  symbol,
  description,
  homepageUrl,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const cleaned = useMemo(() => {
    const raw = (description || "").trim();
    if (!raw) return "";
    // Many CG descriptions include HTML tags + newlines.
    const asText = stripHtmlToText(raw);
    // Normalize whitespace a bit so it reads clean in UI.
    return asText
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }, [description]);

  const { text: preview, clipped } = useMemo(() => {
    if (!cleaned) return { text: "", clipped: false };
    // keep it tight like the rest of your coin page cards
    return clampText(cleaned, 520);
  }, [cleaned]);

  const title = symbol
    ? `${symbol} Overview`
    : name
      ? `${name} Overview`
      : "About";

  // If we don’t have a CoinGecko description, show nothing (keeps layout clean)
  if (!cleaned) return null;

  const shown = expanded ? cleaned : preview;

  return (
    <section className=" overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 border-b bg-card/60 px-3 py-3 text-left backdrop-blur-xl sm:px-4"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {title}
          </div>
        </div>

        
      </button>

      <div className="px-3 py-3 sm:px-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
          {shown}
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          {clipped ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium text-foreground/70 underline-offset-4 hover:underline"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          ) : (
            <span />
          )}

          {homepageUrl ? (
            <a
              href={homepageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground/70 underline-offset-4 hover:underline"
            >
              Website <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
