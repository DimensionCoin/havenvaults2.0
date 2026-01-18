import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import {
  getUsdcActivityForOwner,
  type ActivityItem,
  type ActivityKind,
} from "@/lib/solanaActivity";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================
   ✅ Rate-limit resilience (Helius)
========================= */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isHelius429(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return (
    /Helius\s*429/i.test(msg) || /rate\s*limit/i.test(msg) || /429/i.test(msg)
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __helius_pace__: { lastAt: number } | undefined;
}

function getPacer() {
  if (!globalThis.__helius_pace__) globalThis.__helius_pace__ = { lastAt: 0 };
  return globalThis.__helius_pace__;
}

async function paceHeliusCalls(minIntervalMs: number) {
  const p = getPacer();
  const now = Date.now();
  const wait = Math.max(0, p.lastAt + minIntervalMs - now);
  if (wait > 0) await sleep(wait);
  p.lastAt = Date.now();
}

async function getActivityWithRetry(
  owner58: string,
  opts: { limit: number; before?: string },
  tag: string
): Promise<ActivityItem[]> {
  // slower per-instance pacing to reduce burst 429s
  const MIN_INTERVAL_MS = 450;

  // backoff settings (you said longer is fine)
  const MAX_ATTEMPTS = 8;
  const BASE_DELAY_MS = 700;
  const MAX_DELAY_MS = 12_000;

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await paceHeliusCalls(MIN_INTERVAL_MS);
      return await getUsdcActivityForOwner(owner58, opts);
    } catch (e) {
      lastErr = e;

      if (!isHelius429(e) || attempt === MAX_ATTEMPTS) break;

      const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 400);
      const waitMs = exp + jitter;

      console.log(`${tag} Helius 429 -> backoff`, {
        attempt,
        waitMs,
        before: opts.before ? shortAddr(opts.before) : null,
        limit: opts.limit,
      });

      await sleep(waitMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || ""));
}

/* =========================
   RESP HELPERS
========================= */

function jerr(status: number, error: string) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function mkReqId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

