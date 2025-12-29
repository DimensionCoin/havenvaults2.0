// app/api/savings/send/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { jwtVerify } from "jose";
import { PrivyClient } from "@privy-io/server-auth";

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  ComputeBudgetProgram,
  SystemProgram,
  MessageV0,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import { Buffer } from "buffer";
import BN from "bn.js";
import mongoose from "mongoose";

import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";
import { SavingsLedger } from "@/models/SavingsLedger";

const enc = new TextEncoder();
const SESSION_COOKIE = "haven_session";

// USDC math
const DECIMALS = 6;
const TEN = new BN(10);
const BASE = TEN.pow(new BN(DECIMALS));
const ZERO = new BN(0);

function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) console.error("[/api/savings/send]", body);
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function readBearer(req: Request): string | null {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const t = authz.slice(7).trim();
    return t || null;
  }
  return null;
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const target = name.toLowerCase() + "=";
  const part = cookie
    .split(";")
    .map((s) => s.trim())
    .find((c) => c.toLowerCase().startsWith(target));
  return part ? decodeURIComponent(part.substring(target.length)) : null;
}

function isAllZeroSig(sig: Uint8Array) {
  for (let i = 0; i < sig.length; i++) if (sig[i] !== 0) return false;
  return true;
}

function safeTailLogs(logs: unknown, max = 20): string[] | null {
  if (!Array.isArray(logs)) return null;
  const only = logs.filter((x): x is string => typeof x === "string");
  return only.length ? only.slice(-max) : null;
}

type ErrorLike = {
  message?: unknown;
  body?: unknown;
  bodyAsString?: unknown;
};

function toSignedBytes(resp: unknown): Uint8Array {
  if (typeof resp === "string")
    return new Uint8Array(Buffer.from(resp, "base64"));
  if (resp instanceof Uint8Array) return resp;
  if (Array.isArray(resp) && resp.every((n) => typeof n === "number")) {
    return new Uint8Array(resp);
  }
  if (resp && typeof resp === "object") {
    if (
      "serialize" in resp &&
      typeof (resp as { serialize?: () => unknown }).serialize === "function"
    ) {
      const serialized = (resp as { serialize: () => unknown }).serialize();
      return new Uint8Array(toSignedBytes(serialized));
    }
    if ("signedTransaction" in resp)
      return toSignedBytes(
        (resp as { signedTransaction?: unknown }).signedTransaction
      );
    if ("signed_transaction" in resp)
      return toSignedBytes(
        (resp as { signed_transaction?: unknown }).signed_transaction
      );
  }
  throw new Error("Unexpected signTransaction return type");
}

async function getUserWalletFromRequest(req: NextRequest): Promise<string> {
  await connectMongo();

  const PRIVY_APP_ID = process.env.PRIVY_APP_ID || process.env.HAVEN_AUTH_ID;
  const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

  const privy =
    PRIVY_APP_ID && PRIVY_APP_SECRET
      ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
      : null;

  const bearer = readBearer(req);
  if (bearer && privy) {
    try {
      const claims = await privy.verifyAuthToken(bearer);
      const privyId = claims.userId;
      const u = await User.findOne({ privyId }, { walletAddress: 1 }).lean();
      if (u?.walletAddress) return u.walletAddress;
    } catch (e) {
      console.warn("[/api/savings/send] Privy verify failed:", String(e));
    }
  }

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) throw new Error("Unauthorized");

  const sessionJwt = readCookie(req, SESSION_COOKIE);
  if (!sessionJwt) throw new Error("Unauthorized");

  const { payload } = await jwtVerify(sessionJwt, enc.encode(JWT_SECRET));
  const uid =
    (typeof payload.uid === "string" && payload.uid) ||
    (typeof payload.userId === "string" && payload.userId) ||
    null;

  if (!uid) throw new Error("Unauthorized");

  const u = await User.findById(uid, { walletAddress: 1 }).lean();
  if (!u?.walletAddress) throw new Error("Unauthorized");
  return u.walletAddress;
}

/** Type guard: is this v0 message? */
function isMessageV0(msg: unknown): msg is MessageV0 {
  return !!msg && typeof msg === "object" && "compiledInstructions" in msg;
}

