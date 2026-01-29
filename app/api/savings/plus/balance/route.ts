// app/api/savings/plus/balance/route.ts
import "server-only";

import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getSessionFromCookies } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const JUP_API_KEY = required("JUP_API_KEY");
const JUP_EARN_POSITIONS_URL = "https://api.jup.ag/lend/v1/earn/positions";

const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
const TARGET_JL_SYMBOL = "jlJupUSD";

type EarnToken = {
  address: string;
  symbol?: string;
  decimals: number;
  assetAddress?: string;
  asset?: { symbol?: string };
};

type EarnPosition = {
  token: EarnToken;
  ownerAddress: string;
  shares: string;
  underlyingAssets: string;
  underlyingBalance: string;
  allowance: string;
};

type UserWalletDoc = {
  walletAddress?: string | null;
  privyId?: string | null;
};

type PlusBalancePayload = {
  owner: string;
  symbol: string;
  jlSymbol: string;
  token?: EarnToken;
  hasPosition: boolean;
  shares: string;
  underlyingAssets: string;
  underlyingBalance: string;
  allowance: string;
  sharesUi: string;
  underlyingAssetsUi: string;
  underlyingBalanceUi: string;
  allowanceUi: string;

  // helpful flags for client UX
  cached?: boolean;
  stale?: boolean;
  ms?: number;
  warning?: string;
};

function json(
  status: number,
  payload: PlusBalancePayload,
  extraHeaders?: Record<string, string>,
) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      ...extraHeaders,
    },
  });
}

function jsonError(
  status: number,
  payload: { error: string; code?: string; details?: unknown },
) {
  return NextResponse.json(payload, { status });
}

