import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";
import {
  getUsdcActivityForOwner,
  getUsdcActivityForOwnerInvolving,
  isTxInvolvingAccount,
  type ActivityItem,
} from "@/lib/solanaActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Query params:
 *  - limit: number (default 30, max 200 for the API response)
 *  - before: string (cursor from previous response)
 *  - mode:
 *      - "all" (default): returns swaps + transfers (existing behavior)
 *      - "flex": returns ONLY transfers involving FLEX_SAVINGS_ADDR (NEW behavior, reliable)
 *  - debug=1: extra logs
 */

const FLEX_SAVINGS_ADDR = "3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG";

// ---- response types ----
type TxRow = {
  signature: string;
  blockTime: number | null;
  status: "success" | "failed";

  kind: "transfer" | "swap";
  direction: "in" | "out";
  source: string | null;

  // absolute USDC amount in UI units
  amountUsdc: number | null;

  // network fee (SOL) in lamports
  feeLamports: number | null;

  // transfers only (FULL addresses)
  counterparty: string | null;
  counterpartyLabel: string | null;

  // swaps only
  swapSoldMint: string | null;
  swapSoldAmountUi: number | null;
  swapBoughtMint: string | null;
  swapBoughtAmountUi: number | null;
};

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

const normAddr = (v?: string | null) => (v || "").trim();

