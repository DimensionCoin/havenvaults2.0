// app/api/bundle/create/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import Bundle, {
  type BundleRiskLevel,
  type BundleKind,
  type BundleVisibility,
} from "@/models/Bundle";
import { findTokenBySymbol } from "@/lib/tokenConfig";

import { rateLimitServer } from "@/lib/rateLimitServer";
import { requireServerUser } from "@/lib/getServerUser";

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

  /**
   * ✅ Optional: if your client sends a userId, we enforce it matches session user.
   * If you don't send this from client, we still safely force userId = session user.
   */
  userId?: string;
};

type ErrorPayload = {
  error: string;
  code: string;
  userMessage?: string;
  details?: string;
  traceId?: string;
};

function jsonError(status: number, payload: ErrorPayload) {
  return NextResponse.json(payload, { status });
}

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
  const traceId = Math.random().toString(36).slice(2, 10);

  try {
    // ✅ Rate limit early (protect DB / avoid spam bundle creation)
    const blocked = await rateLimitServer(req, {
      api: "bundle:create",
      requireAuth: true,
      allowIpFallback: false,
      failMode: "closed",
      tiers: [
        { limit: 2, windowMs: 10_000, suffix: "burst" }, // double-click protection
        { limit: 8, windowMs: 60_000, suffix: "minute" }, // normal usage
        { limit: 60, windowMs: 60 * 60_000, suffix: "hour" }, // spam cap
      ],
      globalTiers: [
        { limit: 40, windowMs: 10_000, suffix: "burst" },
        { limit: 300, windowMs: 60_000, suffix: "minute" },
      ],
    });
    if (blocked) return blocked;

    // ✅ Auth (hard fail)
    const user = await requireServerUser();

    const body = (await req
      .json()
      .catch(() => null)) as CreateBundleBody | null;
    if (!body) {
      return jsonError(400, {
        code: "INVALID_JSON",
        error: "Invalid JSON body",
        userMessage: "Invalid request.",
        traceId,
      });
    }

    // ✅ Security: if client tries to specify userId, enforce it matches session user.
    // Otherwise we ignore client userId completely and always create for session user.
    const clientUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    if (clientUserId && String(clientUserId) !== String(user._id)) {
      return jsonError(403, {
        code: "USER_MISMATCH",
        error: "Body userId does not match authenticated user",
        userMessage: "This request doesn't match your account.",
        traceId,
      });
    }

    // Validate name
    if (!body.name || typeof body.name !== "string") {
      return jsonError(400, {
        code: "MISSING_NAME",
        error: "Bundle name is required",
        userMessage: "Bundle name is required.",
        traceId,
      });
    }

    const name = body.name.trim();
    if (name.length < 1 || name.length > 50) {
      return jsonError(400, {
        code: "BAD_NAME",
        error: "Bundle name must be between 1 and 50 characters",
        userMessage: "Bundle name must be between 1 and 50 characters.",
        traceId,
      });
    }

    // Validate subtitle if provided
    const subtitle =
      typeof body.subtitle === "string" ? body.subtitle.trim() : undefined;
    if (subtitle && subtitle.length > 100) {
      return jsonError(400, {
        code: "BAD_SUBTITLE",
        error: "Subtitle cannot exceed 100 characters",
        userMessage: "Subtitle cannot exceed 100 characters.",
        traceId,
      });
    }

    // Validate allocations
    if (!body.allocations) {
      return jsonError(400, {
        code: "MISSING_ALLOCATIONS",
        error: "Allocations are required",
        userMessage: "Please choose your bundle assets.",
        traceId,
      });
    }

    const allocationsError = validateAllocations(body.allocations);
    if (allocationsError) {
      return jsonError(400, {
        code: "BAD_ALLOCATIONS",
        error: allocationsError,
        userMessage: allocationsError,
        traceId,
      });
    }

    // Normalize allocations
    const allocations = body.allocations.map((a) => ({
      symbol: a.symbol.trim().toUpperCase(),
      weight: Math.round(a.weight * 100) / 100, // 2dp
    }));

    // Determine kind
    const kind = determineBundleKind(allocations);

    // Risk
    const validRisks: BundleRiskLevel[] = ["low", "medium", "high", "degen"];
    const risk = validRisks.includes(body.risk as BundleRiskLevel)
      ? (body.risk as BundleRiskLevel)
      : "medium";

    // Visibility
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
      return jsonError(400, {
        code: "DUPLICATE_NAME",
        error: "You already have a bundle with this name",
        userMessage: "You already have a bundle with this name.",
        traceId,
      });
    }

    // ✅ Always force ownership to authed user (ignore anything client might try)
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
        totalVolume: bundle.totalVolume?.toString?.() ?? "0",
      },
      traceId,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/bundle/create] Error:", error);

    if (error instanceof Error && error.message === "Unauthorized") {
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
        userMessage: "Please sign in again.",
        traceId,
      });
    }

    if (error instanceof Error && error.name === "ValidationError") {
      return jsonError(400, {
        code: "VALIDATION_ERROR",
        error: error.message,
        userMessage: error.message,
        traceId,
      });
    }

    return jsonError(500, {
      code: "CREATE_FAILED",
      error: "Failed to create bundle",
      userMessage: "Failed to create bundle.",
      details: error instanceof Error ? error.message : String(error),
      traceId,
    });
  }
}
