"use client";

import React, { useEffect, useMemo, useState, useId } from "react";
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

const RANGE_OPTIONS: { key: RangeKey; label: string; visibleDays: number }[] = [
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
  const gradientId = useId();

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
          setError("Failed to load history.");
          return;
        }

        const data = (await res.json()) as SnapshotApiResponse;
        setSnapshots(data.snapshots ?? []);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
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
              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors border",
              isActive
                ? "bg-primary text-primary-foreground border-primary/30 shadow-fintech-sm"
                : "bg-secondary text-muted-foreground border-border hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

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

    return (
      <div className="rounded-2xl border border-border bg-popover/95 px-3 py-2 shadow-fintech-md backdrop-blur-sm">
        <div className="text-sm font-semibold text-foreground">
          {formatMoney(v, displayCurrency)}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {formatDateLabel(dateKey)}
        </div>
        <div
          className={[
            "mt-1 text-[11px] font-semibold",
            diff >= 0 ? "text-primary" : "text-destructive",
          ].join(" ")}
        >
          {diff >= 0 ? "+" : "-"}
          {formatMoney(Math.abs(diff), displayCurrency)}
        </div>
      </div>
    );
  };

  // States (token-based)
  if (loading) {
    return (
      <div className="w-full rounded-2xl border border-border bg-secondary px-3 py-3 text-[11px] text-muted-foreground">
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full rounded-2xl border border-border bg-secondary px-3 py-3 text-[11px] text-destructive">
        {error}
      </div>
    );
  }

  if (!snapshots.length) {
    return (
      <div className="w-full">
        <div className="mb-2 flex items-center justify-between">
          <div className="haven-kicker">History</div>
          <RangeSelector />
        </div>
        <div className="rounded-2xl border border-border bg-secondary px-3 py-3 text-[11px] text-muted-foreground">
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
        <div className="haven-kicker">History</div>
        <RangeSelector />
      </div>

      {/* Chart frame (matches Haven theme) */}
      <div className="haven-chart h-[124px] w-full overflow-hidden sm:h-[176px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={visibleData}
            margin={{ top: 6, right: 10, bottom: 0, left: 0 }}
          >
            <XAxis dataKey="date" hide />
            <YAxis dataKey="value" hide domain={["auto", "auto"]} />

            <Tooltip
              cursor={{
                stroke: "var(--border)",
                strokeDasharray: "3 3",
              }}
              content={<CustomTooltip />}
            />

            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.22}
                />
                <stop
                  offset="85%"
                  stopColor="var(--chart-1)"
                  stopOpacity={0.0}
                />
              </linearGradient>
            </defs>

            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-1)"
              strokeWidth={2.2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                stroke: "var(--chart-1)",
                strokeWidth: 2,
                fill: "var(--card)",
              }}
              isAnimationActive
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Low: {formatMoney(low, displayCurrency)}</span>
        <span>High: {formatMoney(high, displayCurrency)}</span>
      </div>
    </div>
  );
};

export default HistoryChart;
