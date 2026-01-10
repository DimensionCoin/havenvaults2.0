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

/**
 * IMPORTANT:
 * This does NOT prove mint vs ATA, but it helps catch obvious bad values.
 * Real mint addresses are base58 strings too, same length as ATAs.
 * The only real proof is: does it match a known mint list (tokenConfig) OR on-chain lookup.
 */
function looksLikeBase58(s?: string | null) {
  if (!s) return false;
  const v = s.trim();
  // base58 charset excludes 0 O I l
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(v) && v.length >= 32 && v.length <= 50;
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
    const debug = url.searchParams.get("debug") === "1";

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

    // 3) Wallet
    const owner58 = (user.walletAddress || "").trim();
    if (!owner58) return jerr(400, "Wallet not found");

    console.log(`${tag} OWNER`, {
      owner58: shortAddr(owner58),
      limit,
      before: before ? shortAddr(before) : null,
      debug,
    });

    // 4) Fetch activity (RAW)
    const items: ActivityItem[] = await getUsdcActivityForOwner(owner58, {
      limit,
      before,
    });

    console.log(`${tag} RAW ITEMS COUNT`, items.length);

    // 5) Log a *useful sample* (this is what you’re missing right now)
    const sample = items.slice(0, 12).map((it) => ({
      sig: shortAddr(it.signature),
      kind: it.kind,
      dir: it.direction,
      src: it.source ?? null,
      amountUi: typeof it.amountUi === "number" ? it.amountUi : null,

      // swap fields (the critical ones)
      swapSoldMint: it.swapSoldMint ?? null,
      swapBoughtMint: it.swapBoughtMint ?? null,
      swapSoldAmountUi:
        typeof it.swapSoldAmountUi === "number" ? it.swapSoldAmountUi : null,
      swapBoughtAmountUi:
        typeof it.swapBoughtAmountUi === "number"
          ? it.swapBoughtAmountUi
          : null,

      // transfer fields
      counterparty: it.counterparty ? shortAddr(it.counterparty) : null,
    }));

    console.log(`${tag} SAMPLE`, sample);

    // Optional deeper debug: print ONLY swaps, full mints (not shortened)
    if (debug) {
      const swapDump = items
        .filter((x) => x.kind === "swap")
        .slice(0, 20)
        .map((x) => ({
          signature: x.signature,
          source: x.source ?? null,
          swapSoldMint: x.swapSoldMint ?? null,
          swapBoughtMint: x.swapBoughtMint ?? null,
          soldLooksBase58: looksLikeBase58(x.swapSoldMint ?? null),
          boughtLooksBase58: looksLikeBase58(x.swapBoughtMint ?? null),
          swapSoldAmountUi: x.swapSoldAmountUi ?? null,
          swapBoughtAmountUi: x.swapBoughtAmountUi ?? null,
        }));

      console.log(`${tag} SWAPS DEBUG`, swapDump);
    }

    // 6) Enrich transfer counterparties (Haven users)
    const transferAddrs = Array.from(
      new Set(
        items
          .filter((i) => i.kind === "transfer")
          .map((i) => (i.counterparty || "").trim())
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
        const addr = (m.walletAddress || "").trim();
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

    const enriched: ActivityItem[] = items.map((it) => {
      if (it.kind !== "transfer") return it;
      const cp = (it.counterparty || "").trim();
      return {
        ...it,
        counterpartyLabel: cp ? labelByAddr.get(cp) || shortAddr(cp) : null,
      };
    });

    // 7) Return EVERYTHING (ground zero)
    const txs = enriched.map((it) => ({
      signature: it.signature,
      blockTime: it.blockTime ?? null,
      status: "success" as const,

      kind: it.kind,
      direction: it.direction,
      source: it.source ?? null,

      // USDC amount for transfers (and sometimes swaps depending on your parser)
      amountUsdc: it.amountUi ?? null,

      // counterparty
      counterparty: it.counterparty ?? null,
      counterpartyLabel: it.counterpartyLabel ?? null,

      // swap details (frontend will map mint -> tokenConfig)
      swapSoldMint: it.swapSoldMint ?? null,
      swapSoldAmountUi: it.swapSoldAmountUi ?? null,
      swapBoughtMint: it.swapBoughtMint ?? null,
      swapBoughtAmountUi: it.swapBoughtAmountUi ?? null,
    }));

    const nextBefore = txs.length ? txs[txs.length - 1].signature : null;

    console.log(`${tag} RETURN`, {
      txs: txs.length,
      nextBefore: shortAddr(nextBefore),
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
