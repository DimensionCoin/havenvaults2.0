// app/api/jup/send/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendTransactionError,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── ENV ───────── */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_APP_SECRET");
const PRIVY_AUTH_PK = required("PRIVY_AUTH_PRIVATE_KEY_B64");
const HAVEN_WALLET_ID = required("HAVEN_AUTH_ADDRESS_ID");
const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);

// Connection singleton
let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(SOLANA_RPC, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 30_000,
    });
  }
  return _conn;
}

// Privy client singleton
let _privy: PrivyClient | null = null;
function getPrivyClient(): PrivyClient {
  if (!_privy) {
    _privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });
  }
  return _privy;
}

/* ───────── HELPERS ───────── */

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ error, ...(extra || {}) }, { status });
}

function toSignedBytes(resp: unknown): Uint8Array {
  const asObj = resp as Record<string, unknown> | null;
  const payload =
    asObj && "signedTransaction" in asObj ? asObj.signedTransaction : resp;

  if (typeof payload === "string") {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  if (payload instanceof Uint8Array) return payload;
  if (Array.isArray(payload) && payload.every((n) => typeof n === "number")) {
    return new Uint8Array(payload);
  }
  if (payload && typeof payload === "object" && "serialize" in payload) {
    return new Uint8Array(
      (payload as { serialize: () => Uint8Array }).serialize()
    );
  }
  throw new Error("Unexpected signTransaction return type");
}

/* ───────── ROUTE ───────── */

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Auth check
    const session = await getSessionFromCookies();
    if (!session?.userId) {
      return jsonError(401, "Unauthorized");
    }

    // Parse body
    const body = (await req.json().catch(() => null)) as {
      transaction?: string;
    } | null;
    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, "Missing 'transaction' in body");
    }

    // Deserialize
    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length) {
      return jsonError(400, "Invalid transaction encoding");
    }

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, "Invalid VersionedTransaction");
    }

    // Validate fee payer
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, "Invalid fee payer", { code: "INVALID_FEE_PAYER" });
    }

    // Validate blockhash
    const blockhash = userSignedTx.message.recentBlockhash;
    if (!blockhash || blockhash === "11111111111111111111111111111111") {
      return jsonError(400, "Invalid blockhash", { code: "INVALID_BLOCKHASH" });
    }

    const conn = getConnection();
    const privy = getPrivyClient();

    // Co-sign with Haven fee payer
    let coSignedBytes: Uint8Array;
    try {
      const resp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[JUP/SEND] Privy sign failed:", msg);

      if (msg.toLowerCase().includes("invalid wallet id")) {
        return jsonError(500, "Invalid Haven wallet configuration", {
          code: "INVALID_HAVEN_WALLET_ID",
        });
      }
      return jsonError(500, "Signing failed", {
        code: "PRIVY_SIGN_FAILED",
        details: msg,
      });
    }

    // Send transaction
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: false,
        maxRetries: 2,
        preflightCommitment: "confirmed",
      });
    } catch (err) {
      const ste = err as SendTransactionError;
      let logs: string[] = [];

      if (typeof ste?.getLogs === "function") {
        logs = await ste.getLogs(conn).catch(() => []);
      }

      const msg = err instanceof Error ? err.message : String(err);
      console.error("[JUP/SEND] Broadcast failed:", msg, logs.slice(0, 5));

      // Parse common errors for better UX
      // Check slippage FIRST since 0x1771 contains "0x1"
      const lowerMsg = msg.toLowerCase();
      if (lowerMsg.includes("slippage") || msg.includes("0x1771")) {
        return jsonError(
          400,
          "Price moved too much. Try again with higher slippage.",
          {
            code: "SLIPPAGE_EXCEEDED",
            logs: logs.slice(0, 10),
          }
        );
      }
      // Check for exact 0x1 error code (not 0x1771, etc)
      if (lowerMsg.includes("insufficient") || /\b0x1\b/.test(msg)) {
        return jsonError(400, "Insufficient balance for this swap", {
          code: "INSUFFICIENT_BALANCE",
          logs: logs.slice(0, 10),
        });
      }
      if (lowerMsg.includes("blockhash")) {
        return jsonError(400, "Transaction expired. Please try again.", {
          code: "BLOCKHASH_EXPIRED",
          logs: logs.slice(0, 10),
        });
      }

      return jsonError(400, "Broadcast failed", {
        code: "BROADCAST_FAILED",
        logs: logs.slice(0, 10),
        details: msg,
      });
    }

    const sendTime = Date.now() - startTime;
    console.log(`[JUP/SEND] ${signature.slice(0, 8)}... ${sendTime}ms`);

    return NextResponse.json({
      signature,
      sendTimeMs: sendTime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[JUP/SEND] Unhandled:", msg);
    return jsonError(500, "Internal server error", {
      code: "UNHANDLED",
      details: msg,
    });
  }
}
