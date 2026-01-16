// app/api/savings/plus/balance/route.ts
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

// Jupiter Earn base
const JUP_EARN_TOKENS_URL = "https://api.jup.ag/lend/v1/earn/tokens";
const JUP_EARN_POSITIONS_URL = "https://api.jup.ag/lend/v1/earn/positions";

// JupUSD mint address - the underlying asset we're looking for
const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

// The jlToken symbol for the JupUSD vault (Jupiter Lend JupUSD)
const TARGET_JL_SYMBOL = "jlJupUSD";

/* ───────── Types (minimal, stable) ───────── */

type EarnToken = {
  id?: number;
  address: string; // earn token address (jlToken mint / vault token address in Earn)
  name?: string;
  symbol?: string; // e.g., "jlJupUSD", "jlUSDC"
  decimals: number;
  assetAddress?: string; // underlying asset mint (e.g., JupUSD mint, USDC mint)
  asset?: {
    address?: string;
    name?: string;
    symbol?: string; // e.g., "JupUSD", "USDC"
    decimals?: number;
    logo_url?: string;
    price?: string;
    coingecko_id?: string;
  };
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

/* ───────── Helpers ───────── */

async function jupFetch(url: string) {
  return fetch(url, {
    cache: "no-store",
    headers: {
      "x-api-key": JUP_API_KEY,
      Accept: "application/json",
    },
  });
}

/** Safe base units → UI decimal string (no bigint literals). */
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

function jsonError(
  status: number,
  payload: { error: string; code?: string; details?: unknown }
) {
  return NextResponse.json(payload, { status });
}

/* ───────── Route ───────── */

export async function GET() {
  try {
    // Auth
    const session = await getSessionFromCookies();
    if (!session?.userId) return jsonError(401, { error: "Unauthorized" });

    await connect();

    // Load user (support both Mongo _id and privyId like your other routes)
    const mongoId = mongoose.Types.ObjectId.isValid(session.userId)
      ? new mongoose.Types.ObjectId(session.userId)
      : null;

    const user = ((
      (mongoId
        ? await User.findById(mongoId)
            .select({ walletAddress: 1, privyId: 1 })
            .lean()
        : null) ||
      (await User.findOne({ privyId: session.userId })
        .select({ walletAddress: 1, privyId: 1 })
        .lean())) as UserWalletDoc | null);

    const owner = String(user?.walletAddress || "").trim();
    if (!owner || owner === "pending") {
      return jsonError(400, {
        error: "User has no wallet address",
        code: "NO_WALLET",
      });
    }

    // 1) Discover Earn token for JupUSD vault
    // We match by EITHER:
    //   - assetAddress === JUPUSD_MINT (most reliable - the underlying asset)
    //   - symbol === "jlJupUSD" (the jlToken symbol)
    const tokensRes = await jupFetch(JUP_EARN_TOKENS_URL);
    if (!tokensRes.ok) {
      return jsonError(tokensRes.status, {
        error: "Failed to fetch Earn tokens",
        code: "JUP_EARN_TOKENS_FAILED",
        details: { status: tokensRes.status },
      });
    }

    const tokens = (await tokensRes.json()) as EarnToken[];

    // Find the JupUSD vault token by assetAddress or symbol
    const targetToken = tokens.find((t) => {
      // Primary: match by underlying asset address (most reliable)
      if (t?.assetAddress === JUPUSD_MINT) return true;
      // Fallback: match by jlToken symbol
      const sym = String(t?.symbol || "").trim();
      if (sym === TARGET_JL_SYMBOL) return true;
      return false;
    });

    if (!targetToken?.address) {
      return jsonError(404, {
        error: `Earn token not found for JupUSD vault`,
        code: "EARN_TOKEN_NOT_FOUND",
        details: {
          searchedFor: { assetAddress: JUPUSD_MINT, symbol: TARGET_JL_SYMBOL },
          availableTokens: tokens
            .map((t) => ({
              symbol: t?.symbol,
              assetAddress: t?.assetAddress,
              assetSymbol: t?.asset?.symbol,
            }))
            .slice(0, 20),
        },
      });
    }

    console.log("[PLUS/BALANCE] Found JupUSD vault token:", {
      address: targetToken.address,
      symbol: targetToken.symbol,
      assetAddress: targetToken.assetAddress,
      assetSymbol: targetToken.asset?.symbol,
    });

    // 2) Fetch positions for this user
    const positionsUrl =
      `${JUP_EARN_POSITIONS_URL}?` + new URLSearchParams({ users: owner });

    const posRes = await jupFetch(positionsUrl);
    if (!posRes.ok) {
      return jsonError(posRes.status, {
        error: "Failed to fetch Earn positions",
        code: "JUP_EARN_POSITIONS_FAILED",
        details: { status: posRes.status },
      });
    }

    const positions = (await posRes.json()) as EarnPosition[];

    console.log("[PLUS/BALANCE] User positions:", {
      owner: owner.slice(0, 8) + "...",
      positionCount: positions.length,
      positionTokens: positions.map((p) => ({
        symbol: p?.token?.symbol,
        assetAddress: p?.token?.assetAddress,
        address: p?.token?.address,
      })),
    });

    // Match position by:
    // 1. Earn token address (jlToken address)
    // 2. Or by asset address (underlying JupUSD mint)
    const pos = positions.find((p) => {
      // Match by jlToken address
      if (String(p?.token?.address || "") === String(targetToken.address)) {
        return true;
      }
      // Match by underlying asset address
      if (String(p?.token?.assetAddress || "") === JUPUSD_MINT) {
        return true;
      }
      return false;
    });

    // If user has no position yet, return a clean 0 state
    if (!pos) {
      console.log("[PLUS/BALANCE] No JupUSD position found for user");
      return NextResponse.json({
        owner,
        symbol: targetToken.asset?.symbol || "JupUSD",
        jlSymbol: targetToken.symbol || TARGET_JL_SYMBOL,
        token: targetToken,
        hasPosition: false,
        // Raw
        shares: "0",
        underlyingAssets: "0",
        underlyingBalance: "0",
        allowance: "0",
        // UI
        sharesUi: "0",
        underlyingAssetsUi: "0",
        underlyingBalanceUi: "0",
        allowanceUi: "0",
      });
    }

    const decimals = Number(pos.token?.decimals ?? targetToken.decimals ?? 6);

    console.log("[PLUS/BALANCE] Found JupUSD position:", {
      shares: pos.shares,
      underlyingAssets: pos.underlyingAssets,
      decimals,
    });

    return NextResponse.json({
      owner,
      symbol: pos.token?.asset?.symbol || targetToken.asset?.symbol || "JupUSD",
      jlSymbol: pos.token?.symbol || targetToken.symbol || TARGET_JL_SYMBOL,
      token: pos.token,
      hasPosition: true,

      // Raw (base units as strings)
      shares: pos.shares,
      underlyingAssets: pos.underlyingAssets,
      underlyingBalance: pos.underlyingBalance,
      allowance: pos.allowance,

      // UI (decimal strings)
      sharesUi: baseUnitsToUiString(pos.shares, decimals),
      underlyingAssetsUi: baseUnitsToUiString(pos.underlyingAssets, decimals),
      underlyingBalanceUi: baseUnitsToUiString(pos.underlyingBalance, decimals),
      allowanceUi: baseUnitsToUiString(pos.allowance, decimals),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[PLUS/BALANCE] Error:", msg);
    return jsonError(500, {
      error: "Internal server error",
      code: "UNHANDLED",
      details: msg,
    });
  }
}
