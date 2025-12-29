// app/api/user/wallet/transfer/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendOptions,
  SendTransactionError,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getSessionFromCookies } from "@/lib/auth";

/* ───────── Config ───────── */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// MUST match the client RPC used to fetch the blockhash
const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");

// Privy server-auth app that owns the Haven fee payer wallet
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_APP_SECRET");
const PRIVY_AUTH_PK = required("PRIVY_AUTH_PRIVATE_KEY_B64");
const HAVEN_WALLET_ID = required("HAVEN_AUTH_ADDRESS_ID");

// Public address of the Haven fee payer (must be tx.payerKey index 0)
const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);

/* ───────── Types & helpers ───────── */

type Body = { transaction: string };

type ErrorLike = {
  message?: unknown;
  body?: unknown;
  bodyAsString?: unknown;
};

type MessageV0Subset = {
  staticAccountKeys: PublicKey[];
  header: { numRequiredSignatures: number };
  recentBlockhash?: string;
};

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

type JsonErrorExtra = Record<string, unknown> | undefined;

function jsonError(
  status: number,
  message: string,
  extra?: JsonErrorExtra
): NextResponse {
  // What the client sees: short + human-readable
  const payload = { error: message, ...(extra || {}) };
  return NextResponse.json(payload, { status });
}

