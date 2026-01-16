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
import {
  getServerUser,
  getUserWalletPubkey,
  assertUserSigned,
} from "@/lib/getServerUser";

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

// Optional: protect cookie-auth routes from cross-site POSTs (CSRF-ish).
// Set this to your production domain (and optionally localhost for dev).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ───────── Singletons ───────── */

let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(SOLANA_RPC, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 30_000,
      disableRetryOnRateLimit: false,
    });
  }
  return _conn;
}

let _privy: PrivyClient | null = null;
function getPrivyClient(): PrivyClient {
  if (!_privy) {
    _privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });
  }
  return _privy;
}

/* ───────── Helpers ───────── */

function jsonError(
  status: number,
  payload: {
    error: string;
    code: string;
    userMessage?: string;
    details?: string;
    logs?: string[];
    traceId?: string;
  }
) {
  return NextResponse.json(payload, { status });
}

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

function hasSignedTransaction(x: unknown): x is {
  signedTransaction:
    | string
    | Uint8Array
    | number[]
    | { serialize: () => Uint8Array };
} {
  return (
    !!x &&
    typeof x === "object" &&
    "signedTransaction" in (x as Record<string, unknown>)
  );
}

function toSignedBytes(resp: unknown): Uint8Array {
  const payload: SignResp = hasSignedTransaction(resp)
    ? (resp as { signedTransaction: SignResp }).signedTransaction
    : (resp as SignResp);

  if (typeof payload === "string")
    return new Uint8Array(Buffer.from(payload, "base64"));
  if (payload instanceof Uint8Array) return payload;
  if (Array.isArray(payload) && payload.every((n) => typeof n === "number"))
    return new Uint8Array(payload);

  if (payload && typeof payload === "object" && "serialize" in payload) {
    const ser = (payload as { serialize: () => Uint8Array }).serialize;
    if (typeof ser === "function") return new Uint8Array(ser.call(payload));
  }

  throw new Error("Unexpected signTransaction return type");
}

function isLikelyBlockhashError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("blockhash") ||
    m.includes("expired") ||
    m.includes("block height exceeded")
  );
}

function isLikelySlippageError(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("slippage") || m.includes("0x1771") || m.includes("price impact")
  );
}

/**
 * Extra safety: require tx signer set is exactly what we expect.
 * For this flow it should typically be: [HAVEN, USER] (2 signers).
 * This blocks “surprise signer” transactions that could do weird things.
 */
function assertExpectedSigners(
  tx: VersionedTransaction,
  expected: PublicKey[]
) {
  const header = tx.message.header;
  const signerKeys = tx.message.staticAccountKeys.slice(
    0,
    header.numRequiredSignatures
  );

  if (signerKeys.length !== expected.length) {
    throw new Error(
      `Unexpected signer count: ${signerKeys.length} (expected ${expected.length})`
    );
  }

  for (const pk of expected) {
    if (!signerKeys.some((k) => k.equals(pk))) {
      throw new Error("Unexpected required signer set");
    }
  }
}

function assertOriginAllowed(req: NextRequest) {
  // Only enforce if you configured it.
  if (!ALLOWED_ORIGINS.length) return;

  const origin = req.headers.get("origin") || "";
  if (!origin) throw new Error("Missing Origin");

  // exact match is safest
  if (!ALLOWED_ORIGINS.includes(origin)) {
    throw new Error(`Disallowed Origin: ${origin}`);
  }
}

/* ───────── Route ───────── */