/** Safe base units → UI decimal string. */
function baseUnitsToUiString(baseUnits: string, decimals: number): string {
  const d = Number.isFinite(decimals) ? Math.max(0, Math.min(18, decimals)) : 0;

  let x: bigint;
  try {
    x = BigInt(String(baseUnits || "0"));
  } catch {
    x = BigInt("0");
  }

  if (x <= BigInt("0")) return "0";
  if (d === 0) return x.toString();

  const denom = BigInt("10") ** BigInt(String(d));
  const whole = x / denom;
  const frac = x % denom;

  const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, ms: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      cache: "no-store",
      headers: {
        "x-api-key": JUP_API_KEY,
        Accept: "application/json",
      },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * In-memory cache (per server instance).
 */
const g = globalThis as unknown as {
  __PLUS_CACHE__?: Map<string, { ts: number; payload: PlusBalancePayload }>;
  __PLUS_INFLIGHT__?: Map<string, Promise<PlusBalancePayload>>;
};

const CACHE: Map<string, { ts: number; payload: PlusBalancePayload }> =
  g.__PLUS_CACHE__ ?? (g.__PLUS_CACHE__ = new Map());

const INFLIGHT: Map<
  string,
  Promise<PlusBalancePayload>
> = g.__PLUS_INFLIGHT__ ?? (g.__PLUS_INFLIGHT__ = new Map());

const TTL_MS = 60_000; // fresh cache window

function emptyUnknown(owner: string): PlusBalancePayload {
  // IMPORTANT: This is "unknown" not "0 balance", so client should treat stale+warning accordingly.
  return {
    owner,
    symbol: "JupUSD",
    jlSymbol: TARGET_JL_SYMBOL,
    hasPosition: false,
    shares: "0",
    underlyingAssets: "0",
    underlyingBalance: "0",
    allowance: "0",
    sharesUi: "0",
    underlyingAssetsUi: "0",
    underlyingBalanceUi: "0",
    allowanceUi: "0",
    cached: false,
    stale: true,
    warning: "Temporarily unable to refresh Plus balance",
  };
}

async function computePlusPayload(owner: string): Promise<PlusBalancePayload> {
  const positionsUrl =
    `${JUP_EARN_POSITIONS_URL}?` + new URLSearchParams({ users: owner });

  const attempt = async (timeoutMs: number) => {
    const res = await fetchWithTimeout(positionsUrl, timeoutMs);

    // Treat 5xx as retryable; 4xx likely not.
    if (!res.ok)
      throw Object.assign(new Error(`HTTP ${res.status}`), {
        status: res.status,
      });

    return (await res.json()) as EarnPosition[];
  };

  let positions: EarnPosition[] | null = null;

  try {
    positions = await attempt(2500);
  } catch {
    await sleep(250);
    positions = await attempt(3500);
  }

  const pos = (positions || []).find((p) => {
    const sym = String(p?.token?.symbol || "").trim();
    const assetAddr = String(p?.token?.assetAddress || "").trim();
    return sym === TARGET_JL_SYMBOL || assetAddr === JUPUSD_MINT;
  });

  if (!pos) {
    return {
      owner,
      symbol: "JupUSD",
      jlSymbol: TARGET_JL_SYMBOL,
      hasPosition: false,
      shares: "0",
      underlyingAssets: "0",
      underlyingBalance: "0",
      allowance: "0",
      sharesUi: "0",
      underlyingAssetsUi: "0",
      underlyingBalanceUi: "0",
      allowanceUi: "0",
      cached: false,
      stale: false,
    };
  }

  const decimals = Number(pos.token?.decimals ?? 6);

  return {
    owner,
    symbol: pos.token?.asset?.symbol || "JupUSD",
    jlSymbol: pos.token?.symbol || TARGET_JL_SYMBOL,
    token: pos.token,
    hasPosition: true,
    shares: pos.shares,
    underlyingAssets: pos.underlyingAssets,
    underlyingBalance: pos.underlyingBalance,
    allowance: pos.allowance,
    sharesUi: baseUnitsToUiString(pos.shares, decimals),
    underlyingAssetsUi: baseUnitsToUiString(pos.underlyingAssets, decimals),
    underlyingBalanceUi: baseUnitsToUiString(pos.underlyingBalance, decimals),
    allowanceUi: baseUnitsToUiString(pos.allowance, decimals),
    cached: false,
    stale: false,
  };
}

export async function GET() {
  const started = Date.now();

  // 1) auth + owner
  const session = await getSessionFromCookies().catch(() => null);
  if (!session?.userId) return jsonError(401, { error: "Unauthorized" });

  await connect();

  const mongoId = mongoose.Types.ObjectId.isValid(session.userId)
    ? new mongoose.Types.ObjectId(session.userId)
    : null;

  const user = ((mongoId
    ? await User.findById(mongoId)
        .select({ walletAddress: 1, privyId: 1 })
        .lean()
    : null) ||
    (await User.findOne({ privyId: session.userId })
      .select({ walletAddress: 1, privyId: 1 })
      .lean())) as UserWalletDoc | null;

  const owner = String(user?.walletAddress || "").trim();
  if (!owner || owner === "pending") {
    return jsonError(400, {
      error: "User has no wallet address",
      code: "NO_WALLET",
    });
  }

  // 2) serve fresh cache immediately
  const cachedEntry = CACHE.get(owner);
  const cacheFresh = cachedEntry && Date.now() - cachedEntry.ts < TTL_MS;

  if (cacheFresh) {
    return json(200, {
      ...cachedEntry!.payload,
      cached: true,
      stale: false,
      ms: Date.now() - started,
    });
  }

  // 3) in-flight dedupe per owner (prevents stampede)
  const existing = INFLIGHT.get(owner);
  if (existing) {
    try {
      const payload = await existing;
      return json(200, {
        ...payload,
        cached: true,
        stale: false,
        ms: Date.now() - started,
      });
    } catch {
      // fall through to stale logic below
    }
  }

  const p = (async () => {
    const payload = await computePlusPayload(owner);
    CACHE.set(owner, { ts: Date.now(), payload });
    return payload;
  })();

  INFLIGHT.set(owner, p);

  try {
    const payload = await p;
    return json(200, {
      ...payload,
      cached: false,
      stale: false,
      ms: Date.now() - started,
    });
  } catch (e) {
    const err = e as Error & { name?: string; status?: number };

    // ✅ BEST UX: if we have any cached value at all, return it as stale (200)
    const stale = CACHE.get(owner);
    if (stale?.payload) {
      return json(200, {
        ...stale.payload,
        cached: true,
        stale: true,
        warning:
          err?.name === "AbortError"
            ? "Plus balance refresh timed out; showing last known value"
            : "Plus balance refresh failed; showing last known value",
        ms: Date.now() - started,
      });
    }

    // ✅ If no cache yet, return a safe "unknown" payload (still 200 so UI doesn't hard-fail)
    return json(200, {
      ...emptyUnknown(owner),
      warning:
        err?.name === "AbortError"
          ? "Plus balance refresh timed out"
          : `Plus balance refresh failed: ${err?.message || "unknown"}`,
      ms: Date.now() - started,
    });
  } finally {
    INFLIGHT.delete(owner);
  }
}