function verifyTxOrThrow(opts: {
  tx: VersionedTransaction;
  userPk: PublicKey;
  havenPk: PublicKey;
  marginfiProgramId: PublicKey;
}) {
  const { tx, userPk, havenPk, marginfiProgramId } = opts;

  const msgUnknown: unknown = tx.message;

  // 1) Disallow ALTs (address table lookups)
  if (isMessageV0(msgUnknown)) {
    const lookups = msgUnknown.addressTableLookups ?? [];
    if (Array.isArray(lookups) && lookups.length > 0) {
      throw new Error("Address lookup tables are not allowed.");
    }
  }

  // 2) Pull static keys + header safely
  // Both MessageV0 and legacy Message expose these, but typings can vary across web3 versions.
  const staticKeys: PublicKey[] =
    (tx.message as unknown as { staticAccountKeys?: PublicKey[] })
      .staticAccountKeys ?? [];

  const header =
    (tx.message as unknown as { header?: { numRequiredSignatures?: number } })
      .header ?? null;

  if (!staticKeys.length || !header?.numRequiredSignatures) {
    throw new Error("Invalid transaction.");
  }

  const payer = staticKeys[0];
  if (!payer?.equals(havenPk)) throw new Error("Invalid fee payer.");

  const nSigners = header.numRequiredSignatures;
  if (nSigners < 2 || nSigners > 3) throw new Error("Unexpected signer set.");

  const signerKeys = staticKeys.slice(0, nSigners);

  if (!signerKeys[0]?.equals(havenPk)) throw new Error("Fee payer mismatch.");
  if (!signerKeys.some((k) => k.equals(userPk))) {
    throw new Error("User is not a required signer.");
  }

  const sigs = tx.signatures;
  if (!Array.isArray(sigs) || sigs.length !== nSigners) {
    throw new Error("Invalid signatures array.");
  }

  if (!isAllZeroSig(sigs[0])) {
    throw new Error("Unexpected fee payer signature present.");
  }

  const userIndex = signerKeys.findIndex((k) => k.equals(userPk));
  if (userIndex < 0) throw new Error("User signer not found.");
  if (isAllZeroSig(sigs[userIndex])) throw new Error("Missing user signature.");

  for (let i = 0; i < signerKeys.length; i++) {
    const k = signerKeys[i];
    if (k.equals(havenPk)) continue;
    if (k.equals(userPk)) continue;
    if (isAllZeroSig(sigs[i])) {
      throw new Error("Missing required pre-signed account signature.");
    }
  }

  // 3) Allowlist program IDs used by the tx
  const allow = new Set<string>([
    ComputeBudgetProgram.programId.toBase58(),
    SystemProgram.programId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_2022_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    marginfiProgramId.toBase58(),
  ]);

  // ✅ FIX: compiledInstructions only exists on MessageV0
  if (!isMessageV0(msgUnknown)) {
    // if you truly never expect legacy messages, fail closed
    throw new Error("Only v0 transactions are supported.");
  }

  const compiled = msgUnknown.compiledInstructions ?? [];
  for (const ix of compiled) {
    const programId: PublicKey | undefined = staticKeys[ix.programIdIndex];
    if (!programId) throw new Error("Invalid instruction program id.");
    if (!allow.has(programId.toBase58())) {
      throw new Error("Transaction contains a disallowed instruction.");
    }
  }
}

/* ───────── BN helpers ───────── */

function bnMax(a: BN, b: BN) {
  return a.gt(b) ? a : b;
}
function bnMin(a: BN, b: BN) {
  return a.lt(b) ? a : b;
}

function parseBaseAmountStringBN(s: unknown): BN {
  if (typeof s !== "string" || !/^\d+$/.test(s)) return ZERO.clone();
  try {
    return new BN(s, 10);
  } catch {
    return ZERO.clone();
  }
}

type TokenBalanceLike = {
  owner?: string;
  mint?: string;
  uiTokenAmount?: { amount?: string };
};

function sumOwnerMintBaseBN(
  balances: unknown,
  owner58: string,
  mint58: string
): BN {
  if (!Array.isArray(balances)) return ZERO.clone();
  let sum = ZERO.clone();
  for (const b of balances) {
    const tb = b as TokenBalanceLike;
    if (tb?.owner !== owner58) continue;
    if (tb?.mint !== mint58) continue;
    const amt = parseBaseAmountStringBN(tb?.uiTokenAmount?.amount);
    sum = sum.add(amt);
  }
  return sum;
}

function baseBnToUiString(baseBn: BN): string {
  const neg = baseBn.isNeg();
  const n = baseBn.abs();

  const whole = n.div(BASE);
  const frac = n.mod(BASE);

  const wholeStr = whole.toString(10);
  const fracStr = frac.toString(10).padStart(DECIMALS, "0").replace(/0+$/, "");

  const s = fracStr.length ? `${wholeStr}.${fracStr}` : wholeStr;
  return neg ? `-${s}` : s;
}

