// app/api/bundles/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import Bundle from "@/models/Bundle";
import { getServerUser } from "@/lib/getServerUser";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

/**
 * GET /api/bundles/[id]
 * Fetch a single bundle by ID
 * - Public bundles can be viewed by anyone
 * - Private bundles can only be viewed by the owner
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bundle ID" }, { status: 400 });
    }

    await connect();

    const bundle = await Bundle.findOne({
      _id: id,
      isActive: true,
    }).lean();

    if (!bundle) {
      return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    }

    // If private, check ownership
    if (bundle.visibility === "private") {
      const user = await getServerUser();

      if (!user || bundle.userId.toString() !== user._id?.toString()) {
        return NextResponse.json(
          { error: "Bundle not found" },
          { status: 404 },
        );
      }
    }

    return NextResponse.json({
      bundle: {
        ...bundle,
        _id: bundle._id.toString(),
        userId: bundle.userId.toString(),
        totalVolume: bundle.totalVolume?.toString() ?? "0",
      },
    });
  } catch (error) {
    console.error("[GET /api/bundles/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bundle" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/bundles/[id]
 * Soft-delete a bundle (set isActive to false)
 * Only the owner can delete their bundle
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getServerUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bundle ID" }, { status: 400 });
    }

    await connect();

    const bundle = await Bundle.findOne({
      _id: id,
      isActive: true,
    });

    if (!bundle) {
      return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    }

    // Check ownership
    if (bundle.userId.toString() !== user._id?.toString()) {
      return NextResponse.json(
        { error: "Not authorized to delete this bundle" },
        { status: 403 },
      );
    }

    // Soft delete
    bundle.isActive = false;
    await bundle.save();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/bundles/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete bundle" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/bundles/[id]
 * Update a bundle's visibility
 * Only the owner can update their bundle
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getServerUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid bundle ID" }, { status: 400 });
    }

    const body = await req.json();

    await connect();

    const bundle = await Bundle.findOne({
      _id: id,
      isActive: true,
    });

    if (!bundle) {
      return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
    }

    // Check ownership
    if (bundle.userId.toString() !== user._id?.toString()) {
      return NextResponse.json(
        { error: "Not authorized to update this bundle" },
        { status: 403 },
      );
    }

    // Update visibility if provided
    if (body.visibility && ["public", "private"].includes(body.visibility)) {
      bundle.visibility = body.visibility;
    }

    await bundle.save();

    return NextResponse.json({
      success: true,
      bundle: {
        ...bundle.toObject(),
        _id: bundle._id.toString(),
        userId: bundle.userId.toString(),
        totalVolume: bundle.totalVolume?.toString() ?? "0",
      },
    });
  } catch (error) {
    console.error("[PATCH /api/bundles/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to update bundle" },
      { status: 500 },
    );
  }
}
