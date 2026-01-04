// app/api/booster/send/route.ts - FIXED PRIVY SIGNING (NO `any`)
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";

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

/* ───────── CONSTANTS ───────── */
const KEEP_DUST_LAMPORTS = 900_000; // 0.0009 SOL
const DUST_TOLERANCE_LAMPORTS = 100_000;
const DUST_MAX_LAMPORTS = KEEP_DUST_LAMPORTS + DUST_TOLERANCE_LAMPORTS;

/* ───────── TYPES ───────── */
type ErrorLike = {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  body?: unknown;
  bodyAsString?: (() => unknown) | unknown;
};

type MessageV0Subset = {
  staticAccountKeys?: (PublicKey | string)[];
  recentBlockhash?: string;
  header?: { numRequiredSignatures?: number };
};

type HasSignatures = { signatures?: Uint8Array[] };

/* ───────── HELPERS ───────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === "number");
}

function shapeErr(e: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  const r = (e ?? {}) as ErrorLike;
  let message = "";
  try {
    const bas = r.bodyAsString;
    if (typeof bas === "function") message = String(bas());
    else if (typeof r.body === "string") message = r.body;
    else if (typeof r.message === "string") message = r.message;
    else message = String(e);
  } catch {
    message = String(e);
  }
  return {
    name: typeof r.name === "string" ? r.name : "Error",
    message,
    stack: typeof r.stack === "string" ? r.stack : undefined,
  };
}

function jsonError(
  status: number,
  body: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    traceId?: string;
    stage?: string;
    logs?: unknown;
    details?: unknown;
  }
) {
  console.error(`[booster/send] ERROR ${status}:`, body);
  return NextResponse.json(body, { status });
}

function anyZero(sig: Uint8Array | number[]): boolean {
  for (let i = 0; i < sig.length; i++) if (sig[i] !== 0) return false;
  return true;
}

// ✅ FIXED: Properly handle all Privy response formats WITHOUT `any`
function toSignedBytes(resp: unknown): Uint8Array {
  // Direct Uint8Array
  if (resp instanceof Uint8Array) {
    return resp;
  }

  // Base64 string
  if (typeof resp === "string") {
    return new Uint8Array(Buffer.from(resp, "base64"));
  }

  // Number array
  if (isNumberArray(resp)) {
    return new Uint8Array(resp);
  }

  // Object responses
  if (isRecord(resp)) {
    // Check for signedTransaction field
    if ("signedTransaction" in resp) {
      const st = resp.signedTransaction;

      // Base64 string
      if (typeof st === "string") {
        return new Uint8Array(Buffer.from(st, "base64"));
      }

      // Uint8Array
      if (st instanceof Uint8Array) {
        return st;
      }

      // Number array
      if (isNumberArray(st)) {
        return new Uint8Array(st);
      }

      // Has serialize method
      if (isRecord(st) && typeof st.serialize === "function") {
        // serialize() can return Buffer | Uint8Array | number[]
        const out = st.serialize();
        if (out instanceof Uint8Array) return new Uint8Array(out);
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(out))
          return new Uint8Array(out);
        if (isNumberArray(out)) return new Uint8Array(out);
      }
    }

    // Has serialize method directly
    if (typeof resp.serialize === "function") {
      const out = resp.serialize();
      if (out instanceof Uint8Array) return new Uint8Array(out);
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(out))
        return new Uint8Array(out);
      if (isNumberArray(out)) return new Uint8Array(out);
    }

    // Check for data field
    if ("data" in resp) {
      const data = resp.data;

      if (typeof data === "string") {
        return new Uint8Array(Buffer.from(data, "base64"));
      }
      if (data instanceof Uint8Array) {
        return data;
      }
      if (isNumberArray(data)) {
        return new Uint8Array(data);
      }
    }
  }

  // Debug log
  console.error("[toSignedBytes] Unexpected format:", {
    type: typeof resp,
    isArray: Array.isArray(resp),
    keys: isRecord(resp) ? Object.keys(resp) : null,
  });

  throw new Error("Unexpected signTransaction return type");
}

/* ───────── ROUTE ───────── */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const traceId = Math.random().toString(36).slice(2, 10);
  const stageRef: { stage: string } = { stage: "init" };

  try {
    stageRef.stage = "parseBody";
    const parsed = (await req.json().catch(() => null)) as {
      transaction?: string;
    } | null;

    const transaction = parsed?.transaction;
    if (!transaction) {
      return jsonError(400, {
        code: "MISSING_TRANSACTION",
        error: "Missing transaction payload",
        userMessage: "Invalid request.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    stageRef.stage = "deserialize";
    let userSignedTx: VersionedTransaction;
    try {
      const raw = Buffer.from(transaction, "base64");
      if (raw.length === 0) throw new Error("Empty transaction");
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return jsonError(400, {
        code: "INVALID_TRANSACTION",
        error: "Failed to deserialize transaction",
        userMessage: "Invalid transaction format.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    /* ───────── VALIDATION ───────── */

    stageRef.stage = "validateFeePayer";
    const msgShape = userSignedTx.message as unknown as MessageV0Subset;
    const payerRaw = msgShape.staticAccountKeys?.[0];

    let payerPk: PublicKey | null = null;
    try {
      payerPk =
        payerRaw instanceof PublicKey ? payerRaw : new PublicKey(payerRaw!);
    } catch {
      payerPk = null;
    }

    if (!payerPk || !payerPk.equals(HAVEN_PUBKEY)) {
      return jsonError(400, {
        code: "INVALID_FEE_PAYER",
        error: "Invalid fee payer",
        userMessage: "Transaction validation failed.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    stageRef.stage = "validateBlockhash";
    const recentBlockhash = msgShape.recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return jsonError(400, {
        code: "INVALID_BLOCKHASH",
        error: "Invalid or dummy blockhash",
        userMessage: "Transaction expired.",
        tip: "Please try again with a fresh transaction.",
        traceId,
        stage: stageRef.stage,
      });
    }

    stageRef.stage = "validateUserSignature";
    const header = msgShape.header ?? {};
    const requiredSignatures = header.numRequiredSignatures ?? 0;
    const preSigSlots =
      (userSignedTx as unknown as HasSignatures).signatures ?? [];
    const preSigPresent = preSigSlots.map((s) => (s ? !anyZero(s) : false));

    if (requiredSignatures >= 2 && !preSigPresent[1]) {
      return jsonError(400, {
        code: "MISSING_USER_SIGNATURE",
        error: "User signature missing",
        userMessage: "Please sign the transaction in your wallet.",
        tip: "Try again and approve when prompted.",
        traceId,
        stage: stageRef.stage,
      });
    }

    // Extract owner pubkey
    let ownerPk: PublicKey | null = null;
    if (requiredSignatures >= 2) {
      const ownerRaw = msgShape.staticAccountKeys?.[1];
      try {
        ownerPk =
          ownerRaw instanceof PublicKey ? ownerRaw : new PublicKey(ownerRaw!);
      } catch {
        ownerPk = null;
      }
    }

    /* ───────── PRIVY CO-SIGN ───────── */

    stageRef.stage = "privySign";
    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });

    let coSignedBytes: Uint8Array;
    try {
      console.log(`[send] ${traceId} Calling Privy signTransaction...`);

      const resp = await appPrivy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });

      console.log(`[send] ${traceId} Privy response type:`, typeof resp);
      console.log(
        `[send] ${traceId} Privy response keys:`,
        isRecord(resp) ? Object.keys(resp) : null
      );

      coSignedBytes = toSignedBytes(resp);

      console.log(
        `[send] ${traceId} Successfully parsed signed bytes, length: ${coSignedBytes.length}`
      );
    } catch (err: unknown) {
      const shaped = shapeErr(err);
      const low = shaped.message.toLowerCase();

      console.error(`[send] ${traceId} Privy signing error:`, shaped);

      if (low.includes("blockhash") || low.includes("expired")) {
        return jsonError(409, {
          code: "BLOCKHASH_EXPIRED",
          error: "Blockhash expired during signing",
          userMessage: "Transaction expired.",
          tip: "Please try again with a fresh transaction.",
          traceId,
          stage: stageRef.stage,
        });
      }

      return jsonError(500, {
        code: "SIGNING_FAILED",
        error: "Failed to co-sign transaction",
        userMessage: "Internal signing error.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
        details: shaped.message,
      });
    }

    stageRef.stage = "verifySignatures";
    const cosignedTx = VersionedTransaction.deserialize(coSignedBytes);
    const postSigSlots =
      (cosignedTx as unknown as HasSignatures).signatures ?? [];
    const postSigPresent = postSigSlots.map((s) => (s ? !anyZero(s) : false));

    if (
      requiredSignatures > 0 &&
      postSigPresent.slice(0, requiredSignatures).some((v) => !v)
    ) {
      return jsonError(400, {
        code: "INCOMPLETE_SIGNATURES",
        error: "Missing signatures after co-sign",
        userMessage: "Transaction signing failed.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
      });
    }

    /* ───────── SIMULATE + SEND ───────── */

    stageRef.stage = "initConnection";
    const conn = new Connection(SOLANA_RPC, "confirmed");

    stageRef.stage = "simulate";
    let simSuccess = false;

    try {
      const sim = await conn.simulateTransaction(cosignedTx, {
        replaceRecentBlockhash: false,
        commitment: "processed",
        sigVerify: false,
      });

      if (sim.value.err) {
        return jsonError(400, {
          code: "SIMULATION_FAILED",
          error: "Transaction would fail on-chain",
          userMessage: "Transaction simulation failed.",
          tip: "Try adjusting your trade amount.",
          traceId,
          stage: stageRef.stage,
          logs: sim.value.logs ?? [],
          details: sim.value.err,
        });
      }

      simSuccess = true;
    } catch (simErr: unknown) {
      const shaped = shapeErr(simErr);
      console.warn(`[send] ${traceId} simulation threw:`, shaped.message);
    }

    stageRef.stage = "send";
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: simSuccess,
        maxRetries: 2,
        preflightCommitment: "processed",
      });
    } catch (err: unknown) {
      const asSendErr = err as SendTransactionError;
      const shaped = shapeErr(err);

      let logs: string[] = [];
      if (typeof asSendErr?.getLogs === "function") {
        logs = (await asSendErr.getLogs(conn).catch(() => [])) ?? [];
      }

      return jsonError(400, {
        code: "SEND_FAILED",
        error: "Failed to broadcast transaction",
        userMessage: "Failed to send transaction.",
        tip: "Please try again.",
        traceId,
        stage: stageRef.stage,
        logs,
        details: shaped.message,
      });
    }

    /* ───────── CONFIRM ───────── */

    stageRef.stage = "confirm";
    let confirmed = false;
    try {
      if (recentBlockhash) {
        const latest = await conn.getLatestBlockhash("confirmed");
        await conn.confirmTransaction(
          {
            signature,
            blockhash: recentBlockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed"
        );
        confirmed = true;
      }
    } catch {
      confirmed = false;
    }

    /* ───────── POST-CONFIRMATION ───────── */

    stageRef.stage = "postConfirm";
    let ownerLamportsAfter: number | null = null;
    let dustExceeded = false;

    if (confirmed && ownerPk) {
      try {
        ownerLamportsAfter = await conn.getBalance(ownerPk, "confirmed");
        dustExceeded = ownerLamportsAfter > DUST_MAX_LAMPORTS;
      } catch {
        // Not critical
      }
    }

    /* ───────── RESPONSE ───────── */

    const totalTime = Date.now() - startTime;
    console.log(
      `[send] ✅ ${signature.slice(0, 8)} in ${totalTime}ms (confirmed: ${confirmed})`
    );

    return NextResponse.json({
      signature,
      traceId,
      confirmed,
      owner: ownerPk?.toBase58() ?? null,
      ownerLamportsAfter,
      dustPolicy: {
        keepDustLamports: KEEP_DUST_LAMPORTS,
        toleranceLamports: DUST_TOLERANCE_LAMPORTS,
        maxAllowedLamports: DUST_MAX_LAMPORTS,
      },
      dustExceeded,
      sweepSuggestion:
        confirmed && ownerLamportsAfter !== null && dustExceeded
          ? {
              userMessage: "Extra SOL detected. Sweep recommended.",
              endpoint: "/api/booster/sweep-sol",
              keepLamports: KEEP_DUST_LAMPORTS,
            }
          : null,
      meta: {
        processingTimeMs: totalTime,
      },
    });
  } catch (e: unknown) {
    const totalTime = Date.now() - startTime;
    const shaped = shapeErr(e);
    console.error(
      `[send] ❌ Failed in ${totalTime}ms at ${stageRef.stage}:`,
      shaped
    );

    return jsonError(500, {
      code: "UNHANDLED_ERROR",
      error: shaped.message,
      userMessage: "Internal error.",
      tip: "Please try again.",
      traceId,
      stage: stageRef.stage,
      details: shaped,
    });
  }
}
