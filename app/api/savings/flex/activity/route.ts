// app/api/savings/flex/activity/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/getServerUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
const HELIUS_TXS_BASE = "https://api.helius.xyz/v0/addresses";

function isLikelyBase58Address(s: string) {
  // lightweight sanity check (don’t overthink)
  const t = s.trim();
  return t.length >= 32 && t.length <= 50;
}

type HeliusTokenTransfer = {
  fromUserAccount?: string | null;
  toUserAccount?: string | null;
  tokenAmount?: number;
  mint?: string;
};

type HeliusTx = {
  signature: string;
  timestamp?: number | null;
  transactionError?: unknown | null;
  tokenTransfers?: HeliusTokenTransfer[];
};

function clamp0(n: number) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseFlexRowFromHeliusTx(tx: HeliusTx, userWallet: string) {
  const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
  const usdc = transfers.filter((t) => t.mint === USDC_MINT);

  if (usdc.length === 0) return null;

  const depositCandidates = usdc
    .filter((t) => t.fromUserAccount === userWallet)
    .map((t) => Number(t.tokenAmount))
    .filter((n) => Number.isFinite(n) && n > 0);

  const withdrawCandidates = usdc
    .filter((t) => t.toUserAccount === userWallet)
    .map((t) => Number(t.tokenAmount))
    .filter((n) => Number.isFinite(n) && n > 0);

  const depositAmt = depositCandidates.length
    ? Math.max(...depositCandidates)
    : 0;
  const withdrawAmt = withdrawCandidates.length
    ? Math.max(...withdrawCandidates)
    : 0;

  const blockTime = typeof tx.timestamp === "number" ? tx.timestamp : null;
  const status = tx.transactionError
    ? ("failed" as const)
    : ("success" as const);

  // Prefer the largest inbound transfer to user as withdraw (ignores tiny fee transfer)
  if (withdrawAmt > 0 && withdrawAmt >= depositAmt) {
    return {
      id: tx.signature,
      signature: tx.signature,
      direction: "withdraw" as const,
      amountUsdc: clamp0(withdrawAmt),
      blockTime,
      status,
    };
  }

  if (depositAmt > 0) {
    return {
      id: tx.signature,
      signature: tx.signature,
      direction: "deposit" as const,
      amountUsdc: clamp0(depositAmt),
      blockTime,
      status,
    };
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser();
    if (!user?._id) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    if (!HELIUS_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing HELIUS_API_KEY" },
        { status: 500 }
      );
    }

    const userWallet = String(user.walletAddress || "").trim();
    if (!userWallet) {
      return NextResponse.json(
        { ok: false, error: "Missing user walletAddress" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const accountParam = String(searchParams.get("account") || "").trim(); // ✅ from client
    const storedAccount = String(
      user?.savingsFlex?.marginfiAccountPk || ""
    ).trim(); // optional

    const marginfiAccountPk = storedAccount || accountParam;
    if (!marginfiAccountPk) {
      return NextResponse.json(
        { ok: false, error: "Missing marginfiAccountPk" },
        { status: 400 }
      );
    }

    // Optional: if you DO have a stored account, enforce match
    if (storedAccount && accountParam && storedAccount !== accountParam) {
      return NextResponse.json(
        { ok: false, error: "Account mismatch" },
        { status: 403 }
      );
    }

    if (!isLikelyBase58Address(marginfiAccountPk)) {
      return NextResponse.json(
        { ok: false, error: "Invalid account" },
        { status: 400 }
      );
    }

    const limitRaw = Number(searchParams.get("limit") ?? "30");
    const limit = Math.max(1, Math.min(limitRaw, 100));
    const cursor = String(searchParams.get("cursor") || "").trim(); // signature (helius before)

    const beforeParam = cursor ? `&before=${encodeURIComponent(cursor)}` : "";
    const url = `${HELIUS_TXS_BASE}/${encodeURIComponent(
      marginfiAccountPk
    )}/transactions?api-key=${encodeURIComponent(
      HELIUS_API_KEY
    )}&limit=${limit + 1}${beforeParam}`;

    const r = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Helius error (${r.status}): ${text || "Failed"}` },
        { status: 502 }
      );
    }

    const raw = (await r.json().catch(() => null)) as unknown;
    const txList = Array.isArray(raw) ? (raw as HeliusTx[]) : [];

    const parsed = txList
      .map((tx) => parseFlexRowFromHeliusTx(tx, userWallet))
      .filter(Boolean) as Array<{
      id: string;
      signature: string;
      direction: "deposit" | "withdraw";
      amountUsdc: number;
      blockTime: number | null;
      status: "success" | "failed";
    }>;

    parsed.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

    const hasMore = txList.length > limit;
    const page = parsed.slice(0, limit);
    const nextCursor = hasMore ? (txList[limit]?.signature ?? null) : null;

    return NextResponse.json({
      ok: true,
      txs: page,
      nextCursor,
      exhausted: !hasMore,
    });
  } catch (err) {
    console.error("Flex activity (onchain) error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load activity" },
      { status: 500 }
    );
  }
}