function uiStringToBaseBn(ui: string): BN {
  const raw = String(ui ?? "").trim();
  if (!raw) return ZERO.clone();

  const neg = raw.startsWith("-");
  const s = neg ? raw.slice(1) : raw;

  const parts = s.split(".");
  const w = (parts[0] || "0").replace(/[^\d]/g, "") || "0";
  const f = (parts[1] || "").replace(/[^\d]/g, "");
  const frac = (f + "000000").slice(0, 6);

  const wholeBn = new BN(w, 10);
  const fracBn = new BN(frac || "0", 10);

  const out = wholeBn.mul(BASE).add(fracBn);
  return neg ? out.neg() : out;
}

function uiToDecimal128(ui: string) {
  const [w, f = ""] = String(ui ?? "0").split(".");
  const frac = (f + "000000").slice(0, 6);
  const norm = `${w || "0"}.${frac}`;
  return mongoose.Types.Decimal128.fromString(norm);
}

/* ───────── ledger-driven aggregate sync ───────── */

async function ensureSavingsAccountExists(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
  walletAddress: string;
}) {
  const { userId, accountType, walletAddress } = opts;
  const D0 = mongoose.Types.Decimal128.fromString("0");

  await User.updateOne(
    { _id: userId, "savingsAccounts.type": { $ne: accountType } },
    {
      $push: {
        savingsAccounts: {
          type: accountType,
          walletAddress,
          principalDeposited: D0,
          principalWithdrawn: D0,
          interestWithdrawn: D0,
          totalDeposited: D0,
          totalWithdrawn: D0,
          feesPaidUsdc: D0,
        },
      },
    }
  );
}

async function getPrincipalRemainingBaseFromLedger(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
}): Promise<BN> {
  const { userId, accountType } = opts;
  const D0 = mongoose.Types.Decimal128.fromString("0");

  const rows = await SavingsLedger.aggregate([
    { $match: { userId, accountType } },
    {
      $group: {
        _id: null,
        deposited: {
          $sum: {
            $cond: [{ $eq: ["$direction", "deposit"] }, "$principalPart", D0],
          },
        },
        withdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$principalPart", D0],
          },
        },
      },
    },
  ]);

  const depositedStr = rows?.[0]?.deposited?.toString?.() ?? "0";
  const withdrawnStr = rows?.[0]?.withdrawn?.toString?.() ?? "0";

  const depositedBase = uiStringToBaseBn(depositedStr);
  const withdrawnBase = uiStringToBaseBn(withdrawnStr);

  return bnMax(depositedBase.sub(withdrawnBase), ZERO);
}

async function syncSavingsAccountAggFromLedger(opts: {
  userId: mongoose.Types.ObjectId;
  accountType: "flex" | "plus";
}) {
  const { userId, accountType } = opts;
  const D0 = mongoose.Types.Decimal128.fromString("0");

  const rows = await SavingsLedger.aggregate([
    { $match: { userId, accountType } },
    {
      $group: {
        _id: null,

        principalDeposited: {
          $sum: {
            $cond: [{ $eq: ["$direction", "deposit"] }, "$principalPart", D0],
          },
        },
        principalWithdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$principalPart", D0],
          },
        },
        interestWithdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$interestPart", D0],
          },
        },

        totalDeposited: {
          $sum: {
            $cond: [{ $eq: ["$direction", "deposit"] }, "$amount", D0],
          },
        },
        totalWithdrawn: {
          $sum: {
            $cond: [{ $eq: ["$direction", "withdraw"] }, "$amount", D0],
          },
        },

        feesPaidUsdc: { $sum: "$feeUsdc" },
      },
    },
  ]);

  const agg = rows?.[0] ?? null;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "savingsAccounts.$[a].principalDeposited":
          agg?.principalDeposited ?? D0,
        "savingsAccounts.$[a].principalWithdrawn":
          agg?.principalWithdrawn ?? D0,
        "savingsAccounts.$[a].interestWithdrawn": agg?.interestWithdrawn ?? D0,
        "savingsAccounts.$[a].totalDeposited": agg?.totalDeposited ?? D0,
        "savingsAccounts.$[a].totalWithdrawn": agg?.totalWithdrawn ?? D0,
        "savingsAccounts.$[a].feesPaidUsdc": agg?.feesPaidUsdc ?? D0,
        "savingsAccounts.$[a].lastSyncedAt": new Date(),
        "savingsAccounts.$[a].updatedAt": new Date(),
      },
    },
    { arrayFilters: [{ "a.type": accountType }] }
  );
}

