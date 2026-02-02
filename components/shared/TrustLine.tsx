"use client";

import Link from "next/link";
import { Lock } from "lucide-react";

type TrustLineProps = {
  className?: string;
  compact?: boolean;
  align?: "left" | "center";
  withLink?: boolean;
  linkHref?: string;
  linkLabel?: string;
};

const TRUST_COPY =
  "Self-custodial by design. Haven Financial and Privy never access your private keys or move your funds.";

export function TrustLine({
  className,
  compact = false,
  align = "left",
  withLink = false,
  linkHref = "/security",
  linkLabel = "Learn more",
}: TrustLineProps) {
  const base = [
    "flex",
    "gap-2",
    align === "center"
      ? "items-center justify-center text-center"
      : "items-start",
    compact ? "text-[11px]" : "text-xs",
    "text-muted-foreground",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={base}>
      <div className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background/60">
        <Lock className="h-3 w-3 text-primary" />
      </div>
      <div className={align === "center" ? "max-w-lg" : ""}>
        <span>{TRUST_COPY}</span>
        {withLink ? (
          <>
            {" "}
            <Link
              href={linkHref}
              className="text-foreground underline underline-offset-2"
            >
              {linkLabel}
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
