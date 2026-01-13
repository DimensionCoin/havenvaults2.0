import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import {
  getUsdcActivityForOwner,
  type ActivityItem,
} from "@/lib/solanaActivity";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flex savings vault address (MarginFi pool)
const FLEX_SAVINGS_ADDR = "3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG";

/* =========================
   ✅ Rate-limit resilience
   - exponential backoff + jitter on 429
   - soft per-instance pacing between Helius calls
========================= */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isHelius429(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /Helius\s*429/i.test(msg) || /rate\s*limited/i.test(msg);
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

async function getUsdcActivityWithRetry(
  owner58: string,
  opts: { limit: number; before?: string },
  tag: string
): Promise<ActivityItem[]> {
  // Make calls slower to reduce 429s (per instance)
  const MIN_INTERVAL_MS = 500;

  // Backoff settings (you said longer is fine)
  const MAX_ATTEMPTS = 8;
  const BASE_DELAY_MS = 700; // exponential base
  const MAX_DELAY_MS = 12_000;

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await paceHeliusCalls(MIN_INTERVAL_MS);
      const items = await getUsdcActivityForOwner(owner58, opts);
      return items;
    } catch (e) {
      lastErr = e;

      if (!isHelius429(e) || attempt === MAX_ATTEMPTS) {
        break;
      }

      // exponential backoff + jitter
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

/* =========================
   ✅ Haven user mapping helpers
========================= */

function normLower(a?: string | null) {
  return (a || "").trim().toLowerCase();
}

type CpMeta = { label: string; avatarUrl: string | null };

async function buildCounterpartyMap(items: ActivityItem[]) {
  // only transfers have counterparties
  const cps = Array.from(
    new Set(
      items
        .filter((it) => it.kind === "transfer")
        .map((it) => (it.counterparty || "").trim())
        .filter(Boolean)
    )
  );

  if (!cps.length) return new Map<string, CpMeta>();

  // Lookup any users that match these wallets.
  // NOTE: This supports both walletAddress and depositWallet if your schema has it.
  // If your schema doesn't have depositWallet, Mongo will just ignore that field.
  const users = await User.find(
    {
      $or: [{ walletAddress: { $in: cps } }, { depositWallet: { $in: cps } }],
    },
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

    // Mode and involve params for Flex filtering
    const mode = url.searchParams.get("mode") || "all";
    const involve = url.searchParams.get("involve") || "";

    // 1) Auth
    const session = await getSessionFromCookies();
    if (!session) return jerr(401, "Unauthorized");

    await connect();

    // 2) User
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
      mode,
      involve: involve ? shortAddr(involve) : null,
    });

    // 4) For flex mode, we need to keep paginating until we find enough results
    if (mode === "flex") {
      const flexAddresses = new Set<string>();
      flexAddresses.add(FLEX_SAVINGS_ADDR.toLowerCase());
      if (involve) flexAddresses.add(involve.toLowerCase());

      const filtered: ActivityItem[] = [];
      let cursor = before;
      let totalFetched = 0;
      const MAX_PAGES = 10; // Safety limit
      let pagesSearched = 0;
      let exhausted = false;

      // If we repeatedly rate-limit mid-loop, we return what we have
      // and mark exhausted=true so the frontend stops paging for now.
      let bailedOnRateLimit = false;

      while (filtered.length < limit && pagesSearched < MAX_PAGES) {
        pagesSearched++;

        let items: ActivityItem[] = [];
        try {
          items = await getUsdcActivityWithRetry(
            owner58,
            { limit: 100, before: cursor },
            tag
          );
        } catch (e) {
          if (isHelius429(e)) {
            console.log(`${tag} FLEX BAIL (429 after retries)`, {
              pagesSearched,
              cursor: cursor ? shortAddr(cursor) : null,
            });
            bailedOnRateLimit = true;
            exhausted = true;
            break;
          }
          throw e;
        }

        console.log(`${tag} FLEX PAGE ${pagesSearched}`, {
          fetched: items.length,
          cursor: cursor ? shortAddr(cursor) : null,
        });

        if (items.length === 0) {
          exhausted = true;
          break;
        }

        totalFetched += items.length;

        // Filter for flex transactions
        for (const it of items) {
          if (it.kind !== "transfer") continue;

          const cp = (it.counterparty || "").trim().toLowerCase();
          let isFlexTx = cp && flexAddresses.has(cp);

          if (!isFlexTx && it.involvedAccounts) {
            for (const acc of it.involvedAccounts) {
              if (flexAddresses.has(acc.toLowerCase())) {
                isFlexTx = true;
                break;
              }
            }
          }

          if (isFlexTx) {
            filtered.push(it);
            if (filtered.length >= limit) break;
          }
        }

        // Update cursor to last item's signature for next page
        const lastItem = items[items.length - 1];
        if (lastItem?.signature) {
          cursor = lastItem.signature;
        } else {
          exhausted = true;
          break;
        }

        // Small additional delay between pages (you said slower is fine)
        // Helps reduce bursty paging that triggers 429s.
        await sleep(350);
      }

      console.log(`${tag} FLEX RESULT`, {
        pagesSearched,
        totalFetched,
        filtered: filtered.length,
        exhausted,
        bailedOnRateLimit,
      });

      // ✅ Build Haven user map for counterparties in this response
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
          swapDirection: it.swapDirection ?? null,
          source: it.source ?? null,
          amountUsdc: it.amountUi ?? null,

          // ✅ counterparty remains the same (owner wallet)
          counterparty: it.counterparty ?? null,

          // ✅ Add owner field for the frontend to prefer
          counterpartyOwner: it.counterparty ?? null,

          // ✅ Prefer mapped Haven label + avatar, fallback to existing label/short
          counterpartyLabel:
            mapped?.label ??
            it.counterpartyLabel ??
            shortAddr(it.counterparty) ??
            null,
          counterpartyAvatarUrl: mapped?.avatarUrl ?? null,

          swapSoldMint: it.swapSoldMint ?? null,
          swapSoldAmountUi: it.swapSoldAmountUi ?? null,
          swapBoughtMint: it.swapBoughtMint ?? null,
          swapBoughtAmountUi: it.swapBoughtAmountUi ?? null,
        };
      });

      // nextBefore should be the cursor we stopped at (for loading more)
      // Only null if we truly exhausted all transactions
      const nextBefore = exhausted ? null : (cursor ?? null);

      console.log(`${tag} RETURN`, {
        txs: txs.length,
        nextBefore: nextBefore ? shortAddr(nextBefore) : null,
        exhausted,
      });

      return NextResponse.json(
        { ok: true, txs, nextBefore, exhausted },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 5) Normal mode (non-flex) - original logic (now with retry/backoff)
    let items: ActivityItem[] = [];
    try {
      items = await getUsdcActivityWithRetry(owner58, { limit, before }, tag);
    } catch (e) {
      if (isHelius429(e)) {
        // If we can't fetch at all after retries, surface as 503 instead of 500.
        const msg = e instanceof Error ? e.message : String(e || "");
        console.log(`${tag} NON-FLEX FAIL (429 after retries)`, { msg });
        return jerr(503, msg);
      }
      throw e;
    }

    console.log(`${tag} RAW ITEMS COUNT`, items.length);

    // ✅ Build Haven user map for counterparties in this response
    const cpMap = await buildCounterpartyMap(items);

    const txs = items.slice(0, limit).map((it) => {
      const cp = (it.counterparty || "").trim();
      const cpKey = normLower(cp);
      const mapped = cpKey ? cpMap.get(cpKey) : undefined;

      return {
        signature: it.signature,
        blockTime: it.blockTime ?? null,
        status: "success" as const,
        kind: it.kind,
        direction: it.direction,
        swapDirection: it.swapDirection ?? null,
        source: it.source ?? null,
        amountUsdc: it.amountUi ?? null,

        counterparty: it.counterparty ?? null,

        // ✅ Add owner field for the frontend to prefer
        counterpartyOwner: it.counterparty ?? null,

        counterpartyLabel:
          mapped?.label ??
          it.counterpartyLabel ??
          shortAddr(it.counterparty) ??
          null,
        counterpartyAvatarUrl: mapped?.avatarUrl ?? null,

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
      mode,
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