/* ───────── route ───────── */

export async function POST(req: NextRequest) {
  try {
    const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC;
    const HAVEN_ADDR = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS;
    const MARGINFI_PROGRAM_ID_STR = process.env.MARGINFI_PROGRAM_ID;

    const USDC_MINT_STR = process.env.NEXT_PUBLIC_USDC_MINT;
    const TREASURY_OWNER_STR = process.env.NEXT_PUBLIC_APP_TREASURY_OWNER;

    const PRIVY_APP_ID = process.env.PRIVY_APP_ID || process.env.HAVEN_AUTH_ID;
    const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
    const WALLET_AUTH_KEY = process.env.PRIVY_AUTH_PRIVATE_KEY_B64;
    const HAVEN_WALLET_ID = process.env.HAVEN_AUTH_ADDRESS_ID;

    if (!RPC)
      return json(500, { error: "Missing env: NEXT_PUBLIC_SOLANA_RPC" });
    if (!HAVEN_ADDR)
      return json(500, {
        error: "Missing env: NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS",
      });
    if (!MARGINFI_PROGRAM_ID_STR)
      return json(500, { error: "Missing env: MARGINFI_PROGRAM_ID" });

    if (!USDC_MINT_STR)
      return json(500, { error: "Missing env: NEXT_PUBLIC_USDC_MINT" });
    if (!TREASURY_OWNER_STR)
      return json(500, {
        error: "Missing env: NEXT_PUBLIC_APP_TREASURY_OWNER",
      });

    if (!PRIVY_APP_ID)
      return json(500, { error: "Missing env: HAVEN_AUTH_ID/PRIVY_APP_ID" });
    if (!PRIVY_APP_SECRET)
      return json(500, { error: "Missing env: PRIVY_APP_SECRET" });
    if (!WALLET_AUTH_KEY)
      return json(500, { error: "Missing env: PRIVY_AUTH_PRIVATE_KEY_B64" });
    if (!HAVEN_WALLET_ID)
      return json(500, { error: "Missing env: HAVEN_AUTH_ADDRESS_ID" });

    const havenPk = new PublicKey(HAVEN_ADDR);
    const marginfiProgramId = new PublicKey(MARGINFI_PROGRAM_ID_STR);
    const usdcMintPk = new PublicKey(USDC_MINT_STR);
    const treasuryOwnerPk = new PublicKey(TREASURY_OWNER_STR);

    const body = (await req.json().catch(() => null)) as {
      signedTxB64?: string;
      transaction?: string;
      accountType?: "flex" | "plus";
      direction?: "deposit" | "withdraw";
    } | null;

    const signedTxB64 = (body?.signedTxB64 ?? body?.transaction)?.trim();
    if (!signedTxB64) return json(400, { error: "signedTxB64 is required" });

    const accountType: "flex" | "plus" =
      body?.accountType === "plus" ? "plus" : "flex";

    const requestedDirection =
      body?.direction === "deposit" || body?.direction === "withdraw"
        ? body.direction
        : null;

    let walletAddress: string;
    try {
      walletAddress = await getUserWalletFromRequest(req);
    } catch {
      return json(401, { error: "Unauthorized" });
    }
    const userPk = new PublicKey(walletAddress);

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(
        Buffer.from(signedTxB64, "base64")
      );
    } catch {
      return json(400, { error: "Invalid signed transaction" });
    }

    try {
      verifyTxOrThrow({ tx: userSignedTx, userPk, havenPk, marginfiProgramId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transaction rejected";
      return json(400, { error: msg });
    }

    const conn = new Connection(RPC, "confirmed");

    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET, {
      walletApi: { authorizationPrivateKey: WALLET_AUTH_KEY },
    });

    let cosignedBytes: Uint8Array;
    try {
      const resp = await appPrivy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      cosignedBytes = toSignedBytes(resp);
    } catch (e: unknown) {
      const errorLike = e as ErrorLike;
      const msg =
        (typeof errorLike?.message === "string" && errorLike.message) ||
        "Privy signTransaction failed";
      return json(500, { error: "Fee payer signing failed", details: msg });
    }

    let sig: string;
    try {
      sig = await conn.sendRawTransaction(cosignedBytes, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "sendRawTransaction failed";
      return json(400, { error: msg });
    }

    const latest = await conn.getLatestBlockhash("confirmed");
    const conf = await conn.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );

    if (conf.value.err)
      return json(400, { error: "On-chain transaction failed" });

    const txResp = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    const logsTail = safeTailLogs(txResp?.meta?.logMessages);

    if (!txResp?.meta) {
      return NextResponse.json({
        ok: true,
        signature: sig,
        logs: logsTail ?? undefined,
        recorded: false,
        recordError:
          "No transaction meta returned from RPC; cannot compute deltas.",
      });
    }

    const pre = txResp.meta.preTokenBalances ?? [];
    const post = txResp.meta.postTokenBalances ?? [];

    const userPre = sumOwnerMintBaseBN(
      pre,
      userPk.toBase58(),
      usdcMintPk.toBase58()
    );
    const userPost = sumOwnerMintBaseBN(
      post,
      userPk.toBase58(),
      usdcMintPk.toBase58()
    );
    const treasuryPre = sumOwnerMintBaseBN(
      pre,
      treasuryOwnerPk.toBase58(),
      usdcMintPk.toBase58()
    );
    const treasuryPost = sumOwnerMintBaseBN(
      post,
      treasuryOwnerPk.toBase58(),
      usdcMintPk.toBase58()
    );

    const userDelta = userPost.sub(userPre); // + means user received
    const treasuryDelta = treasuryPost.sub(treasuryPre); // + means treasury received
    const feeBase = bnMax(treasuryDelta, ZERO);

    let direction: "deposit" | "withdraw" | null = requestedDirection;
    if (!direction) {
      if (userDelta.gt(ZERO)) direction = "withdraw";
      else if (userDelta.lt(ZERO)) direction = "deposit";
      else direction = null;
    }
    if (!direction) {
      return NextResponse.json({
        ok: true,
        signature: sig,
        logs: logsTail ?? undefined,
        recorded: false,
        recordError: "Could not infer deposit/withdraw direction from deltas.",
      });
    }

    let amountBase = ZERO.clone();
    if (direction === "withdraw") {
      const netToUser = bnMax(userDelta, ZERO);
      amountBase = netToUser.add(feeBase);
    } else {
      const paidByUser = userDelta.isNeg() ? userDelta.abs() : ZERO.clone();
      amountBase = paidByUser.sub(feeBase);
      if (amountBase.isNeg()) amountBase = ZERO.clone();
    }

    await connectMongo();

    const userDoc = await User.findOne({ walletAddress }, { _id: 1 }).lean();
    if (!userDoc?._id) {
      return NextResponse.json({
        ok: true,
        signature: sig,
        logs: logsTail ?? undefined,
        recorded: false,
        recordError: "User not found for walletAddress.",
      });
    }

    await ensureSavingsAccountExists({
      userId: userDoc._id,
      accountType,
      walletAddress,
    });

    let principalPartBase = ZERO.clone();
    let interestPartBase = ZERO.clone();

    if (direction === "deposit") {
      principalPartBase = amountBase.clone();
    } else {
      const principalRemainingBase = await getPrincipalRemainingBaseFromLedger({
        userId: userDoc._id,
        accountType,
      });

      principalPartBase = bnMin(amountBase, principalRemainingBase);
      interestPartBase = amountBase.sub(principalPartBase);
      if (interestPartBase.isNeg()) interestPartBase = ZERO.clone();
    }

    const amountUi = baseBnToUiString(amountBase);
    const feeUi = baseBnToUiString(feeBase);
    const principalUi = baseBnToUiString(principalPartBase);
    const interestUi = baseBnToUiString(interestPartBase);

    const ledgerRes = await SavingsLedger.updateOne(
      { signature: sig },
      {
        $setOnInsert: {
          userId: userDoc._id,
          accountType,
          direction,
          amount: uiToDecimal128(amountUi),
          principalPart: uiToDecimal128(principalUi),
          interestPart: uiToDecimal128(interestUi),
          feeUsdc: uiToDecimal128(feeUi),
          signature: sig,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    const inserted =
      (ledgerRes?.upsertedCount ?? 0) === 1 ||
      Boolean((ledgerRes as { upsertedId?: unknown })?.upsertedId);

    if (inserted) {
      await syncSavingsAccountAggFromLedger({
        userId: userDoc._id,
        accountType,
      });
    }

    return NextResponse.json({
      ok: true,
      signature: sig,
      logs: logsTail ?? undefined,
      recorded: inserted,
      accounting: {
        direction,
        accountType,
        amountUi,
        feeUi,
        principalUi,
        interestUi,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send failed";
    return json(500, { error: msg });
  }
}
