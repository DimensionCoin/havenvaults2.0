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
    totalBalanceUSDC: number; // USD/USDC
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
  t: number; // timestamp (ms)
  value: number; // display currency
};

function formatMoney(value: number, currency: string) {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: n < 1 ? 4 : 2,
  });
}

const HistoryChart: React.FC = () => {
  const { user } = useUser();
  const { displayCurrency, fxRate } = useBalance();

  const [range, setRange] = useState<RangeKey>("1w");
  const [snapshots, setSnapshots] = useState<SnapshotApiResponse["snapshots"]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletAddress = user?.walletAddress;

  useEffect(() => {
    if (!walletAddress) return;

    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/user/wallet/chart-data?owner=${encodeURIComponent(
          walletAddress
        )}`;
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(
            "[HistoryChart] chart-data failed:",
            res.status,
            res.statusText,
            text
          );
          setError("Failed to load history.");
          return;
        }

        const data = (await res.json()) as SnapshotApiResponse;
        setSnapshots(data.snapshots ?? []);
      } catch (err: unknown) {
        // ✅ no `any` — safe narrowing
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[HistoryChart] error fetching chart data:", err);
        setError("Failed to load history.");
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
    return () => controller.abort();
  }, [walletAddress]);

  const dayKeyUTC = (d: Date): string => {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

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

  const visibleData: ChartPoint[] = useMemo(() => {
    if (!snapshots.length) return [];

    const today = new Date();
    const rate = fxRate && fxRate > 0 ? fxRate : 1;

    const visibleSpan =
      activeConfig.key === "1d" ? 2 : activeConfig.visibleDays;

    const allKeys = Array.from(snapshotsByDay.keys()).sort();
    const earliestKey = allKeys[0];

    const points: ChartPoint[] = [];
    let lastKnownUsd = 0;

    for (let i = visibleSpan - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = dayKeyUTC(d);

      let valueUsd: number;
      if (snapshotsByDay.has(key)) {
        valueUsd = snapshotsByDay.get(key)!;
        lastKnownUsd = valueUsd;
      } else {
        valueUsd = key < earliestKey ? 0 : lastKnownUsd;
      }

      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const valueDisplay = valueUsd * rate;

      points.push({
        date: key,
        t,
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

  const RangeSelector = () => (
    <div className="flex gap-1.5">
      {RANGE_OPTIONS.map((opt) => {
        const isActive = opt.key === range;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => setRange(opt.key)}
            className={[
              "rounded-full px-2.5 py-1 text-[10px] font-semibold transition border",
              isActive
                ? "bg-emerald-500/20 text-emerald-100 border-emerald-300/25 shadow-[0_0_0_1px_rgba(63,243,135,0.55)]"
                : "bg-black/35 text-white/55 border-white/10 hover:text-white/80 hover:border-white/15",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  const formatDateLabel = (key: string) => {
    const [y, m, d] = key.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    if (range === "1y") {
      return dt.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
      });
    }
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: {
      value?: number;
      payload?: { date?: string; value?: number };
    }[];
  }) => {
    if (!active || !payload?.length) return null;

    const v = Number(payload[0]?.value ?? 0);
    const dateKey = String(payload[0]?.payload?.date ?? "");

    const idx = visibleData.findIndex((p) => p.date === dateKey);
    const prev = idx > 0 ? visibleData[idx - 1].value : v;
    const diff = v - prev;

    const sign = diff >= 0 ? "+" : "-";

    return (
      <div className="rounded-2xl border border-white/10 bg-black/85 px-3 py-2 shadow-xl backdrop-blur-sm">
        <div className="text-sm font-semibold text-white/90">
          {formatMoney(v, displayCurrency)}
        </div>
        <div className="mt-0.5 text-[11px] text-white/45">
          {formatDateLabel(dateKey)}
        </div>
        <div
          className={[
            "mt-1 text-[11px] font-semibold",
            diff >= 0 ? "text-emerald-300" : "text-rose-300",
          ].join(" ")}
        >
          {sign}
          {formatMoney(Math.abs(diff), displayCurrency)}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="w-full rounded-2xl bg-black/25 px-3 py-3 text-[11px] text-white/45">
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full rounded-2xl bg-black/25 px-3 py-3 text-[11px] text-rose-300">
        {error || "Something went wrong."}
      </div>
    );
  }

  if (!snapshots.length) {
    return (
      <div className="w-full">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
            History
          </div>
          <RangeSelector />
        </div>
        <div className="rounded-2xl bg-black/25 px-3 py-3 text-[11px] text-white/45">
          No history yet.
        </div>
      </div>
    );
  }

  const values = visibleData.map((p) => p.value);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 0;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
          History
        </div>
        <RangeSelector />
      </div>

      <div className="h-[124px] w-full overflow-hidden sm:h-[176px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={visibleData}
            margin={{ top: 6, right: 10, bottom: 0, left: 0 }}
          >
            <XAxis dataKey="date" hide />
            <YAxis dataKey="value" hide domain={["auto", "auto"]} />

            <Tooltip
              cursor={{
                stroke: "rgba(255,255,255,0.16)",
                strokeDasharray: "3 3",
              }}
              content={<CustomTooltip />}
            />

            <defs>
              <linearGradient
                id="portfolioGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="var(--chart-1, rgb(16 185 129))"
                  stopOpacity="0.28"
                />
                <stop
                  offset="90%"
                  stopColor="var(--chart-1, rgb(16 185 129))"
                  stopOpacity="0.0"
                />
              </linearGradient>
            </defs>

            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-1, rgb(16 185 129))"
              strokeWidth={2.2}
              fill="url(#portfolioGradient)"
              dot={false}
              activeDot={{
                r: 4,
                stroke: "var(--chart-1, rgb(16 185 129))",
                strokeWidth: 2,
                fill: "#000000",
              }}
              isAnimationActive
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-white/35">
        <span>Low: {formatMoney(low, displayCurrency)}</span>
        <span>High: {formatMoney(high, displayCurrency)}</span>
      </div>
    </div>
  );
};

export default HistoryChart;
