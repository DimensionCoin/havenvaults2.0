// app/api/jup/send/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendTransactionError,
  SendOptions,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getSessionFromCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_APP_SECRET");
const PRIVY_AUTH_PK = required("PRIVY_AUTH_PRIVATE_KEY_B64");

// ✅ SAME AS YOUR TRANSFER ROUTE
const HAVEN_WALLET_ID = required("HAVEN_AUTH_ADDRESS_ID");

const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);

type Body = { transaction: string };

type SignResp =
  | string
  | Uint8Array
  | number[]
  | { serialize: () => Uint8Array }
  | {
      signedTransaction:
        | string
        | Uint8Array
        | number[]
        | { serialize: () => Uint8Array };
    };

function toSignedBytes(resp: unknown): Uint8Array {
  const asObj = resp as Record<string, unknown> | null;

  const payload =
    asObj && "signedTransaction" in asObj
      ? (asObj.signedTransaction as unknown)
      : resp;

  if (typeof payload === "string")
    return new Uint8Array(Buffer.from(payload, "base64"));
  if (payload instanceof Uint8Array) return payload;
  if (Array.isArray(payload) && payload.every((n) => typeof n === "number")) {
    return new Uint8Array(payload as number[]);
  }
  if (
    payload &&
    typeof payload === "object" &&
    "serialize" in payload &&
    typeof (payload as { serialize?: unknown }).serialize === "function"
  ) {
    return new Uint8Array(
      (payload as { serialize: () => Uint8Array }).serialize()
    );
  }
  throw new Error("Unexpected signTransaction return type");
}

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ error, ...(extra || {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session?.userId) return jsonError(401, "Unauthorized");

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, "Missing 'transaction' in body");
    }

    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length) return jsonError(400, "Invalid transaction encoding");

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, "Invalid VersionedTransaction");
    }

    // ✅ fee payer must be Haven
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, "Invalid fee payer (must be Haven sponsor wallet)");
    }

    // ❌ reject dummy/empty blockhash
    const recentBlockhash = userSignedTx.message.recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return jsonError(400, "Transaction has invalid or dummy recentBlockhash");
    }

    const conn = new Connection(SOLANA_RPC, "confirmed");

    // 🔑 co-sign with Privy (Haven fee payer wallet)
    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });

    let coSignedBytes: Uint8Array;
    try {
      const resp: unknown = await appPrivy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp as SignResp);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("invalid wallet id")) {
        return jsonError(500, "Invalid HAVEN walletId for Privy signing.", {
          code: "INVALID_HAVEN_WALLET_ID",
        });
      }
      return jsonError(500, "Privy signTransaction failed.", {
        code: "PRIVY_SIGN_FAILED",
        details: msg,
      });
    }

    const sendOpts: SendOptions = { skipPreflight: false, maxRetries: 3 };

    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, sendOpts);
    } catch (err: unknown) {
      const ste = err as SendTransactionError;
      const logs =
        typeof ste?.getLogs === "function"
          ? await ste.getLogs(conn).catch(() => [])
          : [];
      return jsonError(400, "Broadcast failed.", {
        code: "BROADCAST_FAILED",
        logs,
        details: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({ signature });
  } catch (e: unknown) {
    return jsonError(500, "Internal server error.", {
      code: "UNHANDLED",
      details: e instanceof Error ? e.message : String(e),
    });
  }
}
