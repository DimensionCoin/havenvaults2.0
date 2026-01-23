import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { requireServerUser } from "@/lib/getServerUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SnapshotDoc = {
  asOf: Date;
  totalBalanceUSDC?: unknown; // Decimal128-like or number/string
};

type UserLean = {
  walletAddress: string;
  balanceSnapshots?: SnapshotDoc[];
};

type ApiSnapshot = {
  asOf: string; // ISO
  totalBalanceUSDC: number; // USD/USDC
};

function decimalLikeToNumber(v: unknown): number {
  if (v == null) return 0;

  // Handles Decimal128 (has toString), strings, and numbers.
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  if (typeof v === "object") {
    const maybeToString = (v as { toString?: () => string }).toString;
    if (typeof maybeToString === "function") {
      const n = Number(maybeToString.call(v));
      return Number.isFinite(n) ? n : 0;
    }
  }

  return 0;
}

export async function GET(req: NextRequest) {
  try {
    // ✅ Auth gate + prevent leaking another user's history
    const serverUser = await requireServerUser();

    const { searchParams } = new URL(req.url);
    const owner = (searchParams.get("owner") || "").trim();
    if (!owner) {
      return NextResponse.json({ error: "Missing owner" }, { status: 400 });
    }

    const signedInWallet = (serverUser?.walletAddress || "").trim();
    if (!signedInWallet || signedInWallet !== owner) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connect();

    const userDoc = (await User.findOne(
      { walletAddress: owner },
      { walletAddress: 1, balanceSnapshots: 1 },
    ).lean()) as UserLean | null;

    if (!userDoc) {
      return NextResponse.json({ owner, snapshots: [], count: 0 });
    }

    const raw: SnapshotDoc[] = Array.isArray(userDoc.balanceSnapshots)
      ? userDoc.balanceSnapshots
      : [];

    const snapshots: ApiSnapshot[] = raw
      .map((s) => ({
        asOf: new Date(s.asOf).toISOString(),
        totalBalanceUSDC: decimalLikeToNumber(s.totalBalanceUSDC),
      }))
      .filter((s) => Number.isFinite(s.totalBalanceUSDC))
      .sort((a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime());

    return NextResponse.json({
      owner,
      snapshots,
      count: snapshots.length,
    });
  } catch (err) {
    console.error("[/api/user/wallet/chart-data] error:", err);
    return NextResponse.json(
      { error: "Failed to load history" },
      { status: 500 },
    );
  }
}