function shortAddr(a?: string | null) {
  if (!a) return null;
  const s = a.trim();
  return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

function normLower(a?: string | null) {
  return (a || "").trim().toLowerCase();
}

/* =========================
   ✅ Haven user mapping (counterparty labels)
========================= */

type CpMeta = { label: string; avatarUrl: string | null };

async function buildCounterpartyMap(items: ActivityItem[]) {
  // only transfers have counterparties (and we only care about those)
  const cps = Array.from(
    new Set(
      items
        .filter((it) => it.kind === "transfer")
        .map((it) => (it.counterparty || "").trim())
        .filter(Boolean)
    )
  );

  if (!cps.length) return new Map<string, CpMeta>();

  const users = await User.find(
    { $or: [{ walletAddress: { $in: cps } }, { depositWallet: { $in: cps } }] },
    {
      walletAddress: 1,
      depositWallet: 1,
      displayName: 1,
      name: 1,
      email: 1,
      avatarUrl: 1,
      profileImageUrl: 1,
    }
  )
    .lean()
    .limit(500);

  const map = new Map<string, CpMeta>();

  const getStringField = (u: unknown, key: string) => {
    if (!u || typeof u !== "object") return "";
    const v = (u as Record<string, unknown>)[key];
    return typeof v === "string" ? v.trim() : "";
  };

  for (const u of users) {
    const displayName = getStringField(u, "displayName");
    const name = getStringField(u, "name");
    const email = getStringField(u, "email");
    const avatarUrlField = getStringField(u, "avatarUrl");
    const profileImageUrl = getStringField(u, "profileImageUrl");

    const label =
      displayName || name || (email ? email.split("@")[0] : "") || "Haven user";

    const avatarUrl = avatarUrlField || profileImageUrl || null;

    const wa = getStringField(u, "walletAddress") || undefined;
    const dw = getStringField(u, "depositWallet") || undefined;

    if (wa) map.set(normLower(wa), { label, avatarUrl });
    if (dw) map.set(normLower(dw), { label, avatarUrl });
  }

  return map;
}

/* =========================
   MAIN
========================= */

export async function GET(req: NextRequest) {
  const rid = mkReqId();
  const tag = `[wallet/transactions][${rid}]`;

  try {
    const url = new URL(req.url);

    const before = url.searchParams.get("before") || undefined;
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 30), 1),
      100
    );

    // Optional filter:
    //   kind=transfer|swap|plus|perp|all
    const kindParam = (url.searchParams.get("kind") || "all").toLowerCase();
    const wantKind = kindParam === "all" ? "all" : (kindParam as ActivityKind);

    // 1) Auth
    const session = await getSessionFromCookies();
    if (!session) return jerr(401, "Unauthorized");

    // 2) DB + user
    await connect();

    const user = session.userId
      ? await User.findById(session.userId).lean()
      : await User.findOne({ privyId: session.sub }).lean();

    if (!user) return jerr(404, "User not found");

    // 3) Wallet
    const owner58 = (
      (user as { walletAddress?: string }).walletAddress || ""
    ).trim();
    if (!owner58) return jerr(400, "Wallet not found");

    console.log(`${tag} OWNER`, {
      owner58: shortAddr(owner58),
      limit,
      before: before ? shortAddr(before) : null,
      kind: wantKind,
    });

    // 4) Fetch activity (Helius enhanced -> our parser)
    let items: ActivityItem[] = [];
    try {
      items = await getActivityWithRetry(owner58, { limit, before }, tag);
    } catch (e) {
      if (isHelius429(e)) {
        const msg = e instanceof Error ? e.message : String(e || "");
        console.log(`${tag} FAIL (429 after retries)`, { msg });
        return jerr(503, msg);
      }
      throw e;
    }

    // 5) Optional filter by kind (server-side)
    const filtered =
      wantKind === "all" ? items : items.filter((it) => it.kind === wantKind);

    // 6) Counterparty labels for transfers only
    const cpMap = await buildCounterpartyMap(filtered);

    const txs = filtered.slice(0, limit).map((it) => {
      const cp = (it.counterparty || "").trim();
      const cpKey = normLower(cp);
      const mapped = cpKey ? cpMap.get(cpKey) : undefined;

      return {
        signature: it.signature,
        blockTime: it.blockTime ?? null,
        status: "success" as const,

        kind: it.kind,
        direction: it.direction,

        source: it.source ?? null,
        feeLamports: it.feeLamports ?? null,

        // We always store “primary display value” as amountUsdc
        // (even for swaps/perps/plus it is your USDC leg / delta)
        amountUsdc: it.amountUi ?? null,

        // transfer-only fields
        counterparty: it.counterparty ?? null,
        counterpartyOwner: it.counterparty ?? null,
        counterpartyLabel:
          mapped?.label ??
          it.counterpartyLabel ??
          shortAddr(it.counterparty) ??
          null,
        counterpartyAvatarUrl: mapped?.avatarUrl ?? null,

        // swap/plus fields (nullable)
        swapDirection: it.swapDirection ?? null,
        swapSoldMint: it.swapSoldMint ?? null,
        swapSoldAmountUi: it.swapSoldAmountUi ?? null,
        swapBoughtMint: it.swapBoughtMint ?? null,
        swapBoughtAmountUi: it.swapBoughtAmountUi ?? null,
      };
    });

    const nextBefore = txs.length ? txs[txs.length - 1].signature : null;

    console.log(`${tag} RETURN`, {
      txs: txs.length,
      nextBefore: shortAddr(nextBefore),
      kind: wantKind,
    });

    return NextResponse.json(
      { ok: true, txs, nextBefore },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[wallet/transactions][ERROR]`, { msg });
    return jerr(/unauthorized/i.test(msg) ? 401 : 500, msg);
  }
}
