// app/api/savings/flex/principal/route.ts
import "server-only";
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connect as connectMongo } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User from "@/models/User";
import { SavingsLedger } from "@/models/SavingsLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SavingsAccount = {
  type?: "flex" | "plus" | string;
  marginfiAccountPk?: string | null;
};

type UserDoc = {
  _id?: unknown;
  savingsAccounts?: SavingsAccount[];
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const toNum = (v: unknown) => {
  // supports: number, string, Decimal128
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof v === "object") {
    // mongoose Decimal128 has toString()
    const obj = v as { toString?: () => string };
    if (typeof obj.toString === "function") {
      const n = Number(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
};

const clamp0 = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session?.sub) return json(401, { ok: false, error: "Unauthorized" });

    await connectMongo();

    // Resolve userId (prefer session.userId if you store it)
    const userDoc = (session.userId
      ? await User.findById(session.userId, {
          _id: 1,
          savingsAccounts: 1,
        }).lean()
      : await User.findOne(
          { privyId: session.sub },
          { _id: 1, savingsAccounts: 1 }
        ).lean()) as UserDoc | null;

    if (!userDoc?._id) return json(401, { ok: false, error: "Unauthorized" });

    const savingsAccounts = Array.isArray(userDoc.savingsAccounts)
      ? userDoc.savingsAccounts
      : [];
    const flexAcc =
      savingsAccounts.find((account) => account?.type === "flex") ?? null;

    const hasAccount = !!flexAcc?.marginfiAccountPk;

    // Aggregate principalPart from SavingsLedger (source of truth)
    const userId = new mongoose.Types.ObjectId(String(userDoc._id));

    const rows = await SavingsLedger.aggregate([
      {
        $match: {
          userId,
          accountType: "flex",
          // direction: deposit/withdraw only (schema enforces)
        },
      },
      {
        $group: {
          _id: null,
          principalDeposited: {
            $sum: {
              $cond: [{ $eq: ["$direction", "deposit"] }, "$principalPart", 0],
            },
          },
          principalWithdrawn: {
            $sum: {
              $cond: [{ $eq: ["$direction", "withdraw"] }, "$principalPart", 0],
            },
          },
          // optional: also track interestWithdrawn if you write those rows correctly
          interestWithdrawn: {
            $sum: {
              $cond: [{ $eq: ["$direction", "withdraw"] }, "$interestPart", 0],
            },
          },
          feesPaidUsdc: { $sum: "$feeUsdc" },
          count: { $sum: 1 },
        },
      },
    ]);

    const agg = rows?.[0] ?? null;

    const principalDeposited = toNum(agg?.principalDeposited);
    const principalWithdrawn = toNum(agg?.principalWithdrawn);
    const interestWithdrawn = toNum(agg?.interestWithdrawn);
    const feesPaidUsdc = toNum(agg?.feesPaidUsdc);

    const principalNet = clamp0(principalDeposited - principalWithdrawn);

    // ✅ Return a single number (+ small optional metadata)
    return json(200, {
      ok: true,
      hasAccount,
      principalNet, // <-- THIS is the “DB total” you want
      // optional debug fields (keep for now, can remove later)
      principalDeposited,
      principalWithdrawn,
      interestWithdrawn,
      feesPaidUsdc,
      ledgerCount: Number(agg?.count ?? 0) || 0,
      marginfiAccountPk: flexAcc?.marginfiAccountPk ?? null,
    });
  } catch (e: unknown) {
    console.error("[flex/principal] error:", e);
    return json(500, {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    });
  }
}
