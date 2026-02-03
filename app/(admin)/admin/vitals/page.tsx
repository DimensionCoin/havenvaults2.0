// app/(admin)/admin/vitals/page.tsx
import "server-only";

import { notFound } from "next/navigation";
import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User from "@/models/User";
import { ErrorEvent } from "@/models/ErrorEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Admin • Vitals",
  robots: { index: false, follow: false },
};

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

function shortText(value?: string, max = 120): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function requireAdminOr404() {
  const session = await getSessionFromCookies();
  if (!session?.sub) notFound();

  await connect();
  const user = session.userId
    ? await User.findById(session.userId).select({ email: 1 }).lean()
    : await User.findOne({ privyId: session.sub }).select({ email: 1 }).lean();

  const email = (user?.email || "").trim().toLowerCase();
  if (!email || !ADMIN_EMAIL || email !== ADMIN_EMAIL) notFound();
}

export default async function AdminVitalsPage() {
  await requireAdminOr404();
  await connect();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    totalAll,
    total24h,
    uniqueErrors24h,
    uniqueUsers24h,
    topErrors,
    topRoutes,
    recentErrors,
  ] = await Promise.all([
    ErrorEvent.countDocuments(),
    ErrorEvent.countDocuments({ createdAt: { $gte: since } }),
    ErrorEvent.distinct("fingerprint", { createdAt: { $gte: since } }),
    ErrorEvent.distinct("email", {
      createdAt: { $gte: since },
      email: { $exists: true, $ne: "" },
    }),
    ErrorEvent.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            fingerprint: "$fingerprint",
            message: "$message",
            route: "$route",
            source: "$source",
          },
          count: { $sum: 1 },
          lastSeen: { $max: "$createdAt" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    ErrorEvent.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { route: "$route", source: "$source" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    ErrorEvent.find({})
      .select("createdAt message route source email userId")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec(),
  ]);

  const nowLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-foreground sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-col gap-2">
        <p className="haven-kicker">Admin • Vitals</p>
        <h1 className="haven-title">Error Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Access restricted to {ADMIN_EMAIL}. Last refreshed {nowLabel}.
        </p>
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="haven-card p-5 text-foreground">
          <p className="haven-kicker">Errors (24h)</p>
          <p className="mt-2 text-2xl font-semibold">{total24h}</p>
        </div>
        <div className="haven-card p-5 text-foreground">
          <p className="haven-kicker">Total Errors</p>
          <p className="mt-2 text-2xl font-semibold">{totalAll}</p>
        </div>
        <div className="haven-card p-5 text-foreground">
          <p className="haven-kicker">Unique Errors (24h)</p>
          <p className="mt-2 text-2xl font-semibold">
            {uniqueErrors24h.length}
          </p>
        </div>
        <div className="haven-card p-5 text-foreground">
          <p className="haven-kicker">Users Affected (24h)</p>
          <p className="mt-2 text-2xl font-semibold">
            {uniqueUsers24h.length}
          </p>
        </div>
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="haven-card p-6 text-foreground">
          <h2 className="text-lg font-semibold">Top Errors (24h)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Most frequent error messages in the last 24 hours.
          </p>
          <div className="mt-4 space-y-3">
            {topErrors.length === 0 && (
              <p className="text-sm text-muted-foreground">No errors yet.</p>
            )}
            {topErrors.map((row, i) => (
              <div key={`${row._id.fingerprint}:${row._id.route}:${row._id.source}:${i}`} className="haven-row">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {shortText(row._id.message, 100)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row._id.route || "unknown route"} • {row._id.source}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p className="text-sm font-semibold">{row.count}</p>
                  <p>
                    {new Date(row.lastSeen).toLocaleString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="haven-card p-6 text-foreground">
          <h2 className="text-lg font-semibold">Top Error Routes (24h)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Routes where errors occur the most.
          </p>
          <div className="mt-4 space-y-3">
            {topRoutes.length === 0 && (
              <p className="text-sm text-muted-foreground">No errors yet.</p>
            )}
            {topRoutes.map((row) => (
              <div key={`${row._id.route}-${row._id.source}`} className="haven-row">
                <div>
                  <p className="text-sm font-medium">
                    {row._id.route || "unknown route"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row._id.source}
                  </p>
                </div>
                <p className="text-sm font-semibold">{row.count}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-10 haven-card p-6 text-foreground">
        <h2 className="text-lg font-semibold">Recent Errors</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Latest 50 errors across the app.
        </p>
        <div className="mt-4 space-y-3">
          {recentErrors.length === 0 && (
            <p className="text-sm text-muted-foreground">No errors yet.</p>
          )}
          {recentErrors.map((row) => (
            <div key={String(row._id)} className="haven-row">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {shortText(row.message, 120)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.route || "unknown route"} • {row.source} •{" "}
                  {row.email || "unknown user"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString("en-US", {
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
