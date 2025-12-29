// app/api/user/balance/snapshot/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User, { IBalanceSnapshot } from "@/models/User";
import mongoose from "mongoose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    const owner = body?.owner as string | undefined;
    const totalUsd = body?.totalUsd as number | undefined;

    if (!owner) {
      return NextResponse.json(
        { error: "Missing owner (walletAddress)" },
        { status: 400 }
      );
    }

    if (
      typeof totalUsd !== "number" ||
      !Number.isFinite(totalUsd) ||
      totalUsd < 0
    ) {
      return NextResponse.json({ error: "Invalid totalUsd" }, { status: 400 });
    }

    await connect();

    const userDoc = await User.findOne({ walletAddress: owner });
    if (!userDoc) {
      console.warn(
        "[/api/user/balance/snapshot] no user found for walletAddress",
        owner
      );
      return NextResponse.json({ ok: true, skipped: "user_not_found" });
    }

    const now = new Date();

    // daily window in UTC
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    // ---- compute breakdown from savingsAccounts ----
    let flexDeposited = 0;
    let plusDeposited = 0;

    for (const acc of userDoc.savingsAccounts || []) {
      const deposited = Number(acc.totalDeposited ?? 0);
      if (!Number.isFinite(deposited) || deposited <= 0) continue;

      if (acc.type === "flex") flexDeposited += deposited;
      if (acc.type === "plus") plusDeposited += deposited;
    }

    const breakdown: IBalanceSnapshot["breakdown"] = {};
    if (flexDeposited > 0) {
      breakdown.savingsFlex = mongoose.Types.Decimal128.fromString(
        flexDeposited.toString()
      );
    }
    if (plusDeposited > 0) {
      breakdown.savingsPlus = mongoose.Types.Decimal128.fromString(
        plusDeposited.toString()
      );
    }

    const totalBalanceUSDC = mongoose.Types.Decimal128.fromString(
      totalUsd.toString()
    );

    const snapshots: IBalanceSnapshot[] = userDoc.balanceSnapshots || [];

    // find today's snapshot (UTC)
    const idx = snapshots.findIndex((snap: IBalanceSnapshot) => {
      const t = snap.asOf;
      return t >= startOfDay && t < endOfDay;
    });

    if (idx >= 0) {
      // there is already a snapshot for today
      const existing = snapshots[idx];

      const existingTotal = existing.totalBalanceUSDC
        ? Number(existing.totalBalanceUSDC)
        : 0;

      // 🔹 If the existing snapshot is >= new total, SKIP (don't overwrite)
      if (Number.isFinite(existingTotal) && existingTotal >= totalUsd) {
        console.log(
          "[/api/user/balance/snapshot] skip update – existing total is higher or equal",
          {
            existingTotal,
            incomingTotal: totalUsd,
          }
        );
        return NextResponse.json({
          ok: true,
          skipped: "not_higher_than_existing",
        });
      }

      // 🔹 New total is higher → overwrite today's snapshot
      existing.asOf = now;
      existing.totalBalanceUSDC = totalBalanceUSDC;
      existing.breakdown =
        Object.keys(breakdown).length > 0 ? breakdown : undefined;
    } else {
      // 🔹 No snapshot yet today → create new one
      snapshots.push({
        asOf: now,
        totalBalanceUSDC,
        breakdown: Object.keys(breakdown).length > 0 ? breakdown : undefined,
      });
    }

    userDoc.balanceSnapshots = snapshots;
    userDoc.lastBalanceSyncAt = now;
    await userDoc.save();

    console.log(
      "[/api/user/balance/snapshot] snapshot upserted for user",
      userDoc._id,
      "totalUsd:",
      totalUsd
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/user/balance/snapshot] error:", err);
    return NextResponse.json(
      { error: "Failed to write balance snapshot" },
      { status: 500 }
    );
  }
}
