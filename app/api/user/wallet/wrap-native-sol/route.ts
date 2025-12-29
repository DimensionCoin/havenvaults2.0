// app/api/user/wallet/wrap-native-sol/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import { SOLANA_RPC_URL } from "@/lib/solanaConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LAMPORTS_PER_SOL = 1_000_000_000;

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      owner?: string;
    };

    const ownerStr = body.owner;
    if (!ownerStr) {
      return NextResponse.json(
        { ok: false, error: "Missing owner" },
        { status: 400 }
      );
    }

    let owner: PublicKey;
    try {
      owner = new PublicKey(ownerStr);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid owner pubkey" },
        { status: 400 }
      );
    }

    // 1) Native SOL balance
    const balanceLamports = await connection.getBalance(owner, "confirmed");
    console.log(
      "[wrap-native-sol] native balance (lamports):",
      balanceLamports
    );

    // If balance is tiny, don't even try
    const MIN_WRAP_LAMPORTS = 0.001 * LAMPORTS_PER_SOL; // 0.001 SOL
    if (balanceLamports <= MIN_WRAP_LAMPORTS) {
      return NextResponse.json(
        {
          ok: false,
          reason: "insufficient_native",
          nativeLamports: balanceLamports,
        },
        { status: 200 }
      );
    }

    // 2) Figure out if we need to create the WSOL ATA and what rent will cost
    const wsolMint = NATIVE_MINT; // WSOL = wrapped SOL
    const ata = await getAssociatedTokenAddress(wsolMint, owner, false);
    const ataInfo = await connection.getAccountInfo(ata, "confirmed");

    let rentLamports = 0;
    if (!ataInfo) {
      // Rent-exempt balance for a token account (165 bytes)
      rentLamports = await connection.getMinimumBalanceForRentExemption(165);
    }

    // Small fee buffer so the tx doesn't fail
    const FEE_BUFFER_LAMPORTS = 0.0005 * LAMPORTS_PER_SOL; // ~0.0005 SOL

    // We must leave enough lamports to:
    // - pay rent for the WSOL ATA (if needed)
    // - pay tx fees
    const totalReserve = rentLamports + FEE_BUFFER_LAMPORTS;

    const maxWrapLamports = balanceLamports - totalReserve;

    if (maxWrapLamports <= 0 || maxWrapLamports < MIN_WRAP_LAMPORTS) {
      // Not enough SOL to safely wrap after fees & rent
      return NextResponse.json(
        {
          ok: false,
          reason: "insufficient_native",
          nativeLamports: balanceLamports,
          totalReserve,
        },
        { status: 200 }
      );
    }

    const wrapLamports = Math.floor(maxWrapLamports);

    console.log("[wrap-native-sol] wrapLamports:", {
      balanceLamports,
      rentLamports,
      FEE_BUFFER_LAMPORTS,
      wrapLamports,
    });

    const instructions = [];

    // 3) If no WSOL ATA, create it — user pays rent
    if (!ataInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          owner, // payer (user pays rent)
          ata, // ATA
          owner, // ATA owner
          wsolMint,
          TOKEN_PROGRAM_ID
        )
      );
    }

    // 4) Transfer SOL → WSOL ATA + sync native
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: ata,
        lamports: wrapLamports,
      }),
      createSyncNativeInstruction(ata)
    );

    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    // User is fee payer
    const tx = new Transaction({
      feePayer: owner,
      recentBlockhash: blockhash,
    }).add(...instructions);

    // ❌ DO NOT SIGN HERE – we don’t have the user’s key.
    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const txBase64 = Buffer.from(serialized).toString("base64");

    return NextResponse.json({
      ok: true,
      txBase64,
      wrapLamports,
      wrapSol: wrapLamports / LAMPORTS_PER_SOL,
    });
  } catch (err) {
    console.error("[wrap-native-sol] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to build wrap transaction" },
      { status: 500 }
    );
  }
}
