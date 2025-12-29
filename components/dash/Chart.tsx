// components/dash/Chart.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useUser } from "@/providers/UserProvider";
import { useBalance } from "@/providers/BalanceProvider";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

type RangeKey = "1d" | "1w" | "1m" | "1y";

const RANGE_OPTIONS: {
  key: RangeKey;
  label: string;
  visibleDays: number;
}[] = [
  { key: "1d", label: "1D", visibleDays: 1 },
  { key: "1w", label: "1W", visibleDays: 7 },
  { key: "1m", label: "1M", visibleDays: 30 },
  { key: "1y", label: "1Y", visibleDays: 365 },
];

type SnapshotApiResponse = {
  owner: string;
  snapshots: {
    asOf: string; // ISO date
    totalBalanceUSDC: number;
    breakdown?: {
      savingsFlex?: number | null;
      savingsPlus?: number | null;
      invest?: number | null;
      amplify?: number | null;
    };
  }[];
  count: number;
};

type ChartPoint = {
  date: string; // "YYYY-MM-DD"
  value: number; // display currency
};

const HistoryChart: React.FC = () => {
  const { user } = useUser();
  const { displayCurrency, fxRate } = useBalance(); // fxRate: USD -> displayCurrency

  const [range, setRange] = useState<RangeKey>("1w");
  const [snapshots, setSnapshots] = useState<SnapshotApiResponse["snapshots"]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletAddress = user?.walletAddress;

  // Fetch all snapshots once we have a wallet address
  useEffect(() => {
    if (!walletAddress) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/user/wallet/chart-data?owner=${encodeURIComponent(
          walletAddress
        )}`;
        const res = await fetch(url, { method: "GET", cache: "no-store" });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(
            "[HistoryChart] /api/user/wallet/chart-data failed:",
            res.status,
            res.statusText,
            text
          );
          setError("Failed to load history.");
          return;
        }

        const data = (await res.json()) as SnapshotApiResponse;
        setSnapshots(data.snapshots ?? []);
      } catch (err) {
        console.error("[HistoryChart] error fetching chart data:", err);
        setError("Failed to load history.");
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [walletAddress]);

  // Helper: normalize a Date to a UTC "YYYY-MM-DD" key
  const dayKeyUTC = (d: Date): string => {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Build a map of dayKey -> totalBalanceUSDC from snapshots (USD/USDC)
  const snapshotsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const snap of snapshots) {
      const d = new Date(snap.asOf);
      const key = dayKeyUTC(d);
      const val =
        typeof snap.totalBalanceUSDC === "number"
          ? snap.totalBalanceUSDC
          : Number(snap.totalBalanceUSDC ?? 0);
      map.set(key, Number.isFinite(val) ? val : 0);
    }
    return map;
  }, [snapshots]);

  const activeConfig = RANGE_OPTIONS.find((r) => r.key === range)!;

  // Build a daily time series for the selected range, converted to display currency.
  const visibleData: ChartPoint[] = useMemo(() => {
    if (!snapshots.length) return [];

    const today = new Date();
    const rate = fxRate && fxRate > 0 ? fxRate : 1;

    // For "1D" we want 2 points: today and yesterday
    const visibleSpan =
      activeConfig.key === "1d" ? 2 : activeConfig.visibleDays;

    // Earliest day in DB
    const allKeys = Array.from(snapshotsByDay.keys()).sort(); // YYYY-MM-DD
    const earliestKey = allKeys[0];

    const points: ChartPoint[] = [];
    let lastKnownValueUsd = 0;

    for (let i = visibleSpan - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = dayKeyUTC(d);

      let valueUsd: number;

      if (snapshotsByDay.has(key)) {
        valueUsd = snapshotsByDay.get(key)!;
        lastKnownValueUsd = valueUsd;
      } else {
        valueUsd = key < earliestKey ? 0 : lastKnownValueUsd;
      }

      // Convert USD/USDC -> display currency
      const valueDisplay = valueUsd * rate;

      // Safety: never allow NaN in chart
      points.push({
        date: key,
        value: Number.isFinite(valueDisplay) ? valueDisplay : 0,
      });
    }

    return points;
  }, [
    snapshots.length,
    snapshotsByDay,
    activeConfig.key,
    activeConfig.visibleDays,
    fxRate,
  ]);

  // Small, compact range selector (reused)
  const RangeSelector = () => (
    <div className="flex gap-1.5">
      {RANGE_OPTIONS.map((opt) => {
        const isActive = opt.key === range;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => setRange(opt.key)}
            className={`rounded-full px-2.5 py-0.5 text-[9px] font-medium transition
              ${
                isActive
                  ? "bg-primary text-black shadow-[0_0_10px_rgba(190,242,100,0.6)]"
                  : "bg-zinc-900 text-zinc-400"
              }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <div className="w-full rounded-2xl bg-black/25 px-3 py-3 text-[10px] text-zinc-500">
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full rounded-2xl bg-black/25 px-3 py-3 text-[10px] text-red-400">
        {error || "Something went wrong."}
      </div>
    );
  }

  if (!snapshots.length) {
    return (
      <div className="w-full rounded-2xl bg-black/25 px-3 py-3">
        <div className="mb-2 flex justify-end">
          <RangeSelector />
        </div>
        <p className="text-[10px] text-zinc-500">No history yet.</p>
      </div>
    );
  }

  // ✅ Tooltip shows ACTUAL value, plus change vs previous point (no “negative balance” confusion)
  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { value?: number; payload?: { date?: string; value?: number } }[];
  }) => {
    if (!active || !payload?.length) return null;

    const v = Number(payload[0]?.value ?? 0);
    const date = String(payload[0]?.payload?.date ?? "");

    const idx = visibleData.findIndex((p) => p.date === date);
    const prev = idx > 0 ? visibleData[idx - 1].value : v;
    const diff = v - prev;

    const sign = diff >= 0 ? "+" : "-";
    const absDiff = Math.abs(diff);

    return (
      <div className="rounded-xl bg-white px-3 py-2 shadow-md shadow-[rgba(190,242,100,0.6)]">
        <div className="text-xs font-semibold text-zinc-900">
          {Number.isFinite(v) ? v.toFixed(2) : "0.00"} {displayCurrency}
        </div>
        <div className="text-[10px] font-semibold text-primary">
          {sign}
          {Number.isFinite(absDiff) ? absDiff.toFixed(2) : "0.00"}{" "}
          {displayCurrency}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      <div className="w-full pt-2 pb-3">
        <div className="mb-1 flex justify-start">
          <RangeSelector />
        </div>

        <div className="h-28 w-full overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={visibleData}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <XAxis dataKey="date" hide />
              <YAxis dataKey="value" hide domain={["auto", "auto"]} />

              <Tooltip
                cursor={{
                  stroke: "rgba(255,255,255,0.35)",
                  strokeDasharray: "3 3",
                }}
                content={<CustomTooltip />}
              />

              <defs>
                <linearGradient
                  id="historyGradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    style={{
                      stopColor: "var(--primary)",
                      stopOpacity: 0.35,
                    }}
                  />
                  <stop
                    offset="90%"
                    style={{
                      stopColor: "var(--primary)",
                      stopOpacity: 0,
                    }}
                  />
                </linearGradient>
              </defs>

              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#historyGradient)"
                dot={false}
                activeDot={{
                  r: 5,
                  stroke: "var(--primary)",
                  strokeWidth: 2,
                  fill: "#000000",
                }}
                isAnimationActive
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default HistoryChart;
