// app/api/vitals/error/route.ts
import "server-only";

import crypto from "crypto";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";

import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { rateLimitServer } from "@/lib/rateLimitServer";
import { validateCsrf } from "@/lib/csrf";
import { ErrorEvent } from "@/models/ErrorEvent";
import { withApiLogging } from "@/lib/withApiLogging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorPayload = {
  source?: "client" | "server";
  name?: string;
  message?: string;
  stack?: string;
  route?: string;
  url?: string;
  meta?: Record<string, unknown>;
};

function clip(input: unknown, max: number): string | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  if (!host || !origin) return false;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

function fingerprintFrom(params: {
  source: string;
  name?: string;
  message: string;
  stack?: string;
  route?: string;
}): string {
  const topLine =
    typeof params.stack === "string" ? params.stack.split("\n")[0] ?? "" : "";
  const raw = [
    params.source,
    params.name || "",
    params.message,
    params.route || "",
    topLine,
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function POSTHandler(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const blocked = await rateLimitServer(req, {
    api: "vitals:error",
    requireAuth: false,
    allowIpFallback: true,
    failMode: "open",
    tiers: [
      { limit: 6, windowMs: 10_000, suffix: "burst" },
      { limit: 60, windowMs: 60_000, suffix: "minute" },
    ],
  });
  if (blocked) return blocked;

  const raw = await req.text();
  let payload: ErrorPayload = {};
  try {
    payload = raw ? (JSON.parse(raw) as ErrorPayload) : {};
  } catch {
    payload = {};
  }

  const source = payload.source === "server" ? "server" : "client";
  const message = clip(payload.message, 500);
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const name = clip(payload.name, 120);
  const stack = clip(payload.stack, 4000);
  const route = clip(payload.route, 200);
  const url = clip(payload.url, 500);
  const userAgent = clip(req.headers.get("user-agent"), 300);

  const session = await getSessionFromCookies();
  const userIdRaw = session?.userId;
  const userId =
    userIdRaw && mongoose.Types.ObjectId.isValid(userIdRaw)
      ? new mongoose.Types.ObjectId(userIdRaw)
      : undefined;
  const privyId = clip(session?.sub, 120);

  const fingerprint = fingerprintFrom({
    source,
    name: name || undefined,
    message,
    stack: stack || undefined,
    route: route || undefined,
  });

  await connect();
  await ErrorEvent.create({
    userId,
    privyId,
    source,
    name,
    message,
    stack,
    route,
    url,
    userAgent,
    fingerprint,
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
  });

  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging("/api/vitals/error", POSTHandler);