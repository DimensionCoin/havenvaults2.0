// app/api/bundle/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import Bundle, {
  type BundleRiskLevel,
  type BundleKind,
  type BundleVisibility,
} from "@/models/Bundle";
import { getServerUser } from "@/lib/getServerUser";
import { findTokenBySymbol } from "@/lib/tokenConfig";

export const dynamic = "force-dynamic";

type AllocationInput = {
  symbol: string;
  weight: number;
};

type CreateBundleBody = {
  name: string;
  subtitle?: string;
  allocations: AllocationInput[];
  risk?: BundleRiskLevel;
  visibility?: BundleVisibility;
};

/**
 * Determine bundle kind based on allocations
 */
function determineBundleKind(allocations: AllocationInput[]): BundleKind {
  let hasStock = false;
  let hasCrypto = false;

  for (const a of allocations) {
    const token = findTokenBySymbol(a.symbol);
    if (token) {
      if (token.kind === "stock") hasStock = true;
      if (token.kind === "crypto") hasCrypto = true;
    }
  }

  if (hasStock && hasCrypto) return "mixed";
  if (hasStock) return "stocks";
  return "crypto";
}

/**
 * Validate allocations against token config
 */
function validateAllocations(allocations: AllocationInput[]): string | null {
  if (!Array.isArray(allocations)) {
    return "Allocations must be an array";
  }

  if (allocations.length < 2) {
    return "Bundle must have at least 2 assets";
  }

  if (allocations.length > 5) {
    return "Bundle cannot have more than 5 assets";
  }

  const symbols = new Set<string>();
  let totalWeight = 0;

  for (const a of allocations) {
    if (!a.symbol || typeof a.symbol !== "string") {
      return "Each allocation must have a valid symbol";
    }

    const symbol = a.symbol.trim().toUpperCase();

    if (symbols.has(symbol)) {
      return `Duplicate asset: ${symbol}`;
    }
    symbols.add(symbol);

    const token = findTokenBySymbol(symbol);
    if (!token) {
      return `Unknown asset: ${symbol}`;
    }

    if (typeof a.weight !== "number" || a.weight < 0 || a.weight > 100) {
      return `Invalid weight for ${symbol}: must be between 0 and 100`;
    }

    totalWeight += a.weight;
  }

  if (Math.abs(totalWeight - 100) > 0.5) {
    return `Weights must sum to 100% (current: ${totalWeight.toFixed(1)}%)`;
  }

  return null;
}

/**
 * POST /api/bundle/create
 * Create a new user bundle
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as CreateBundleBody;

    // Validate name
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json(
        { error: "Bundle name is required" },
        { status: 400 },
      );
    }

    const name = body.name.trim();
    if (name.length < 1 || name.length > 50) {
      return NextResponse.json(
        { error: "Bundle name must be between 1 and 50 characters" },
        { status: 400 },
      );
    }

    // Validate subtitle if provided
    const subtitle = body.subtitle?.trim();
    if (subtitle && subtitle.length > 100) {
      return NextResponse.json(
        { error: "Subtitle cannot exceed 100 characters" },
        { status: 400 },
      );
    }

    // Validate allocations
    const allocationsError = validateAllocations(body.allocations);
    if (allocationsError) {
      return NextResponse.json({ error: allocationsError }, { status: 400 });
    }

    // Normalize allocations
    const allocations = body.allocations.map((a) => ({
      symbol: a.symbol.trim().toUpperCase(),
      weight: Math.round(a.weight * 100) / 100, // Round to 2 decimal places
    }));

    // Determine kind based on assets
    const kind = determineBundleKind(allocations);

    // Validate risk level
    const validRisks: BundleRiskLevel[] = ["low", "medium", "high", "degen"];
    const risk = validRisks.includes(body.risk as BundleRiskLevel)
      ? (body.risk as BundleRiskLevel)
      : "medium";

    // Validate visibility
    const validVisibility: BundleVisibility[] = ["public", "private"];
    const visibility = validVisibility.includes(
      body.visibility as BundleVisibility,
    )
      ? (body.visibility as BundleVisibility)
      : "private";

    await connect();

    // Check for duplicate names for this user
    const existing = await Bundle.findOne({
      userId: user._id,
      name: { $regex: new RegExp(`^${name}$`, "i") },
      isActive: true,
    });

    if (existing) {
      return NextResponse.json(
        { error: "You already have a bundle with this name" },
        { status: 400 },
      );
    }

    // Create the bundle
    const bundle = await Bundle.create({
      userId: user._id,
      name,
      subtitle,
      allocations,
      risk,
      kind,
      visibility,
    });

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
    console.error("[POST /api/bundle/create] Error:", error);

    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "Failed to create bundle" },
      { status: 500 },
    );
  }
}
