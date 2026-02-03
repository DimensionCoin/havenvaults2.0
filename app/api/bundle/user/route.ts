// app/api/bundle/user/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import Bundle from "@/models/Bundle";
import { getServerUser } from "@/lib/getServerUser";
import { rateLimitServer } from "@/lib/rateLimitServer";
import { withApiLogging } from "@/lib/withApiLogging";

export const dynamic = "force-dynamic";

/**
 * GET /api/bundle/user
 * Fetch the logged-in user's bundles (both public and private)
 */
async function GETHandler(req: NextRequest) {
  try {
    // Rate limit
    const blocked = await rateLimitServer(req, {
      api: "bundle:user",
      requireAuth: true,
      allowIpFallback: false,
      failMode: "open",
      tiers: [
        { limit: 5, windowMs: 10_000, suffix: "burst" },
        { limit: 30, windowMs: 60_000, suffix: "minute" },
      ],
    });
    if (blocked) return blocked;

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

export const GET = withApiLogging("/api/bundle/user", GETHandler);