// Normalize Privy signTransaction return into bytes
function toSignedBytes(resp: unknown): Uint8Array {
  const asObj = resp as Record<string, unknown> | null;

  const payload =
    asObj && "signedTransaction" in asObj
      ? (asObj.signedTransaction as unknown)
      : resp;

  if (typeof payload === "string") {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (Array.isArray(payload) && payload.every((n) => typeof n === "number")) {
    return new Uint8Array(payload as number[]);
  }
  if (
    payload &&
    typeof payload === "object" &&
    "serialize" in payload &&
    typeof (payload as { serialize: unknown }).serialize === "function"
  ) {
    return new Uint8Array(
      (payload as { serialize: () => Uint8Array }).serialize()
    );
  }

  throw new Error("Unexpected signTransaction return type");
}

async function confirmSig(conn: Connection, signature: string) {
  try {
    const bh = await conn.getLatestBlockhash("confirmed");
    const res = await conn.confirmTransaction(
      { signature, ...bh },
      "confirmed"
    );
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
  } catch {
    const res2 = await conn.confirmTransaction(signature, "confirmed");
    if (res2.value.err) throw new Error(JSON.stringify(res2.value.err));
  }
}

// Take Solana logs & return a compact, human-readable string array
function summarizeLogs(logs?: string[] | null): string[] {
  if (!logs || !logs.length) return [];
  return logs
    .map((l) => l.trim())
    .filter((l) => !!l)
    .filter(
      (l) =>
        /error|fail|insufficient|custom program error/i.test(l) ||
        l.startsWith("Program ") ||
        l.startsWith("Instruction ")
    );
}

/* ───────── Route ───────── */

export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return jsonError(405, "Method not allowed");
  }
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return jsonError(415, "Content-Type must be application/json");
  }

  try {
    // 🔐 Require a valid session
    const session = await getSessionFromCookies();
    if (!session?.userId) {
      return jsonError(401, "Unauthorized");
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, "Missing 'transaction' in body");
    }

    // Raw v0 tx bytes (already signed by the user in the browser)
    const raw = Buffer.from(body.transaction, "base64");
    if (raw.length === 0) {
      return jsonError(400, "Invalid transaction encoding");
    }

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(Buffer.from(raw));
    } catch {
      return jsonError(400, "Invalid VersionedTransaction");
    }

    // ✅ Validate fee payer is Haven sponsor wallet
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, "Invalid fee payer (must be Haven sponsor wallet)");
    }

    // ❌ Reject dummy/empty blockhash
    const recentBlockhash = (userSignedTx.message as unknown as MessageV0Subset)
      .recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return jsonError(400, "Transaction has invalid or dummy recentBlockhash");
    }

    const conn = new Connection(SOLANA_RPC, "confirmed");

    // 💰 Pre-flight: check Haven fee payer has enough SOL
    try {
      const lamports = await conn.getBalance(HAVEN_PUBKEY, "processed");
      const balanceSol = lamports / LAMPORTS_PER_SOL;
      const MIN_FEE_WALLET_SOL = 0.005; // tweak if you like

      if (balanceSol < MIN_FEE_WALLET_SOL) {
        console.error(
          "[/api/user/wallet/transfer] Haven fee payer underfunded",
          { balanceSol }
        );
        return jsonError(
          503,
          "Haven fee wallet is temporarily underfunded. Please try again shortly.",
          {
            code: "FEEPAYER_UNDERFUNDED",
          }
        );
      }
    } catch (err) {
      console.error(
        "[/api/user/wallet/transfer] Failed to read fee payer balance:",
        err
      );
      // Not fatal; we still try to send, but you'll see this in logs
    }

    // 🔑 Co-sign via Privy server-auth (Haven fee payer wallet)
    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });

    let coSignedBytes: Uint8Array;
    try {
      const resp: unknown = await appPrivy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx, // pass the VersionedTransaction object
      });

      coSignedBytes = toSignedBytes(resp as SignResp);
    } catch (err: unknown) {
      const e = err as ErrorLike;
      const bodyStr =
        typeof e.bodyAsString === "function"
          ? String(e.bodyAsString())
          : typeof e.body === "string"
          ? e.body
          : undefined;
      const msgStr =
        typeof e.message === "string" ? e.message : bodyStr || String(err);
      const low = msgStr.toLowerCase();

      if (low.includes("blockhash not found") || low.includes("expired")) {
        return jsonError(409, "Blockhash not found or expired", {
          code: "BLOCKHASH_EXPIRED",
        });
      }
      if (low.includes("signature verification failure")) {
        return jsonError(
          400,
          "Signature verification failed (message mutated or signer order incorrect).",
          { code: "SIGNATURE_VERIFICATION_FAILED" }
        );
      }

      console.error(
        "[/api/user/wallet/transfer] Privy signTransaction failed",
        {
          message: msgStr,
        }
      );
      return jsonError(500, "Privy signTransaction failed.", {
        code: "PRIVY_SIGN_FAILED",
      });
    }

    const sendOpts: SendOptions = { skipPreflight: false, maxRetries: 3 };

    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, sendOpts);
    } catch (err: unknown) {
      const msg = String(
        (err as { message?: unknown })?.message ?? err
      ).toLowerCase();

      // Explicit blockhash handling (again, from RPC side)
      if (msg.includes("blockhash not found") || msg.includes("expired")) {
        return jsonError(409, "Blockhash not found or expired", {
          code: "BLOCKHASH_EXPIRED",
        });
      }

      // Fee / balance issues
      if (
        msg.includes("insufficient funds") ||
        msg.includes("insufficient lamports")
      ) {
        console.error(
          "[/api/user/wallet/transfer] Insufficient funds for fee or transfer:",
          err
        );
        return jsonError(
          400,
          "Not enough SOL to pay network fees. Check the fee wallet and sender balance.",
          { code: "INSUFFICIENT_FUNDS" }
        );
      }

      // Try to pull simulation logs
      if (typeof (err as SendTransactionError)?.getLogs === "function") {
        try {
          const logs = await (err as SendTransactionError).getLogs(conn);
          const summary = summarizeLogs(logs);

          console.error(
            "[/api/user/wallet/transfer] Simulation failed. Full logs:",
            logs
          );

          return jsonError(400, "Simulation failed.", {
            code: "SIMULATION_FAILED",
            logs: summary,
          });
        } catch {
          // ignore getLogs failures; fall through to generic handler
        }
      }

      console.error(
        "[/api/user/wallet/transfer] sendRawTransaction error:",
        err
      );
      return jsonError(500, "Broadcast failed.", {
        code: "BROADCAST_FAILED",
        details: String((err as { message?: unknown })?.message ?? err),
      });
    }

    // ✅ Best-effort confirmation
    await confirmSig(conn, signature);

    return NextResponse.json({ signature });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/user/wallet/transfer] Unhandled error:", msg);
    return jsonError(500, "Internal server error.", {
      code: "UNHANDLED",
      details: msg,
    });
  }
}
