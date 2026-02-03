// app/api/auth/logout/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { withApiLogging } from "@/lib/withApiLogging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function POSTHandler(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const res = NextResponse.json({ success: true });

  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}

export const POST = withApiLogging("/api/auth/logout", POSTHandler);