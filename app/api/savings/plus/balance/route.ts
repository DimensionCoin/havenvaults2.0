// app/api/savings/plus/balance/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
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
  decimals?: number;
  shares: string;
  underlyingAssets: string;
  underlyingBalance: string;
  allowance: string;
  sharesUi: string;
  underlyingAssetsUi: string;
  underlyingBalanceUi: string;
  allowanceUi: string;
};

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
 * This is NOT perfect across regions/instances, but it massively improves UX and reduces load.
 */
const plusCache = globalThis as unknown as {
  __PLUS_CACHE__?: Map<
    string,
    {
      ts: number;
      payload: PlusBalancePayload;
    }
  >;
};

const CACHE: Map<string, { ts: number; payload: PlusBalancePayload }> =
  plusCache.__PLUS_CACHE__ ?? (plusCache.__PLUS_CACHE__ = new Map());

const TTL_MS = 60_000; // 60s cached freshness (tune 30s–120s)
const CACHE_CAP = 5000; // hard cap to avoid unbounded growth

function cacheGetFresh(key: string): PlusBalancePayload | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    // stale — return null but keep entry so catch-block can serve it as fallback
    return null;
  }
  // LRU: move to back
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit.payload;
}

function cacheSet(key: string, payload: PlusBalancePayload) {
  CACHE.set(key, { ts: Date.now(), payload });
  while (CACHE.size > CACHE_CAP) {
    const oldestKey = CACHE.keys().next().value;
    if (oldestKey === undefined) break;
    CACHE.delete(oldestKey);
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  let owner: string | null = null;

  try {
    const session = await getSessionFromCookies();
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

    owner = String(user?.walletAddress || "").trim();
    if (!owner || owner === "pending") {
      return jsonError(400, {
        error: "User has no wallet address",
        code: "NO_WALLET",
      });
    }

    const forceFresh =
      req.nextUrl.searchParams.has("fresh") ||
      req.nextUrl.searchParams.has("bust") ||
      req.nextUrl.searchParams.get("force") === "1";

    // ✅ Serve fresh-enough cache immediately
    const cachedPayload = !forceFresh ? cacheGetFresh(owner) : null;
    if (cachedPayload) {
      return NextResponse.json(
        { ...cachedPayload, cached: true, stale: false },
        {
          status: 200,
          headers: {
            "Cache-Control": "private, max-age=0, must-revalidate",
          },
        },
      );
    }

    const positionsUrl =
      `${JUP_EARN_POSITIONS_URL}?` + new URLSearchParams({ users: owner });

    // ✅ Try twice (short timeout each), jitter
    const attempt = async (timeoutMs: number) => {
      const res = await fetchWithTimeout(positionsUrl, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as EarnPosition[];
    };

    let positions: EarnPosition[] | null = null;

    try {
      positions = await attempt(2500); // first try
    } catch {
      // small backoff then retry
      await sleep(250);
      positions = await attempt(3500); // second try
    }

    const pos = (positions || []).find((p) => {
      const sym = String(p?.token?.symbol || "").trim();
      const assetAddr = String(p?.token?.assetAddress || "").trim();
      return sym === TARGET_JL_SYMBOL || assetAddr === JUPUSD_MINT;
    });

    // normalize response
    const payload = (() => {
      if (!pos) {
        return {
          owner,
          symbol: "JupUSD",
          jlSymbol: TARGET_JL_SYMBOL,
          hasPosition: false,
          decimals: 6,
          shares: "0",
          underlyingAssets: "0",
          underlyingBalance: "0",
          allowance: "0",
          sharesUi: "0",
          underlyingAssetsUi: "0",
          underlyingBalanceUi: "0",
          allowanceUi: "0",
        };
      }

      const decimals = Number(pos.token?.decimals ?? 6);

      return {
        owner,
        symbol: pos.token?.asset?.symbol || "JupUSD",
        jlSymbol: pos.token?.symbol || TARGET_JL_SYMBOL,
        token: pos.token,
        hasPosition: true,
        decimals,
        shares: pos.shares,
        underlyingAssets: pos.underlyingAssets,
        underlyingBalance: pos.underlyingBalance,
        allowance: pos.allowance,
        sharesUi: baseUnitsToUiString(pos.shares, decimals),
        underlyingAssetsUi: baseUnitsToUiString(pos.underlyingAssets, decimals),
        underlyingBalanceUi: baseUnitsToUiString(
          pos.underlyingBalance,
          decimals,
        ),
        allowanceUi: baseUnitsToUiString(pos.allowance, decimals),
      };
    })();

    // ✅ update cache
    cacheSet(owner, payload);

    return NextResponse.json(
      { ...payload, cached: false, stale: false, ms: Date.now() - started },
      {
        status: 200,
        headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
      },
    );
  } catch (e) {
    const err = e as Error & { name?: string };

    // ✅ If we have ANY cached value, return it as stale instead of 504
    // (this prevents "blank plus balance" UX)
    if (owner) {
      const cached = CACHE.get(owner);
      if (cached) {
        return NextResponse.json(
          { ...cached.payload, cached: true, stale: true },
          {
            status: 200,
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
        );
      }
    }

    // fallback: return 504, but make it a clean error
    if (err?.name === "AbortError") {
      return jsonError(504, {
        error: "Plus balance timeout",
        code: "PLUS_TIMEOUT",
      });
    }

    return jsonError(500, {
      error: "Internal server error",
      code: "UNHANDLED",
      details: err?.message || String(e),
    });
  }
}
