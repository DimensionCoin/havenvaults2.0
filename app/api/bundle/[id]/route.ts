// app/api/bundle/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import Bundle from "@/models/Bundle";
import { getServerUser } from "@/lib/getServerUser";
import mongoose from "mongoose";
import { validateCsrf } from "@/lib/csrf";
import { withApiLogging } from "@/lib/withApiLogging";

export const dynamic = "force-dynamic";

/**
 * GET /api/bundle/[id]
 * Fetch a single bundle by ID
 * - Public bundles can be viewed by anyone
 * - Private bundles can only be viewed by the owner
 */
async function GETHandler(
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
    console.error("[GET /api/bundle/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bundle" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/bundle/[id]
 * Soft-delete a bundle (set isActive to false)
 * Only the owner can delete their bundle
 */
async function DELETEHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = validateCsrf(req);
    if (csrfError) return csrfError;

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
    console.error("[DELETE /api/bundle/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete bundle" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/bundle/[id]
 * Update a bundle's visibility
 * Only the owner can update their bundle
 */
async function PATCHHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = validateCsrf(req);
    if (csrfError) return csrfError;

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
    if (body.visibility !== undefined) {
      if (!["public", "private"].includes(body.visibility)) {
        return NextResponse.json(
          { error: "Invalid visibility value. Must be 'public' or 'private'" },
          { status: 400 },
        );
      }
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
    console.error("[PATCH /api/bundle/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to update bundle" },
      { status: 500 },
    );
  }
}

export const GET = withApiLogging("/api/bundle/[id]", GETHandler);
export const DELETE = withApiLogging("/api/bundle/[id]", DELETEHandler);
export const PATCH = withApiLogging("/api/bundle/[id]", PATCHHandler);
