// lib/fees.ts
import "server-only";

import mongoose from "mongoose";
import User from "@/models/User";
import { FeeEvent } from "@/models/FeeEvent";
import { connect as connectMongo } from "@/lib/db";

const D128 = mongoose.Types.Decimal128;

function clampDecimals(decimals: number) {
  const d = Number.isFinite(decimals) ? Math.floor(decimals) : 0;
  return Math.max(0, Math.min(18, d));
}

function normalizeMint(mint: string): string {
  return String(mint || "").trim();
}

function normalizeSymbol(symbol?: string | null): string | undefined {
  const s = typeof symbol === "string" ? symbol.trim() : "";
  return s ? s : undefined;
}

function toD128FromUi(
  amountUi: number,
  decimals: number,
): mongoose.Types.Decimal128 {
  const d = clampDecimals(decimals);
  const a = Number.isFinite(amountUi) ? Math.max(0, amountUi) : 0;
  return D128.fromString(a.toFixed(d));
}

function uiToBaseUnits(amountUi: number, decimals: number): string {
  const d = clampDecimals(decimals);
  const a = Number(amountUi);
  if (!Number.isFinite(a) || a <= 0) return "0";

  const fixed = a.toFixed(d);
  const [wholeStr, fracStr = ""] = fixed.split(".");
  const whole = BigInt(wholeStr || "0");
  const frac = BigInt((fracStr + "0".repeat(d)).slice(0, d) || "0");

  const base = whole * BigInt("10") ** BigInt(String(d)) + frac;
  return base.toString();
}

function addBase(a: string, b: string): string {
  const x = BigInt(a || "0");
  const y = BigInt(b || "0");
  return (x + y).toString();
}

export type FeeToken = {
  mint: string;
  amountUi: number;
  decimals: number;
  symbol?: string;
};

type RecordResult =
  | { ok: true; recorded: true }
  | { ok: true; recorded: false; reason: "duplicate" | "zero" };

type FeesPaidTotalsEntry = {
  amountBase?: string;
  decimals?: number;
  symbol?: string;
};

type FeesPaidTotalsMap = Record<string, FeesPaidTotalsEntry>;

type UserFeesLean = {
  feesPaidTotals?: FeesPaidTotalsMap;
} | null;

export async function recordUserFees(params: {
  userId: mongoose.Types.ObjectId;
  signature: string;
  kind: string;
  tokens: FeeToken[];
}): Promise<RecordResult> {
  await connectMongo(); // ✅ guarantee DB connection (even if caller forgot)

  const userId = params.userId;
  const signature = String(params.signature || "").trim();
  const kind = String(params.kind || "").trim();

  if (!signature) throw new Error("recordUserFees: signature required");
  if (!userId) throw new Error("recordUserFees: userId required");
  if (!kind) throw new Error("recordUserFees: kind required");

  const tokensRaw = Array.isArray(params.tokens) ? params.tokens : [];

  // Merge duplicates by mint
  const merged = new Map<
    string,
    {
      mint: string;
      decimals: number;
      symbol?: string;
      amountUi: number;
      amountBase: string;
    }
  >();

  for (const t of tokensRaw) {
    const mint = normalizeMint(t?.mint);
    if (!mint) continue;

    const decimals = clampDecimals(Number(t?.decimals));
    const amountUi = Number(t?.amountUi);
    if (!Number.isFinite(amountUi) || amountUi <= 0) continue;

    const symbol = normalizeSymbol(t?.symbol);
    const amountBase = uiToBaseUnits(amountUi, decimals);
    if (amountBase === "0") continue;

    const prev = merged.get(mint);
    if (!prev) {
      merged.set(mint, { mint, decimals, symbol, amountUi, amountBase });
    } else {
      merged.set(mint, {
        mint,
        decimals: prev.decimals || decimals,
        symbol: prev.symbol ?? symbol,
        amountUi: prev.amountUi + amountUi,
        amountBase: addBase(prev.amountBase, amountBase),
      });
    }
  }

  const tokens = Array.from(merged.values());
  if (tokens.length === 0) return { ok: true, recorded: false, reason: "zero" };

  // ✅ Atomic idempotent write: (signature + kind)
  const up = await FeeEvent.updateOne(
    { signature, kind },
    {
      $setOnInsert: {
        userId,
        signature,
        kind,
        tokens: tokens.map((t) => ({
          mint: t.mint,
          symbol: t.symbol,
          decimals: t.decimals,
          amountUi: toD128FromUi(t.amountUi, t.decimals),
        })),
      },
    },
    { upsert: true },
  );

  const inserted = (up.upsertedCount ?? 0) === 1;
  if (!inserted) {
    // already recorded for this signature+kind
    return { ok: true, recorded: false, reason: "duplicate" };
  }

  // ✅ Only now update aggregates (no double-counting)
  const userLean = (await User.findById(userId)
    .select({ feesPaidTotals: 1 })
    .lean()) as UserFeesLean;

  if (!userLean) return { ok: true, recorded: true };

  const existing: FeesPaidTotalsMap =
    userLean.feesPaidTotals && typeof userLean.feesPaidTotals === "object"
      ? userLean.feesPaidTotals
      : {};

  const $set: Record<string, string | number> = {};

  for (const t of tokens) {
    const cur: FeesPaidTotalsEntry = existing[t.mint] || {};
    const curBase = typeof cur.amountBase === "string" ? cur.amountBase : "0";
    const nextBase = addBase(curBase, t.amountBase);

    $set[`feesPaidTotals.${t.mint}.amountBase`] = nextBase;
    $set[`feesPaidTotals.${t.mint}.decimals`] =
      Number.isFinite(cur.decimals) && (cur.decimals as number) > 0
        ? (cur.decimals as number)
        : t.decimals;

    if (t.symbol && !cur.symbol) {
      $set[`feesPaidTotals.${t.mint}.symbol`] = t.symbol;
    }
  }

  if (Object.keys($set).length) {
    await User.updateOne({ _id: userId }, { $set });
  }

  return { ok: true, recorded: true };
}
