"use client";

import * as React from "react";
import { Bell, X, Sparkles } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";

const NotificationButton: React.FC = () => {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {/* Icon button (matches ThemeToggle) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "inline-flex items-center justify-center",
          "h-8 w-8 rounded-full",
          "border bg-card/80 backdrop-blur-xl",
          "shadow-fintech-sm",
          "transition-colors hover:bg-secondary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ].join(" ")}
        aria-label="Open notifications"
        title="Notifications"
      >
        <Bell className="h-4 w-4 text-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={[
            // Mobile-first: full screen sheet
            "p-0 overflow-hidden flex flex-col",
            "border border-border bg-card text-card-foreground shadow-fintech-lg",

            "max-sm:!inset-0 max-sm:!w-screen max-sm:!max-w-none",
            "max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!rounded-none",
            "max-sm:!left-0 max-sm:!top-0 max-sm:!translate-x-0 max-sm:!translate-y-0",

            // Desktop: centered card
            "sm:w-[min(92vw,420px)] sm:max-w-[420px]",
            "sm:max-h-[90vh] sm:rounded-[28px]",
          ].join(" ")}
        >
          {/* Top bar */}
          <div
            className={[
              "shrink-0 border-b border-border",
              "bg-card/95 backdrop-blur-xl",
              "px-4 sm:px-5",
              "pt-[calc(env(safe-area-inset-top)+14px)] pb-3",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.20em] text-muted-foreground">
                  Haven
                </p>
                <h2 className="text-base font-semibold text-foreground">
                  Notifications
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className={[
                  "inline-flex items-center justify-center",
                  "h-9 w-9 rounded-full",
                  "border bg-card/80 backdrop-blur-xl",
                  "shadow-fintech-sm",
                  "transition-colors hover:bg-secondary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ].join(" ")}
                aria-label="Close notifications"
                title="Close"
              >
                <X className="h-4 w-4 text-foreground" />
              </button>
            </div>
          </div>

          {/* Body (centered empty state, mobile-friendly) */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar overscroll-contain px-4 py-5 sm:px-5 sm:py-5">
            <div className="mx-auto flex max-w-sm flex-col items-center text-center">
              {/* Big icon bubble */}
              <div className="relative">
                <div className="glow-mint absolute inset-0 rounded-full" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-border bg-secondary">
                  <Bell className="h-7 w-7 text-foreground" />
                </div>
              </div>

              <h3 className="mt-4 text-lg font-semibold text-foreground">
                Coming soon
              </h3>

              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                We’ll notify you about deposits, transfers, price alerts, and
                important account updates — all in one place.
              </p>

              {/* Feature chips */}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <span className="haven-pill">Deposits</span>
                <span className="haven-pill">Transfers</span>
                <span className="haven-pill">Price alerts</span>
                <span className="haven-pill">Security</span>
              </div>

              {/* Small “preview” card */}
              <div className="mt-5 w-full rounded-3xl border border-border bg-secondary/60 px-4 py-4 text-left">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/60">
                    <Sparkles className="h-4 w-4 text-foreground/80" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-foreground">
                      Smart updates
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      You’ll get clean, non-spammy alerts — only what matters.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom pinned button (thumb-friendly) */}
          <div
            className={[
              "shrink-0 border-t border-border",
              "bg-card/95 backdrop-blur-xl",
              "px-4 sm:px-5",
              "py-3 pb-[calc(env(safe-area-inset-bottom)+14px)]",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="haven-btn-primary"
            >
              Got it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default NotificationButton;
