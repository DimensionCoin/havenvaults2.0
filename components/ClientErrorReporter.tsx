// components/ClientErrorReporter.tsx
"use client";

import { useEffect, useRef } from "react";

type ClientErrorPayload = {
  source: "client";
  name?: string;
  message: string;
  stack?: string;
  route?: string;
  url?: string;
  meta?: Record<string, unknown>;
};

function safeString(v: unknown, max = 500): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function getRoute(): string {
  if (typeof window === "undefined") return "";
  return window.location?.pathname || "";
}

function getUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location?.href || "";
}

function buildPayloadFromError(err: unknown): ClientErrorPayload | null {
  if (!err) return null;

  if (err instanceof Error) {
    return {
      source: "client",
      name: safeString(err.name, 120),
      message: safeString(err.message, 500) || "Unknown error",
      stack: safeString(err.stack, 4000),
      route: getRoute(),
      url: getUrl(),
    };
  }

  const msg = safeString(String(err), 500) || "Unknown error";
  return {
    source: "client",
    message: msg,
    route: getRoute(),
    url: getUrl(),
  };
}

export default function ClientErrorReporter() {
  const lastSentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const send = async (payload: ClientErrorPayload) => {
      const key = `${payload.name || ""}|${payload.message}|${payload.route || ""}`;
      const now = Date.now();
      const last = lastSentRef.current.get(key) || 0;
      if (now - last < 10_000) return;
      lastSentRef.current.set(key, now);

      try {
        const body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon("/api/vitals/error", blob);
          return;
        }
        await fetch("/api/vitals/error", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          credentials: "include",
          keepalive: true,
        });
      } catch {
        // Intentionally swallow logging errors
      }
    };

    const onError = (event: ErrorEvent) => {
      const payload =
        buildPayloadFromError(event.error) ||
        (event.message
          ? {
              source: "client",
              message: safeString(event.message, 500) || "Unknown error",
              route: getRoute(),
              url: getUrl(),
              meta: {
                filename: safeString(event.filename, 300),
                lineno: event.lineno,
                colno: event.colno,
              },
            }
          : null);

      if (payload) void send(payload);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const payload = buildPayloadFromError(event.reason);
      if (payload) void send(payload);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
