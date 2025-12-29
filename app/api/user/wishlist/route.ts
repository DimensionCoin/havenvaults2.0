// app/api/user/wishlist/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session || !session.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privyId = session.sub;
    await connect();

    const user = await User.findOne({ privyId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!Array.isArray(user.wishlistTokenMints)) {
      user.wishlistTokenMints = [];
      await user.save();
    }

    return NextResponse.json({
      wishlist: user.wishlistTokenMints,
    });
  } catch (error) {
    console.error("[GET /api/user/wishlist] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// 🔽 NEW: add mint to wishlist
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session || !session.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privyId = session.sub;
    const { mint } = (await req.json()) as { mint?: string };

    if (!mint || typeof mint !== "string" || !mint.trim()) {
      return NextResponse.json({ error: "mint is required" }, { status: 400 });
    }

    const normalizedMint = mint.trim();

    await connect();

    // Use $addToSet so we don't get duplicates
    const user = await User.findOneAndUpdate(
      { privyId },
      {
        $addToSet: {
          wishlistTokenMints: normalizedMint,
        },
      },
      {
        new: true, // return updated doc
      }
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Ensure it's always an array
    const wishlist = Array.isArray(user.wishlistTokenMints)
      ? user.wishlistTokenMints
      : [];

    return NextResponse.json({
      wishlist,
      addedMint: normalizedMint,
    });
  } catch (error) {
    console.error("[POST /api/user/wishlist] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session || !session.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const privyId = session.sub;
    const { mint } = (await req.json()) as { mint?: string };

    if (!mint || typeof mint !== "string" || !mint.trim()) {
      return NextResponse.json({ error: "mint is required" }, { status: 400 });
    }

    const normalizedMint = mint.trim();
    await connect();

    const user = await User.findOneAndUpdate(
      { privyId },
      {
        $pull: {
          wishlistTokenMints: normalizedMint,
        },
      },
      { new: true }
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const wishlist = Array.isArray(user.wishlistTokenMints)
      ? user.wishlistTokenMints
      : [];

    return NextResponse.json({
      wishlist,
      removedMint: normalizedMint,
    });
  } catch (error) {
    console.error("[DELETE /api/user/wishlist] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
