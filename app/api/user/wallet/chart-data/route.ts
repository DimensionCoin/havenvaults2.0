// app/api/user/wallet/chart-data/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User, { IBalanceSnapshot } from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// helper to safely convert Decimal128 → number | undefined
function decimalToNumber(v: unknown): number | undefined {
  if (!v) return undefined;
  try {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");

  if (!owner) {
    return NextResponse.json(
      { error: "Missing owner (walletAddress) query parameter" },
      { status: 400 }
    );
  }

  try {
    await connect();

    const userDoc = await User.findOne({ walletAddress: owner })
      .select("balanceSnapshots walletAddress")
      .lean();

    if (!userDoc) {
      // Not fatal for charts – just return empty series
      return NextResponse.json({
        owner,
        snapshots: [],
        count: 0,
      });
    }

    const snapshots = (userDoc.balanceSnapshots || []) as IBalanceSnapshot[];

    // Sort ascending by asOf (oldest → newest)
    snapshots.sort((a, b) => {
      const ta = new Date(a.asOf).getTime();
      const tb = new Date(b.asOf).getTime();
      return ta - tb;
    });

    const chartData = snapshots.map((snap) => {
      const total = decimalToNumber(snap.totalBalanceUSDC) ?? 0;

      const breakdown = snap.breakdown
        ? {
            savingsFlex: decimalToNumber(snap.breakdown.savingsFlex),
            savingsPlus: decimalToNumber(snap.breakdown.savingsPlus),
            invest: decimalToNumber(snap.breakdown.invest),
            amplify: decimalToNumber(snap.breakdown.amplify),
          }
        : undefined;

      return {
        asOf: snap.asOf, // will serialize as ISO string
        totalBalanceUSDC: total,
        breakdown,
      };
    });

    return NextResponse.json({
      owner,
      snapshots: chartData,
      count: chartData.length,
    });
  } catch (err) {
    console.error("[/api/user/wallet/chart-data] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch chart data" },
      { status: 500 }
    );
  }
}
