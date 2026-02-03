// app/(admin)/admin/fees/page.tsx
import "server-only";

import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User from "@/models/User";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Admin • Fee Tracking",
  robots: { index: false, follow: false },
};

// ADMIN_EMAIL must be set in the environment; empty value is fail-closed (no admin access).
function getAdminEmail(): string {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) {
    console.error("ADMIN_EMAIL env var is not set — admin access is denied");
  }
  return email;
}

const USDC_MINT =
  (process.env.NEXT_PUBLIC_USDC_SWAP_MINT ||
    process.env.NEXT_PUBLIC_USDC_MINT ||
    "").trim() || "";

type FeePaidTotal = {
  amountBase?: string;
  decimals?: number;
  symbol?: string;
};

type FeesPaidTotalsMap = Record<string, FeePaidTotal> | Map<string, FeePaidTotal>;

type UserRow = {
  id: string;
  email: string;
  name: string;
  walletAddress?: string;
  referredById?: string | null;
  feesByMint: Array<{
    mint: string;
    amountBase: bigint;
    decimals: number;
    symbol?: string;
  }>;
  usdcBase: bigint;
};

type ReferrerRow = {
  id: string;
  email: string;
  name: string;
  walletAddress?: string;
  referredCount: number;
  feesByMint: Array<{
    mint: string;
    amountBase: bigint;
    decimals: number;
    symbol?: string;
  }>;
  usdcBase: bigint;
};

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) {
      return BigInt(Math.max(0, Math.floor(v)));
    }
    if (typeof v === "string" && v.trim()) return BigInt(v.trim());
  } catch {}
  return BigInt(0);
}

function clampDecimals(decimals: number) {
  const d = Number.isFinite(decimals) ? Math.floor(decimals) : 0;
  return Math.max(0, Math.min(18, d));
}

function pow10BigInt(decimals: number): bigint {
  const d = clampDecimals(decimals);
  let out = BigInt(1);
  const ten = BigInt(10);
  for (let i = 0; i < d; i++) out = out * ten;
  return out;
}