export async function GET(req: NextRequest) {
  const rid = mkReqId();
  const tag = `[wallet/transactions][${rid}]`;

  try {
    const url = new URL(req.url);

    const before = url.searchParams.get("before") || undefined;
    const debug = url.searchParams.get("debug") === "1";

    const mode = (url.searchParams.get("mode") || "all").toLowerCase();
    const wantFlexOnly = mode === "flex";

    // response size (what you send to client)
    const outLimit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 30), 1),
      200
    );

    // ✅ internal page size for helius calls
    const pageSize = 100;

    // ✅ safety caps (only used by "all" mode)
    const maxPagesAll = 8;
    const maxRawItemsAll = 900;

    // 1) Auth
    const session = await getSessionFromCookies();
    if (!session) return jerr(401, "Unauthorized");

    await connect();

    // 2) User
    const user = (
      session.userId
        ? await User.findById(session.userId).lean()
        : await User.findOne({ privyId: session.sub }).lean()
    ) as { walletAddress?: string | null } | null;

    if (!user) return jerr(404, "User not found");

    const owner58 = normAddr(user.walletAddress);
    if (!owner58) return jerr(400, "Wallet not found");

    console.log(`${tag} OWNER`, {
      owner58: shortAddr(owner58),
      outLimit,
      before: before ? shortAddr(before) : null,
      mode,
      debug,
    });

    /**
     * 3) Fetch activity
     *
     * - "all" mode: keep your existing behavior exactly
     * - "flex" mode: use the new server-side filter that looks at accountKeys
     *   so we DON'T have to scan forever and we don't rely on counterparty matching.
     */
    let collected: ActivityItem[] = [];
    let cursor: string | null = null;
    let pages = 0;

    if (wantFlexOnly) {
      // ✅ NEW reliable path for Flex:
      // Find txs involving the flex vault address by looking at message account keys.
      const want = outLimit; // how many matching flex txs we want to return
      const maxPages = 60; // allow deeper scan because flex txs can be sparse

      const res = await getUsdcActivityForOwnerInvolving(
        owner58,
        FLEX_SAVINGS_ADDR,
        {
          want,
          before,
          maxPages,
          pageSize,
        }
      );

      collected = res.items;
      cursor = res.nextBefore;
      pages = -1; // means "handled by involving() helper"

      if (debug) {
        console.log(`${tag} FLEX_MATCHED`, {
          matched: collected.length,
          nextCursor: cursor ? shortAddr(cursor) : null,
        });
      }
    } else {
      // ✅ EXISTING behavior for all pages:
      collected = [];
      cursor = before ?? null;
      pages = 0;

      while (pages < maxPagesAll && collected.length < maxRawItemsAll) {
        pages += 1;

        const page = await getUsdcActivityForOwner(owner58, {
          limit: pageSize,
          before: cursor ?? undefined,
        });

        if (!page.length) break;

        collected.push(...page);

        // next cursor is last signature of page
        cursor = page[page.length - 1]?.signature || cursor;

        if (page.length < pageSize) break;

        if (collected.length >= outLimit) break;
      }

      if (debug) {
        console.log(`${tag} RAW COLLECTED`, {
          pages,
          total: collected.length,
          nextCursor: cursor ? shortAddr(cursor) : null,
        });

        const sample = collected.slice(0, 12).map((it) => ({
          sig: shortAddr(it.signature),
          kind: it.kind,
          dir: it.direction,
          src: it.source ?? null,
          amountUi: typeof it.amountUi === "number" ? it.amountUi : null,
          counterparty: it.counterparty ? shortAddr(it.counterparty) : null,
          // ✅ show whether tx includes the flex address in account keys (debug only)
          hasFlex: isTxInvolvingAccount(it, FLEX_SAVINGS_ADDR),
        }));

        console.log(`${tag} SAMPLE`, sample);
      }
    }

    /**
     * 4) Filter for flex mode
     *
     * IMPORTANT: In flex mode, `collected` is already matched to the flex address,
     * but we also ensure we return transfers only for the UI.
     */
    const filtered = wantFlexOnly
      ? collected.filter((it) => it.kind === "transfer" && it.amountUi > 0)
      : collected;

    // 5) Enrich transfer counterparties with Haven user labels (unchanged)
    const transferAddrs = Array.from(
      new Set(
        filtered
          .filter((i) => i.kind === "transfer")
          .map((i) => normAddr(i.counterparty))
          .filter(Boolean)
          .filter((a) => a !== owner58)
      )
    );

    const labelByAddr = new Map<string, string>();

    if (transferAddrs.length) {
      const matches = await User.find(
        { walletAddress: { $in: transferAddrs } },
        { walletAddress: 1, fullName: 1, firstName: 1, lastName: 1, email: 1 }
      ).lean<
        {
          walletAddress?: string | null;
          fullName?: string | null;
          firstName?: string | null;
          lastName?: string | null;
          email?: string | null;
        }[]
      >();

      for (const m of matches) {
        const addr = normAddr(m.walletAddress);
        if (!addr) continue;

        const name =
          (m.fullName && m.fullName.trim()) ||
          [m.firstName, m.lastName].filter(Boolean).join(" ").trim() ||
          null;

        const label =
          (name && name.trim()) ||
          (m.email && m.email.trim()) ||
          shortAddr(addr) ||
          addr;

        labelByAddr.set(addr, label);
      }
    }

    // 6) Map -> client rows (NO shortening) (unchanged)
    const txsAll: TxRow[] = filtered.map((it) => {
      const cp = normAddr(it.counterparty) || null;

      return {
        signature: it.signature,
        blockTime: it.blockTime ?? null,
        status: "success",

        kind: it.kind,
        direction: it.direction,
        source: it.source ?? null,

        amountUsdc: typeof it.amountUi === "number" ? it.amountUi : null,
        feeLamports: typeof it.feeLamports === "number" ? it.feeLamports : null,

        counterparty: it.kind === "transfer" ? cp : null,
        counterpartyLabel:
          it.kind === "transfer"
            ? cp
              ? labelByAddr.get(cp) || null
              : null
            : null,

        swapSoldMint: it.swapSoldMint ?? null,
        swapSoldAmountUi:
          typeof it.swapSoldAmountUi === "number" ? it.swapSoldAmountUi : null,
        swapBoughtMint: it.swapBoughtMint ?? null,
        swapBoughtAmountUi:
          typeof it.swapBoughtAmountUi === "number"
            ? it.swapBoughtAmountUi
            : null,
      };
    });

    // 7) Sort (newest first)
    txsAll.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

    // 8) Slice response limit
    const txs = txsAll.slice(0, outLimit);

    /**
     * 9) Cursor for next page
     * - all mode: cursor is the last signature from raw pages
     * - flex mode: cursor comes from getUsdcActivityForOwnerInvolving()
     */
    const nextBefore =
      typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;

    console.log(`${tag} RETURN`, {
      txs: txs.length,
      wantFlexOnly,
      nextBefore: nextBefore ? shortAddr(nextBefore) : null,
      pages,
      collected: collected.length,
      filtered: filtered.length,
    });

    return NextResponse.json(
      { ok: true, txs, nextBefore },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[wallet/transactions][ERROR]`, { msg });
    return jerr(/unauthorized/i.test(msg) ? 401 : 500, msg);
  }
}
