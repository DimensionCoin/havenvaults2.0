// app/api/bundle/public/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import Bundle from "@/models/Bundle";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * GET /api/bundle/public
 * Fetch all public bundles from all users
 * Optional query params:
 *   - sort: "popular" | "newest" (default: "newest")
 *   - limit: number (default: 50, max: 100)
 *   - skip: number (default: 0)
 */
export async function GET(req: NextRequest) {
  try {
    await connect();

    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") || "newest";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const skip = parseInt(searchParams.get("skip") || "0");

    const sortOptions: Record<string, 1 | -1> =
      sort === "popular"
        ? { totalPurchases: -1, createdAt: -1 }
        : { createdAt: -1 };

    const bundles = await Bundle.find({
      visibility: "public",
      isActive: true,
    })
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get unique user IDs to fetch creator info
    const userIds = [...new Set(bundles.map((b) => b.userId.toString()))];

    const users = await User.find(
      { _id: { $in: userIds } },
      { _id: 1, firstName: 1, lastName: 1, profileImageUrl: 1 },
    ).lean();

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    // Serialize and add creator info
    const serialized = bundles.map((b) => {
      const creator = userMap.get(b.userId.toString());
      return {
        ...b,
        _id: b._id.toString(),
        userId: b.userId.toString(),
        totalVolume: b.totalVolume?.toString() ?? "0",
        creator: creator
          ? {
              firstName: creator.firstName,
              lastName: creator.lastName,
              profileImageUrl: creator.profileImageUrl,
            }
          : null,
      };
    });

    // Get total count for pagination
    const total = await Bundle.countDocuments({
      visibility: "public",
      isActive: true,
    });

    return NextResponse.json({
      bundles: serialized,
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + bundles.length < total,
      },
    });
  } catch (error) {
    console.error("[GET /api/bundle/public] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bundles" },
      { status: 500 },
    );
  }
}
