// app/api/savings/plus/earnings/route.ts
import "server-only";

import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getSessionFromCookies } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── ENV ───────── */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const JUP_API_KEY = required("JUP_API_KEY");
const IS_PROD = process.env.NODE_ENV === "production";

/* ───────── Jupiter URLs ───────── */

const JUP_EARN_POSITIONS_URL = "https://api.jup.ag/lend/v1/earn/positions";
const JUP_EARN_EARNINGS_URL = "https://api.jup.ag/lend/v1/earn/earnings";

// Underlying mint for the vault we care about
const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
// jlToken symbol for the JupUSD Earn vault
const TARGET_JL_SYMBOL = "jlJupUSD";

/* ───────── Types (minimal) ───────── */

type EarnToken = {
  address?: string; // jlToken mint (THIS is what "positions=" expects)
  symbol?: string; // e.g. jlJupUSD
  decimals?: number; // sometimes jlToken decimals
  assetAddress?: string; // underlying mint
  asset?: { decimals?: number; symbol?: string };
};

type EarnPosition = {
  token?: EarnToken;
  shares?: string;
  underlyingAssets?: string;
  underlyingBalance?: string;
};

type UserEarningsResponse = {
  address: string;
  ownerAddress: string;
  totalDeposits: string;
  totalWithdraws: string;
  totalBalance: string;
  totalAssets: string;
  earnings: string;
};

type UserWalletDoc = {
  walletAddress?: string | null;
  privyId?: string | null;
};

/* ───────── Helpers ───────── */

