"use client";

import { useEffect, useMemo, useState } from "react";

type PrincipalRes = {
  ok?: boolean;
  hasAccount?: boolean;
  principalNet?: number;
  interestWithdrawn?: number;
  error?: string;
};

const toNum = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const clamp0 = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function useFlexInterestFromBalance(opts: {
  enabled: boolean;
  onchainBalanceUsdc: number; // pass BalanceProvider's savingsFlexAmount
}) {
  const { enabled, onchainBalanceUsdc } = opts;

  const [loading, setLoading] = useState(false);
  const [principalNet, setPrincipalNet] = useState(0);
  const [interestWithdrawn, setInterestWithdrawn] = useState(0);
  const [hasAccount, setHasAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const ac = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/savings/flex/principal", {
          cache: "no-store",
          credentials: "include",
          signal: ac.signal,
        });

        const j = (await res.json().catch(() => ({}))) as PrincipalRes;

        if (!res.ok || j?.ok === false) {
          throw new Error(j?.error || `Principal failed (${res.status})`);
        }

        if (cancelled) return;

        setHasAccount(!!j.hasAccount);
        setPrincipalNet(clamp0(toNum(j.principalNet)));
        setInterestWithdrawn(clamp0(toNum(j.interestWithdrawn)));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load interest");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [enabled]);

  const unrealizedInterest = useMemo(() => {
    return clamp0(clamp0(onchainBalanceUsdc) - principalNet);
  }, [onchainBalanceUsdc, principalNet]);

  const lifetimeInterestEarned = useMemo(() => {
    // only meaningful if withdraw rows split principalPart/interestPart correctly
    return clamp0(interestWithdrawn + unrealizedInterest);
  }, [interestWithdrawn, unrealizedInterest]);

  return {
    loading,
    error,
    hasAccount,

    principalNet,
    onchainBalanceUsdc: clamp0(onchainBalanceUsdc),

    unrealizedInterest,
    interestWithdrawn,
    lifetimeInterestEarned,
  };
}
