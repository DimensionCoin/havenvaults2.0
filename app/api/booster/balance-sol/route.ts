import { NextRequest, NextResponse } from "next/server";
import { PublicKey, type Commitment } from "@solana/web3.js";
import { RPC_CONNECTION } from "@/types/constants";
import { validateCsrf } from "@/lib/csrf";
import { withApiLogging } from "@/lib/withApiLogging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMITMENT: Commitment = "processed";

async function POSTHandler(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const body = (await req.json().catch(() => ({}))) as { ownerBase58?: string };
  const ownerStr = (body.ownerBase58 || "").trim();
  if (!ownerStr) {
    return NextResponse.json(
      { ok: false, error: "Missing ownerBase58" },
      { status: 400 }
    );
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(ownerStr);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid ownerBase58" },
      { status: 400 }
    );
  }

  const lamports = await RPC_CONNECTION.getBalance(owner, COMMITMENT);
  return NextResponse.json({ ok: true, owner: owner.toBase58(), lamports });
}

export const POST = withApiLogging("/api/booster/balance-sol", POSTHandler);