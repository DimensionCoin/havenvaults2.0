// lib/logErrorEvent.ts
import "server-only";

import crypto from "crypto";
import mongoose from "mongoose";
import type { NextRequest } from "next/server";

import { connect } from "@/lib/db";
import { getSessionFromCookies } from "@/lib/auth";
import { ErrorEvent } from "@/models/ErrorEvent";

type LogErrorParams = {
  req?: NextRequest;
  error: unknown;
  route?: string;
  stage?: string;
  status?: number;
  source?: "server" | "client";
  meta?: Record<string, unknown>;
};

function clip(input: unknown, max: number): string | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function safeStack(err: unknown): string | undefined {
  if (err instanceof Error) return clip(err.stack, 4000);
  return undefined;
}

function safeName(err: unknown): string | undefined {
  if (err instanceof Error) return clip(err.name, 120);
  return undefined;
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) return clip(err.message, 500) || "Unknown error";
  const asStr = clip(String(err), 500);
  return asStr || "Unknown error";
}

function fingerprintFrom(params: {
  source: string;
  name?: string;
  message: string;
  route?: string;
  stack?: string;
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

export async function logErrorEvent(params: LogErrorParams): Promise<void> {
  try {
    const source = params.source === "client" ? "client" : "server";
    const message = safeMessage(params.error);
    const name = safeName(params.error);
    const stack = safeStack(params.error);
    const route = clip(params.route, 200);
    const stage = clip(params.stage, 120);
    const status =
      typeof params.status === "number" && Number.isFinite(params.status)
        ? params.status
        : undefined;

    const session = await getSessionFromCookies();
    const userIdRaw = session?.userId;
    const userId =
      userIdRaw && mongoose.Types.ObjectId.isValid(userIdRaw)
        ? new mongoose.Types.ObjectId(userIdRaw)
        : undefined;

    const privyId = clip(session?.sub, 120);
    const email = clip(session?.email, 120);

    const fingerprint = fingerprintFrom({
      source,
      name,
      message,
      route,
      stack,
    });

    await connect();
    await ErrorEvent.create({
      userId,
      privyId,
      email,
      source,
      name,
      message,
      stack,
      route,
      userAgent: params.req
        ? clip(params.req.headers.get("user-agent"), 300)
        : undefined,
      fingerprint,
      meta: {
        ...(params.meta || {}),
        ...(stage ? { stage } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });
  } catch {
    // Never throw from logging
  }
}

export function shouldLogStatus(status?: number): boolean {
  if (!status || !Number.isFinite(status)) return false;
  return status >= 500 || status === 401 || status === 403 || status === 429;
}