export async function POST(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();

  try {
    // ✅ Optional CSRF-ish protection for cookie-auth routes
    // (configure ALLOWED_ORIGINS in env to enable)
    try {
      assertOriginAllowed(req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(403, {
        code: "ORIGIN_BLOCKED",
        error: "Forbidden",
        userMessage: "Request blocked.",
        details: msg,
        traceId,
      });
    }

    // ✅ Auth
    const session = await getSessionFromCookies();
    if (!session?.userId && !session?.sub) {
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
        userMessage: "Please sign in again.",
        traceId,
      });
    }

    // ✅ Load user (bind tx to this user’s wallet)
    const user = await getServerUser();
    if (!user) {
      return jsonError(401, {
        code: "UNAUTHORIZED",
        error: "Unauthorized",
        userMessage: "Please sign in again.",
        traceId,
      });
    }

    const expectedUserPk = getUserWalletPubkey(user);

    const body = (await req.json().catch(() => null)) as {
      transaction?: string;
    } | null;

    if (!body?.transaction || typeof body.transaction !== "string") {
      return jsonError(400, {
        code: "MISSING_TRANSACTION",
        error: "Missing 'transaction' in body",
        userMessage: "Something went wrong sending your withdrawal.",
        traceId,
      });
    }

    // ✅ Deserialize
    const raw = Buffer.from(body.transaction, "base64");
    if (!raw.length) {
      return jsonError(400, {
        code: "BAD_ENCODING",
        error: "Invalid transaction encoding",
        userMessage: "Bad transaction data.",
        traceId,
      });
    }

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, {
        code: "BAD_TX",
        error: "Invalid VersionedTransaction",
        userMessage: "Bad transaction data.",
        traceId,
      });
    }

    // ✅ Fee payer must be Haven (you already do this)
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "INVALID_FEE_PAYER",
        error: "Invalid fee payer",
        userMessage: "Security check failed. Please try again.",
        traceId,
      });
    }

    // ✅ Blockhash exists
    const blockhash = userSignedTx.message.recentBlockhash;
    if (!blockhash || blockhash === "11111111111111111111111111111111") {
      return jsonError(400, {
        code: "INVALID_BLOCKHASH",
        error: "Invalid blockhash",
        userMessage: "Transaction expired. Please try again.",
        traceId,
      });
    }

    // ✅ NEW: Make sure THIS logged-in user’s wallet is the signer on the tx
    try {
      assertUserSigned(userSignedTx, expectedUserPk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(400, {
        code: "SIGNER_MISMATCH",
        error: "User signer mismatch",
        userMessage: "Please sign this transaction with your Haven wallet.",
        details: msg,
        traceId,
      });
    }

    // ✅ NEW: No “surprise signer” txs (should be exactly Haven + User)
    try {
      assertExpectedSigners(userSignedTx, [HAVEN_PUBKEY, expectedUserPk]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError(400, {
        code: "UNEXPECTED_SIGNERS",
        error: "Unexpected required signer set",
        userMessage: "Security check failed. Please try again.",
        details: msg,
        traceId,
      });
    }

    const conn = getConnection();
    const privy = getPrivyClient();

    // ✅ Co-sign with Haven fee payer via Privy
    let coSignedBytes: Uint8Array;
    try {
      const resp = await privy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      coSignedBytes = toSignedBytes(resp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PLUS/WITHDRAW/SEND] Privy sign failed:", msg);
      return jsonError(500, {
        code: "PRIVY_SIGN_FAILED",
        error: "Signing failed",
        userMessage: "Couldn't sign the transaction. Try again.",
        details: msg,
        traceId,
      });
    }

    // ✅ SIMULATE first
    const sim = await conn
      .simulateTransaction(VersionedTransaction.deserialize(coSignedBytes), {
        commitment: "confirmed",
        sigVerify: false,
      })
      .catch(() => null);

    if (sim?.value?.err) {
      const logs = sim.value.logs ?? [];
      console.error(
        "[PLUS/WITHDRAW/SEND] Simulation failed:",
        sim.value.err,
        logs.slice(0, 8)
      );

      const joined = logs.join("\n");
      const msg =
        typeof sim.value.err === "string"
          ? sim.value.err
          : JSON.stringify(sim.value.err);

      if (isLikelySlippageError(joined) || isLikelySlippageError(msg)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Simulation failed (slippage)",
          userMessage: "Price moved too much. Try again with higher slippage.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }

      if (
        joined.toLowerCase().includes("insufficient") ||
        joined.includes("0x1")
      ) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Simulation failed (insufficient balance)",
          userMessage: "You don't have enough balance for this withdrawal.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }

      if (isLikelyBlockhashError(joined) || isLikelyBlockhashError(msg)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Simulation failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: logs.slice(0, 20),
          traceId,
        });
      }

      return jsonError(400, {
        code: "SIMULATION_FAILED",
        error: "Simulation failed",
        userMessage: "Transaction failed to simulate. Please try again.",
        details: msg,
        logs: logs.slice(0, 30),
        traceId,
      });
    }

    // ✅ Broadcast
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
    } catch (err) {
      const ste = err as SendTransactionError;
      const steWithLogs = ste as unknown as {
        getLogs?: (c: Connection) => Promise<string[]>;
      };

      let logs: string[] = [];
      if (typeof steWithLogs.getLogs === "function") {
        logs = await steWithLogs.getLogs(conn).catch(() => []);
      }

      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        "[PLUS/WITHDRAW/SEND] Broadcast failed:",
        msg,
        logs.slice(0, 8)
      );

      if (isLikelySlippageError(msg)) {
        return jsonError(400, {
          code: "SLIPPAGE_EXCEEDED",
          error: "Broadcast failed (slippage)",
          userMessage: "Price moved too much. Try again with higher slippage.",
          logs: logs.slice(0, 20),
          details: msg,
          traceId,
        });
      }

      if (msg.toLowerCase().includes("insufficient")) {
        return jsonError(400, {
          code: "INSUFFICIENT_BALANCE",
          error: "Broadcast failed (insufficient balance)",
          userMessage: "You don't have enough balance for this withdrawal.",
          logs: logs.slice(0, 20),
          details: msg,
          traceId,
        });
      }

      if (isLikelyBlockhashError(msg)) {
        return jsonError(400, {
          code: "BLOCKHASH_EXPIRED",
          error: "Broadcast failed (blockhash expired)",
          userMessage: "Transaction expired. Please try again.",
          logs: logs.slice(0, 20),
          details: msg,
          traceId,
        });
      }

      return jsonError(400, {
        code: "BROADCAST_FAILED",
        error: "Broadcast failed",
        userMessage: "Couldn't send transaction. Please try again.",
        logs: logs.slice(0, 20),
        details: msg,
        traceId,
      });
    }

    const sendTime = Date.now() - startTime;
    console.log(
      `[PLUS/WITHDRAW/SEND] ${traceId} ${signature.slice(0, 8)}... ${sendTime}ms`
    );

    return NextResponse.json({ signature, sendTimeMs: sendTime, traceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[PLUS/WITHDRAW/SEND] Unhandled:", msg);
    return jsonError(500, {
      code: "UNHANDLED",
      error: "Internal server error",
      userMessage: "Something went wrong. Please try again.",
      details: msg,
      traceId,
    });
  }
}
