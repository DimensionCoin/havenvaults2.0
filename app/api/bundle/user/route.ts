// app/api/bundle/user/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import Bundle from "@/models/Bundle";
import { getServerUser } from "@/lib/getServerUser";

export const dynamic = "force-dynamic";

/**
 * GET /api/bundle/user
 * Fetch the logged-in user's bundles (both public and private)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connect();

    const bundles = await Bundle.find({
      userId: user._id,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    // Convert Decimal128 to string for JSON serialization
    const serialized = bundles.map((b) => ({
      ...b,
      _id: b._id.toString(),
      userId: b.userId.toString(),
      totalVolume: b.totalVolume?.toString() ?? "0",
    }));

    return NextResponse.json({ bundles: serialized });
  } catch (error) {
    console.error("[GET /api/bundle/user] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bundles" },
      { status: 500 },
    );
  }
}
