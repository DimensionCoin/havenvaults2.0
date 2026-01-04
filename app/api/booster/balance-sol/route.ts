import { NextResponse } from "next/server";
import { PublicKey, type Commitment } from "@solana/web3.js";
import { RPC_CONNECTION } from "@/types/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMITMENT: Commitment = "processed";

export async function POST(req: Request) {
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