function baseToUiString(base: bigint, decimals: number): string {
  const d = clampDecimals(decimals);
  if (base <= BigInt(0)) return "0";
  if (d === 0) return base.toString();
  const denom = pow10BigInt(d);
  const whole = base / denom;
  const frac = base % denom;
  const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function toNumberSafe(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function shortAddress(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function toEntries(mapLike: FeesPaidTotalsMap | undefined | null) {
  if (!mapLike) return [] as Array<[string, FeePaidTotal]>;
  if (mapLike instanceof Map) return Array.from(mapLike.entries());
  if (typeof mapLike === "object") {
    return Object.entries(mapLike as Record<string, FeePaidTotal>);
  }
  return [];
}

async function requireAdminOr404() {
  const session = await getSessionFromCookies();
  if (!session?.sub) notFound();

  await connect();
  const user = session.userId
    ? await User.findById(session.userId).select({ email: 1 }).lean()
    : await User.findOne({ privyId: session.sub }).select({ email: 1 }).lean();

  const adminEmail = getAdminEmail();
  const email = (user?.email || "").trim().toLowerCase();
  if (!email || !adminEmail || email !== adminEmail) notFound();
}

async function fetchJupUsdPrices(
  mints: string[],
): Promise<Record<string, number>> {
  if (!mints.length) return {};

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (host ? `${proto}://${host}` : "");

  if (!base) return {};

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/api/prices/jup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(host ? { origin: `${proto}://${host}` } : {}),
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({ mints }),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return {};
    const data = (await res.json()) as {
      prices?: Record<string, { price?: number }>;
    };
    const out: Record<string, number> = {};
    for (const [mint, entry] of Object.entries(data?.prices || {})) {
      const price =
        entry && typeof entry.price === "number" && entry.price > 0
          ? entry.price
          : 0;
      out[mint] = price;
    }
    return out;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[fetchJupUsdPrices] Request timed out");
    }
    return {};
  }
}

export default async function AdminFeesPage() {
  await requireAdminOr404();
  await connect();

  const [users] = await Promise.all([
    User.find(
      {},
      {
        email: 1,
        firstName: 1,
        lastName: 1,
        walletAddress: 1,
        feesPaidTotals: 1,
        referredBy: 1,
      },
    )
      .lean()
      .exec(),
  ]);

  const rows: UserRow[] = users.map((u) => {
    const feesPaidTotals = toEntries(
      (u as { feesPaidTotals?: FeesPaidTotalsMap }).feesPaidTotals,
    );

    const feesByMint = feesPaidTotals
      .map(([mint, val]) => {
        const amountBase = toBigIntSafe(val?.amountBase);
        const decimals = clampDecimals(Number(val?.decimals ?? 0));
        const symbol =
          typeof val?.symbol === "string" && val.symbol.trim()
            ? val.symbol.trim()
            : undefined;
        return { mint, amountBase, decimals, symbol };
      })
      .filter((x) => x.amountBase > BigInt(0));

    const usdcBase = feesByMint
      .filter((f) => USDC_MINT && f.mint === USDC_MINT)
      .reduce((acc, f) => acc + f.amountBase, BigInt(0));

    const first = (u as { firstName?: string }).firstName || "";
    const last = (u as { lastName?: string }).lastName || "";
    const name = `${first} ${last}`.trim();
    const referredByRaw = (u as { referredBy?: unknown }).referredBy;
    const referredById = referredByRaw ? String(referredByRaw) : null;

    return {
      id: String(u._id),
      email: (u as { email?: string }).email || "",
      name: name || (u as { email?: string }).email?.split("@")[0] || "User",
      walletAddress: (u as { walletAddress?: string }).walletAddress,
      referredById,
      feesByMint,
      usdcBase,
    };
  });

  const totalsByMint = new Map<
    string,
    { amountBase: bigint; decimals: number; symbol?: string }
  >();

  for (const row of rows) {
    for (const f of row.feesByMint) {
      const prev = totalsByMint.get(f.mint);
      if (!prev) {
        totalsByMint.set(f.mint, {
          amountBase: f.amountBase,
          decimals: f.decimals,
          symbol: f.symbol,
        });
      } else {
        totalsByMint.set(f.mint, {
          amountBase: prev.amountBase + f.amountBase,
          decimals: prev.decimals ?? f.decimals,
          symbol: prev.symbol ?? f.symbol,
        });
      }
    }
  }

  const totalsSorted = Array.from(totalsByMint.entries()).sort((a, b) =>
    b[1].amountBase > a[1].amountBase ? 1 : -1,
  );

  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const referrerStats = new Map<
    string,
    {
      referredCount: number;
      feesByMint: Map<
        string,
        { amountBase: bigint; decimals: number; symbol?: string }
      >;
    }
  >();

  for (const row of rows) {
    if (!row.referredById) continue;
    const refId = row.referredById;
    const existing =
      referrerStats.get(refId) ||
      {
        referredCount: 0,
        feesByMint: new Map<
          string,
          { amountBase: bigint; decimals: number; symbol?: string }
        >(),
      };

    existing.referredCount += 1;
    for (const fee of row.feesByMint) {
      const prev = existing.feesByMint.get(fee.mint);
      if (!prev) {
        existing.feesByMint.set(fee.mint, {
          amountBase: fee.amountBase,
          decimals: fee.decimals,
          symbol: fee.symbol,
        });
      } else {
        existing.feesByMint.set(fee.mint, {
          amountBase: prev.amountBase + fee.amountBase,
          decimals: prev.decimals ?? fee.decimals,
          symbol: prev.symbol ?? fee.symbol,
        });
      }
    }

    referrerStats.set(refId, existing);
  }

  const referrerRows: ReferrerRow[] = Array.from(referrerStats.entries()).map(
    ([refId, stats]) => {
      const refUser = rowsById.get(refId);
      const feesByMint = Array.from(stats.feesByMint.entries()).map(
        ([mint, info]) => ({
          mint,
          amountBase: info.amountBase,
          decimals: info.decimals,
          symbol: info.symbol,
        }),
      );

      const usdcBase = feesByMint
        .filter((f) => USDC_MINT && f.mint === USDC_MINT)
        .reduce((acc, f) => acc + f.amountBase, BigInt(0));

      return {
        id: refId,
        email: refUser?.email || "",
        name: refUser?.name || refUser?.email?.split("@")[0] || "Referrer",
        walletAddress: refUser?.walletAddress,
        referredCount: stats.referredCount,
        feesByMint,
        usdcBase,
      };
    },
  );

  const referrerLeaderboard = [...referrerRows]
    .sort((a, b) => b.referredCount - a.referredCount)
    .slice(0, 10);

  const totalUsdcBase =
    USDC_MINT && totalsByMint.has(USDC_MINT)
      ? totalsByMint.get(USDC_MINT)!.amountBase
      : BigInt(0);

  const otherTokens = totalsSorted.filter(
    ([mint]) => !USDC_MINT || mint !== USDC_MINT,
  );

  const otherMints = otherTokens.map(([mint]) => mint);
  const priceMap = await fetchJupUsdPrices(otherMints);

  const otherTokenRows = otherTokens.map(([mint, info]) => {
    const amountUi = baseToUiString(info.amountBase, info.decimals);
    const amountUiNum = toNumberSafe(amountUi);
    const price = priceMap[mint] || 0;
    const usdValue = amountUiNum * price;
    return {
      mint,
      symbol: info.symbol,
      decimals: info.decimals,
      amountUi,
      price,
      usdValue,
    };
  });

  const totalOtherUsd = otherTokenRows.reduce(
    (acc, row) => acc + row.usdValue,
    0,
  );

  const totalUsdcUi = toNumberSafe(baseToUiString(totalUsdcBase, 6));
  const totalFeesUsd = totalUsdcUi + totalOtherUsd;

  const referredUsers = rows
    .filter((r) => r.referredById)
    .map((r) => {
      const refUser = r.referredById ? rowsById.get(r.referredById) : null;
      const otherUsd = r.feesByMint
        .filter((f) => !USDC_MINT || f.mint !== USDC_MINT)
        .reduce((acc, fee) => {
          const price = priceMap[fee.mint] || 0;
          const amountUi = toNumberSafe(
            baseToUiString(fee.amountBase, fee.decimals),
          );
          return acc + amountUi * price;
        }, 0);

      const usdcUi = toNumberSafe(baseToUiString(r.usdcBase, 6));
      const totalUsd = usdcUi + otherUsd;

      return {
        id: r.id,
        name: r.name,
        email: r.email,
        walletAddress: r.walletAddress,
        referrerName: refUser?.name || "Unknown",
        referrerEmail: refUser?.email || "Unknown",
        usdcUi,
        totalUsd,
      };
    });

  const nowLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-foreground sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-col gap-2">
        <p className="haven-kicker">Admin • Fee Tracking</p>
        <h1 className="haven-title">Fees Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Access restricted to {getAdminEmail() || "admin"}. Last refreshed {nowLabel}.
        </p>
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="haven-card p-5 text-foreground">
          <p className="haven-kicker">USDC Fees Collected</p>
          <p className="mt-2 text-2xl font-semibold">
            {baseToUiString(totalUsdcBase, 6)} USDC
          </p>
        </div>
        <div className="haven-card p-5 text-foreground">
          <p className="haven-kicker">Other Tokens (USD)</p>
          <p className="mt-2 text-2xl font-semibold">
            ${totalOtherUsd.toFixed(2)}
          </p>
        </div>
        <div className="haven-card p-5 text-foreground">
          <p className="haven-kicker">Total Fees (USD)</p>
          <p className="mt-2 text-2xl font-semibold">
            ${totalFeesUsd.toFixed(2)}
          </p>
        </div>
      </section>

      <section className="mt-10 haven-card p-6 text-foreground">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Referral Leaderboard (Most Referrals)
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Top referrers ranked by the number of users they brought in.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {referrerLeaderboard.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No referrals yet.
            </p>
          )}
          {referrerLeaderboard.map((row, idx) => (
            <div key={`ref-${row.id}`} className="haven-row">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  #{idx + 1} {row.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.email} • {shortAddress(row.walletAddress)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-primary">
                  {row.referredCount} referred
                </p>
                <p className="text-xs text-muted-foreground">
                  {baseToUiString(row.usdcBase, 6)} USDC fees
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 haven-card p-6 text-foreground">
        <h2 className="text-lg font-semibold">Referred Users & Fees</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each referred user, their referrer, and fees paid so far.
        </p>
        <div className="mt-6 space-y-4">
          {referredUsers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No referred users yet.
            </p>
          )}
          {referredUsers.map((row) => (
            <div key={`referred-${row.id}`} className="haven-card-soft p-4 text-foreground">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.email} • {shortAddress(row.walletAddress)}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Referred by {row.referrerName} ({row.referrerEmail})
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>USDC fees: {row.usdcUi.toFixed(2)}</span>
                <span>Total fees (USD): ${row.totalUsd.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 haven-card p-6 text-foreground">
        <h2 className="text-lg font-semibold">Other Fee Tokens</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Non‑USDC fees priced via the Jupiter price API.
        </p>
        <div className="mt-4 space-y-3">
          {otherTokenRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No other fee tokens yet.
            </p>
          )}
          {otherTokenRows.map((row) => (
            <div key={`other-${row.mint}`} className="haven-row">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {row.symbol || row.mint.slice(0, 8)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.mint}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p className="text-sm font-semibold text-foreground">
                  {row.amountUi}
                </p>
                <p>${row.usdValue.toFixed(2)} • ${row.price.toFixed(4)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 haven-card p-6 text-foreground">
        <h2 className="text-lg font-semibold">All Users • Fees Paid</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Per‑user fees in USDC and other tokens (no USD conversion).
        </p>
        <div className="mt-6 space-y-4">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No users yet.
            </p>
          )}
          {rows.map((row) => (
            <div key={`all-${row.id}`} className="haven-card-soft p-4 text-foreground">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.email} • {shortAddress(row.walletAddress)}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  USDC fees: {toNumberSafe(baseToUiString(row.usdcBase, 6)).toFixed(2)}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {row.feesByMint.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    No fees recorded yet.
                  </span>
                )}
                {row.feesByMint
                  .filter((fee) => !USDC_MINT || fee.mint !== USDC_MINT)
                  .map((fee) => (
                    <span
                      key={`${row.id}-${fee.mint}-all`}
                      className="haven-pill"
                    >
                      {baseToUiString(fee.amountBase, fee.decimals)}{" "}
                      {fee.symbol || fee.mint.slice(0, 4)}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>

    </main>
  );
}