function redactAddr(a?: string | null) {
  const s = String(a || "").trim();
  if (!s) return "";
  if (s.length <= 12) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function dbg(label: string, obj?: unknown) {
  if (obj === undefined) console.log(`[PLUS/EARNINGS] ${label}`);
  else console.log(`[PLUS/EARNINGS] ${label}`, obj);
}

async function jupFetch(url: string) {
  return fetch(url, {
    cache: "no-store",
    headers: {
      "x-api-key": JUP_API_KEY,
      Accept: "application/json",
    },
  });
}

function jsonError(
  status: number,
  payload: { error: string; code?: string; details?: unknown },
) {
  return NextResponse.json(payload, { status });
}

/** Safe base units → UI decimal string (best effort). */
function baseUnitsToUiString(baseUnits: string, decimals: number): string {
  const d = Number.isFinite(decimals) ? Math.max(0, Math.min(18, decimals)) : 0;

  let x: bigint;
  try {
    x = BigInt(String(baseUnits || "0"));
  } catch {
    x = BigInt("0");
  }

  if (x === BigInt("0")) return "0";
  if (d === 0) return x.toString();

  const denom = BigInt("10") ** BigInt(String(d));
  const whole = x / denom;
  const frac = x % denom;

  const fracStr = frac.toString().padStart(d, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

function safeJson(obj: unknown) {
  try {
    return JSON.parse(JSON.stringify(obj)) as unknown;
  } catch {
    return obj;
  }
}

function bigSumStrings(vals: Array<string | undefined>) {
  let total = BigInt(0);
  for (const v of vals) {
    try {
      total += BigInt(String(v ?? "0"));
    } catch {
      // ignore
    }
  }
  return total.toString();
}

/** Normalize /earn/earnings response (object OR array) into a single combined object. */
function normalizeEarningsPayload(
  owner: string,
  payload: unknown,
): UserEarningsResponse | null {
  if (!payload) return null;

  // Case A: array (what you are actually getting)
  if (Array.isArray(payload)) {
    const arr = payload as UserEarningsResponse[];
    if (arr.length === 0) return null;
    if (arr.length === 1) return arr[0] ?? null;

    // Combine (sum) if multiple positions were returned
    return {
      address: "multiple",
      ownerAddress: arr[0]?.ownerAddress || owner,
      totalDeposits: bigSumStrings(arr.map((x) => x?.totalDeposits)),
      totalWithdraws: bigSumStrings(arr.map((x) => x?.totalWithdraws)),
      totalBalance: bigSumStrings(arr.map((x) => x?.totalBalance)),
      totalAssets: bigSumStrings(arr.map((x) => x?.totalAssets)),
      earnings: bigSumStrings(arr.map((x) => x?.earnings)),
    };
  }

  // Case B: object
  if (typeof payload === "object") {
    const obj = payload as Partial<UserEarningsResponse>;
    if (typeof obj.earnings === "string") return obj as UserEarningsResponse;
    return null;
  }

  return null;
}

/* ───────── Route ───────── */

export async function GET() {
  const debug: Record<string, unknown> = {};
  const t0 = Date.now();

  try {
    dbg("start");

    // Auth
    const session = await getSessionFromCookies();
    dbg("session", { hasUserId: Boolean(session?.userId) });
    debug.session = { hasUserId: Boolean(session?.userId) };

    if (!session?.userId) return jsonError(401, { error: "Unauthorized" });

    await connect();
    dbg("db connected");

    // Load user wallet
    const mongoId = mongoose.Types.ObjectId.isValid(session.userId)
      ? new mongoose.Types.ObjectId(session.userId)
      : null;

    let user: UserWalletDoc | null = null;

    if (mongoId) {
      user = (await User.findById(mongoId)
        .select({ walletAddress: 1, privyId: 1 })
        .lean()) as UserWalletDoc | null;

      dbg("user lookup by _id", {
        ok: Boolean(user),
        wallet: redactAddr(user?.walletAddress),
      });
      debug.userLookup = { by: "_id", ok: Boolean(user) };
    }

    if (!user) {
      user = (await User.findOne({ privyId: session.userId })
        .select({ walletAddress: 1, privyId: 1 })
        .lean()) as UserWalletDoc | null;

      dbg("user lookup by privyId", {
        ok: Boolean(user),
        wallet: redactAddr(user?.walletAddress),
      });
      debug.userLookup = { by: "privyId", ok: Boolean(user) };
    }

    const owner = String(user?.walletAddress || "").trim();
    debug.owner = redactAddr(owner);

    if (!owner || owner === "pending") {
      dbg("no wallet");
      return jsonError(400, {
        error: "User has no wallet address",
        code: "NO_WALLET",
      });
    }

    // 1) Fetch Earn positions for this user
    const positionsUrl =
      `${JUP_EARN_POSITIONS_URL}?` + new URLSearchParams({ users: owner });

    dbg("fetch positions", {
      url: positionsUrl.replace(owner, redactAddr(owner)),
    });
    debug.positionsUrl = positionsUrl.replace(owner, redactAddr(owner));

    const posRes = await jupFetch(positionsUrl);
    dbg("positions response", { ok: posRes.ok, status: posRes.status });
    debug.positionsStatus = { ok: posRes.ok, status: posRes.status };

    const posBodyText = await posRes.text().catch(() => "");
    dbg("positions raw body (trimmed)", posBodyText.slice(0, 600));

    if (!posRes.ok) {
      return jsonError(posRes.status, {
        error: "Failed to fetch Earn positions",
        code: "JUP_EARN_POSITIONS_FAILED",
        details: { status: posRes.status, body: posBodyText.slice(0, 600) },
      });
    }

    let positionsJson: unknown = [];
    try {
      positionsJson = posBodyText ? JSON.parse(posBodyText) : [];
    } catch {
      dbg("positions JSON parse failed");
      positionsJson = [];
    }

    const positions = (
      Array.isArray(positionsJson) ? positionsJson : []
    ) as EarnPosition[];

    dbg("positions parsed", { count: positions.length });
    debug.positionsCount = positions.length;

    // Log tokens we got (redacted)
    const tokenList = positions.map((p) => ({
      symbol: String(p?.token?.symbol || ""),
      assetAddress: redactAddr(p?.token?.assetAddress || ""),
      jlTokenMint: redactAddr(p?.token?.address || ""),
      hasTokenAddr: Boolean(String(p?.token?.address || "").trim()),
    }));
    dbg("positions tokens", tokenList);
    debug.positionsTokens = tokenList;

    // 2) Filter to JupUSD vault
    const matching = positions.filter((p) => {
      const sym = String(p?.token?.symbol || "").trim();
      const assetAddr = String(p?.token?.assetAddress || "").trim();
      return sym === TARGET_JL_SYMBOL || assetAddr === JUPUSD_MINT;
    });

    dbg("matching positions", { count: matching.length });
    debug.matchingCount = matching.length;

    if (matching.length === 0) {
      dbg("no matching JupUSD position found");
      return NextResponse.json({
        owner,
        hasPosition: false,
        earnings: "0",
        earningsUi: "0",
        totalAssets: "0",
        totalAssetsUi: "0",
        decimals: 6,
        ...(IS_PROD ? {} : { debug }),
      });
    }

    // ✅ /earn/earnings expects jlToken mint(s) in `positions=`
    const jlTokenAddresses = matching
      .map((p) => String(p?.token?.address || "").trim())
      .filter(Boolean);

    dbg("jlTokenAddresses (for positions=)", jlTokenAddresses.map(redactAddr));
    debug.positionsParam = jlTokenAddresses.map(redactAddr);

    if (jlTokenAddresses.length === 0) {
      dbg("missing jlToken mint for matching position");
      return jsonError(502, {
        error: "Missing jlToken address for JupUSD position",
        code: "JL_TOKEN_ADDRESS_MISSING",
        details: IS_PROD
          ? undefined
          : safeJson({ debug, sample: matching.slice(0, 2) }),
      });
    }

    const underlyingDecimals = Number(
      matching[0]?.token?.asset?.decimals ?? matching[0]?.token?.decimals ?? 6,
    );
    const decimals = Number.isFinite(underlyingDecimals)
      ? underlyingDecimals
      : 6;
    debug.decimals = decimals;

    // 3) Fetch earnings
    const earningsUrl =
      `${JUP_EARN_EARNINGS_URL}?` +
      new URLSearchParams({
        user: owner,
        positions: jlTokenAddresses.join(","),
      });

    dbg("fetch earnings", {
      url: earningsUrl.replace(owner, redactAddr(owner)),
    });
    debug.earningsUrl = earningsUrl.replace(owner, redactAddr(owner));

    const earnRes = await jupFetch(earningsUrl);
    dbg("earnings response", { ok: earnRes.ok, status: earnRes.status });
    debug.earningsStatus = { ok: earnRes.ok, status: earnRes.status };

    const earnText = await earnRes.text().catch(() => "");
    dbg("earnings raw body (trimmed)", earnText.slice(0, 900));

    if (!earnRes.ok) {
      return jsonError(earnRes.status, {
        error: "Failed to fetch earnings",
        code: "JUP_EARN_EARNINGS_FAILED",
        details: { status: earnRes.status, body: earnText.slice(0, 900) },
      });
    }

    let earningsParsed: unknown = null;
    try {
      earningsParsed = earnText ? JSON.parse(earnText) : null;
    } catch {
      earningsParsed = null;
    }

    const combined = normalizeEarningsPayload(owner, earningsParsed);

    if (!combined?.earnings) {
      dbg("earnings payload missing expected fields", safeJson(earningsParsed));
      return NextResponse.json({
        owner,
        hasPosition: true,
        positions: jlTokenAddresses, // full for app usage
        earnings: "0",
        earningsUi: "0",
        totalAssets: "0",
        totalAssetsUi: "0",
        decimals,
        ...(IS_PROD
          ? {}
          : { debug: { ...debug, earningsBody: safeJson(earningsParsed) } }),
      });
    }

    const earningsUi = baseUnitsToUiString(combined.earnings, decimals);
    const totalAssetsUi = baseUnitsToUiString(combined.totalAssets, decimals);

    dbg("computed UI", {
      earnings: combined.earnings,
      earningsUi,
      totalAssets: combined.totalAssets,
      totalAssetsUi,
      ms: Date.now() - t0,
    });

    return NextResponse.json({
      owner,
      hasPosition: true,

      // full, not redacted, for app usage:
      positions: jlTokenAddresses,

      // raw
      earnings: combined.earnings,
      totalAssets: combined.totalAssets,
      totalDeposits: combined.totalDeposits,
      totalWithdraws: combined.totalWithdraws,
      totalBalance: combined.totalBalance,

      // ui
      decimals,
      earningsUi,
      totalAssetsUi,
      totalDepositsUi: baseUnitsToUiString(combined.totalDeposits, decimals),
      totalWithdrawsUi: baseUnitsToUiString(combined.totalWithdraws, decimals),
      totalBalanceUi: baseUnitsToUiString(combined.totalBalance, decimals),

      ...(IS_PROD ? {} : { debug }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dbg("UNHANDLED", { msg });
    return jsonError(500, {
      error: "Internal server error",
      code: "UNHANDLED",
      details: msg,
    });
  }
}
