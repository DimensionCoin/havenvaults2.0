import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import { SavingsLedger } from "@/models/SavingsLedger";
import { getServerUser } from "@/lib/getServerUser";

type LedgerRow = {
  _id: { toString(): string } | string;
  signature?: string;
  direction?: string;
  amount?: unknown;
  principalPart?: unknown;
  interestPart?: unknown;
  feeUsdc?: unknown;
  createdAt: Date | string;
};

function decToNumber(v: unknown): number {
  // Handles mongoose Decimal128 or string/number safely
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user?._id) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    await connect();

    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get("limit") ?? "30");
    const limit = Math.max(1, Math.min(limitRaw, 100));
    const cursor = searchParams.get("cursor"); // ISO string (createdAt)

    const query: Record<string, unknown> = {
      userId: user._id,
      accountType: "flex",
    };

    if (cursor) {
      const d = new Date(cursor);
      if (!Number.isNaN(d.getTime())) {
        query.createdAt = { $lt: d };
      }
    }

    const rows = await SavingsLedger.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .select({
        signature: 1,
        direction: 1,
        amount: 1,
        principalPart: 1,
        interestPart: 1,
        feeUsdc: 1,
        createdAt: 1,
      })
      .lean();

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const txs = items.map((row: LedgerRow) => ({
      id: row._id.toString(),
      signature: row.signature,
      direction: row.direction, // "deposit" | "withdraw"
      amountUsdc: decToNumber(row.amount),
      principalPart: decToNumber(row.principalPart),
      interestPart: decToNumber(row.interestPart),
      feeUsdc: decToNumber(row.feeUsdc),
      createdAt: new Date(row.createdAt).toISOString(),
      blockTime: Math.floor(new Date(row.createdAt).getTime() / 1000),
    }));

    const nextCursor = hasMore
      ? new Date(items[items.length - 1].createdAt).toISOString()
      : null;

    return NextResponse.json({
      ok: true,
      txs,
      nextCursor,
      exhausted: !hasMore,
    });
  } catch (err) {
    console.error("Flex activity error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load activity" },
      { status: 500 }
    );
  }
}
