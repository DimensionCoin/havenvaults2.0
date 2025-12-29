// app/api/savings/flex/open-and-deposit/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import bs58 from "bs58";
import mongoose from "mongoose";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getMint,
} from "@solana/spl-token";

import { BorshInstructionCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";

import marginfiIdl from "@/lib/marginfi_idl.json";
import { getSessionFromCookies } from "@/lib/auth";
import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";

/* ───────── env ───────── */
function requiredAny(names: string[]) {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  throw new Error(`Missing env: one of [${names.join(", ")}]`);
}

const RPC = requiredAny(["SOLANA_RPC", "NEXT_PUBLIC_SOLANA_RPC"]);

const USDC_MINT = new PublicKey(
  requiredAny(["USDC_MINT", "NEXT_PUBLIC_USDC_MINT"])
);

const HAVEN_PUBKEY = new PublicKey(
  requiredAny(["HAVEN_FEEPAYER_ADDRESS", "NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS"])
);

const MARGINFI_PROGRAM_ID = new PublicKey(requiredAny(["MARGINFI_PROGRAM_ID"]));
const MARGINFI_GROUP = new PublicKey(requiredAny(["MARGINFI_GROUP"]));
const MARGINFI_USDC_BANK = new PublicKey(requiredAny(["MARGINFI_USDC_BANK"]));
const MARGINFI_USDC_BANK_LIQ_VAULT = new PublicKey(
  requiredAny(["MARGINFI_USDC_BANK_LIQ_VAULT"])
);

const D128 = mongoose.Types.Decimal128;

/* ───────── response helper ───────── */
function json(status: number, body: Record<string, unknown>) {
  if (status >= 400)
    console.error("[/api/savings/flex/open-and-deposit]", body);
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/* Optional CSRF-ish hardening */
function enforceOrigin(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return;

  const allowed = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!allowed) return;

  const allowedOrigin = (() => {
    try {
      return new URL(allowed).origin;
    } catch {
      return null;
    }
  })();
  if (!allowedOrigin) return;

  const origin = req.headers.get("origin");
  if (!origin) return;

  if (origin !== allowedOrigin) {
    throw new Error(`Invalid origin: ${origin}`);
  }
}

function isPlainUiAmount(x: unknown): x is number | string {
  if (typeof x === "number") return Number.isFinite(x);
  if (typeof x === "string") return /^[0-9]+(\.[0-9]+)?$/.test(x.trim());
  return false;
}

function uiToBN(amountUi: number | string, decimals: number): BN {
  const s = String(amountUi).trim();
  const [wRaw, fRaw = ""] = s.split(".");
  const w = wRaw.replace(/\D/g, "") || "0";
  const f = ((fRaw.replace(/\D/g, "") || "") + "0".repeat(decimals)).slice(
    0,
    decimals
  );
  const base = new BN(10).pow(new BN(decimals));
  return new BN(w).mul(base).add(new BN(f));
}

function bnToUiString(amountBn: BN, decimals: number): string {
  const raw = amountBn.toString(10);
  if (decimals === 0) return raw;

  const pad = raw.padStart(decimals + 1, "0");
  const i = pad.length - decimals;

  const whole = pad.slice(0, i);
  let frac = pad.slice(i);
  frac = frac.replace(/0+$/, "");
  return frac.length ? `${whole}.${frac}` : whole;
}

function toIxDataBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(bs58.decode(data));
  throw new Error("Unsupported instruction data format");
}

/* ───────── auth / user ───────── */
async function getAuthedUserOrThrow() {
  const session = await getSessionFromCookies();
  if (!session?.sub) throw new Error("Unauthorized (missing/invalid session)");

  await connectMongo();

  const user =
    (session.userId &&
      (await User.findById(session.userId, {
        walletAddress: 1,
        privyId: 1,
        savingsAccounts: 1,
      }).lean())) ||
    (await User.findOne(
      { privyId: session.sub },
      { walletAddress: 1, privyId: 1, savingsAccounts: 1 }
    ).lean());

  if (!user?._id) throw new Error("Unauthorized (user not found)");
  if (!user.walletAddress || user.walletAddress === "pending") {
    throw new Error("User walletAddress not set yet");
  }

  return { session, user };
}

/* ───────── marginfi account reuse ───────── */
type SavingsAccountLean = { type?: string; marginfiAccountPk?: string | null };
type UserLean = { savingsAccounts?: SavingsAccountLean[] | null };

function pickFlexPkCandidates(
  userLean: UserLean,
  hint?: string | null
): string[] {
  const acc = Array.isArray(userLean?.savingsAccounts)
    ? userLean.savingsAccounts.find((a) => a?.type === "flex")
    : null;

  const out: string[] = [];

  if (typeof hint === "string" && hint.trim()) out.push(hint.trim());

  const pk1 = acc?.marginfiAccountPk;
  if (typeof pk1 === "string" && pk1.trim()) out.push(pk1.trim());

  return Array.from(new Set(out));
}

async function isValidMarginfiAccountPk(
  conn: Connection,
  pk: PublicKey
): Promise<boolean> {
  const info = await conn.getAccountInfo(pk, "confirmed");
  if (!info) return false;
  if (!info.owner.equals(MARGINFI_PROGRAM_ID)) return false;
  if (!info.data || info.data.length < 8) return false;
  return true;
}

async function resolveReusableFlexMarginfiPk(opts: {
  conn: Connection;
  userLean: UserLean;
  hint?: string | null;
}): Promise<{ pk: PublicKey | null; stale: string[] }> {
  const { conn, userLean, hint } = opts;

  const candidates = pickFlexPkCandidates(userLean, hint);
  const stale: string[] = [];

  for (const s of candidates) {
    try {
      const pk = new PublicKey(s);
      const ok = await isValidMarginfiAccountPk(conn, pk);
      if (ok) return { pk, stale };
      stale.push(s);
    } catch {
      stale.push(s);
    }
  }

  return { pk: null, stale };
}

/* ───────── tx parsing helper (PATCH) ───────── */

type DepositExtract = {
  amountBn: BN;
  owner: PublicKey;
  marginfiAccount: PublicKey;
  userUsdcAta: PublicKey;
  tokenProgram: PublicKey;
};

type LoadedAddresses = {
  readonly?: PublicKey[];
  writable?: PublicKey[];
};

type MsgWithGetAccountKeys = {
  getAccountKeys: (args: { accountKeysFromLookups: LoadedAddresses }) => {
    staticAccountKeys?: PublicKey[];
    accountKeysFromLookups?: { writable?: PublicKey[]; readonly?: PublicKey[] };
  };
};

type MsgWithStaticKeys = {
  staticAccountKeys?: PublicKey[];
};

function hasGetAccountKeys(x: unknown): x is MsgWithGetAccountKeys {
  return !!x && typeof x === "object" && "getAccountKeys" in x;
}

function hasStaticAccountKeys(x: unknown): x is MsgWithStaticKeys {
  return !!x && typeof x === "object" && "staticAccountKeys" in x;
}

type TxResp = {
  transaction?: { message?: unknown };
  meta?: {
    err?: unknown;
    loadedAddresses?: LoadedAddresses;
  };
};

function resolveAccountKeysFromTxResp(txResp: TxResp): PublicKey[] {
  const msg = txResp?.transaction?.message;
  const meta = txResp?.meta;

  const loaded: LoadedAddresses = meta?.loadedAddresses ?? {
    writable: [],
    readonly: [],
  };

  if (hasGetAccountKeys(msg) && loaded) {
    try {
      const keysObj = msg.getAccountKeys({ accountKeysFromLookups: loaded });
      const staticKeys: PublicKey[] = keysObj?.staticAccountKeys ?? [];
      const fromLookups = keysObj?.accountKeysFromLookups;
      const writable: PublicKey[] = fromLookups?.writable ?? [];
      const readonly: PublicKey[] = fromLookups?.readonly ?? [];
      return [...staticKeys, ...writable, ...readonly];
    } catch {
      // fall through
    }
  }

  const staticKeys: PublicKey[] = hasStaticAccountKeys(msg)
    ? msg.staticAccountKeys ?? []
    : [];

  return [
    ...staticKeys,
    ...(loaded.writable ?? []),
    ...(loaded.readonly ?? []),
  ];
}

async function extractMarginfiUsdcDepositFromTxSig(
  conn: Connection,
  txSig: string,
  coder: BorshInstructionCoder,
  expectedOwner: PublicKey
): Promise<DepositExtract> {
  const txResp = (await conn.getTransaction(txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  })) as unknown as TxResp;

  if (!txResp?.transaction || !txResp?.meta) {
    throw new Error("Transaction not found (or missing meta)");
  }
  if (txResp.meta.err) {
    throw new Error("Transaction failed on-chain");
  }

  const msg = txResp.transaction.message;
  const accountKeys = resolveAccountKeysFromTxResp(txResp);

  const compiledIxs =
    (
      msg as {
        compiledInstructions?: Array<{
          programIdIndex: number;
          accountKeyIndexes?: number[];
          data?: unknown;
        }>;
      }
    )?.compiledInstructions ?? [];

  for (const ix of compiledIxs) {
    const programId: PublicKey | undefined = accountKeys[ix.programIdIndex];
    if (!programId || !programId.equals(MARGINFI_PROGRAM_ID)) continue;

    const decoded = coder.decode(toIxDataBuffer(ix.data)) as
      | { name: string; data: unknown }
      | null
      | undefined;

    if (!decoded || decoded.name !== "lending_account_deposit") continue;

    const keys: PublicKey[] = (ix.accountKeyIndexes ?? []).map(
      (k: number) => accountKeys[k]
    );

    const group = keys[0];
    const marginfiAccount = keys[1];
    const owner = keys[2];
    const bank = keys[3];
    const userUsdcAta = keys[4];
    const liqVault = keys[5];
    const tokenProgram = keys[6];

    if (!group?.equals(MARGINFI_GROUP)) continue;
    if (!bank?.equals(MARGINFI_USDC_BANK)) continue;
    if (!liqVault?.equals(MARGINFI_USDC_BANK_LIQ_VAULT)) continue;

    if (!owner?.equals(expectedOwner)) {
      throw new Error("txSig owner does not match session wallet");
    }

    type LendingAccountDepositData = { amount: BN };
    const ixData = decoded.data as LendingAccountDepositData | null | undefined;

    const amountBn = ixData?.amount;
    if (!amountBn || !(amountBn instanceof BN) || amountBn.lte(new BN(0))) {
      throw new Error("Could not parse deposit amount from tx");
    }

    return {
      amountBn,
      owner,
      marginfiAccount,
      userUsdcAta,
      tokenProgram,
    };
  }

  throw new Error("Could not find lending_account_deposit instruction in tx");
}

/* ───────── POST (builder): build tx only ───────── */
export async function POST(req: NextRequest) {
  try {
    enforceOrigin(req);

    const body = (await req.json().catch(() => null)) as {
      amountUi?: number | string;
      ensureAta?: boolean;
      marginfiAccount?: string; // optional hint
    } | null;

    const ensureAta = body?.ensureAta !== false;
    const amountUiRaw = body?.amountUi;

    if (!isPlainUiAmount(amountUiRaw)) {
      return json(400, { error: "amountUi must be a plain number" });
    }
    const amountUiNum = Number(amountUiRaw);
    if (!Number.isFinite(amountUiNum) || amountUiNum <= 0) {
      return json(400, { error: "amountUi must be a positive number" });
    }

    const { user } = await getAuthedUserOrThrow();
    const owner58 = String(user.walletAddress);

    let owner: PublicKey;
    try {
      owner = new PublicKey(owner58);
    } catch {
      return json(500, { error: "Stored user walletAddress is invalid" });
    }

    const conn = new Connection(RPC, "confirmed");
    const coder = new BorshInstructionCoder(marginfiIdl as Idl);

    const mintAccountInfo = await conn.getAccountInfo(USDC_MINT, "confirmed");
    if (!mintAccountInfo) {
      return json(400, { error: "USDC mint not found on chain" });
    }

    const tokenProgram = mintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const mintForDecimals = await getMint(
      conn,
      USDC_MINT,
      "confirmed",
      tokenProgram
    );
    const decimals = mintForDecimals.decimals;

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      tokenProgram
    );

    const amountBn = uiToBN(amountUiRaw, decimals);
    const ataInfo = await conn.getAccountInfo(userUsdcAta, "confirmed");
    if (ataInfo) {
      const acc = await getAccount(
        conn,
        userUsdcAta,
        "confirmed",
        tokenProgram
      );
      const userRawBn = new BN(acc.amount.toString());
      if (userRawBn.lt(amountBn)) {
        return json(400, {
          error: "Insufficient USDC balance",
          details: {
            requiredUi: String(amountUiRaw),
            availableUi: bnToUiString(userRawBn, decimals),
          },
        });
      }
    }

    const hint =
      typeof body?.marginfiAccount === "string" && body.marginfiAccount.trim()
        ? body.marginfiAccount.trim()
        : null;

    const reuseResolved = await resolveReusableFlexMarginfiPk({
      conn,
      userLean: user,
      hint,
    });

    const reusePk = reuseResolved.pk;

    let marginfiAccountPk: PublicKey;
    let marginfiSigner: Keypair | null = null;

    if (reusePk) {
      marginfiAccountPk = reusePk;
    } else {
      marginfiSigner = Keypair.generate();
      marginfiAccountPk = marginfiSigner.publicKey;
    }

    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 86_157 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
    ];

    if (ensureAta) {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_PUBKEY,
          userUsdcAta,
          owner,
          USDC_MINT,
          tokenProgram
        )
      );
    }

    if (!reusePk) {
      const initIxData = coder.encode("marginfi_account_initialize", {});
      ixs.push({
        programId: MARGINFI_PROGRAM_ID,
        keys: [
          { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: false },
          { pubkey: marginfiAccountPk, isSigner: true, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
          { pubkey: HAVEN_PUBKEY, isSigner: true, isWritable: true },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: initIxData,
      });
    }

    const depositIxData = coder.encode("lending_account_deposit", {
      amount: amountBn,
      deposit_up_to_limit: null,
    });

    const extraRemaining = tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
      ? [{ pubkey: USDC_MINT, isSigner: false, isWritable: false }]
      : [];

    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: [
        { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: false },
        { pubkey: marginfiAccountPk, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: MARGINFI_USDC_BANK, isSigner: false, isWritable: true },
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        {
          pubkey: MARGINFI_USDC_BANK_LIQ_VAULT,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ...extraRemaining,
      ],
      data: depositIxData,
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );

    const msg2 = new TransactionMessage({
      payerKey: HAVEN_PUBKEY,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg2);

    if (marginfiSigner) tx.sign([marginfiSigner]);

    const b64 = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json(
      {
        ok: true,
        transaction: b64,
        marginfiAccount: marginfiAccountPk.toBase58(),
        userTokenAccount: userUsdcAta.toBase58(),
        feePayer: HAVEN_PUBKEY.toBase58(),
        lastValidBlockHeight,
        requiredClientSigner: owner.toBase58(),
        accountType: "flex",
        direction: "deposit",
        decimals,
        reusedExistingAccount: !!reusePk,
        staleStoredCandidates: reuseResolved.stale,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "prepare failed";
    const status = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("origin")
      ? 403
      : 500;
    return json(status, { error: msg });
  }
}

/* ───────── PATCH: persist flex.marginfiAccountPk (NO ledger writes) ───────── */

// ✅ strongly-typed mongo doc + subdoc (removes all `any`)
type SavingsAccountMongo = {
  type: "flex" | "plus" | string;
  walletAddress?: string;
  marginfiAccountPk?: string | null;

  principalDeposited?: mongoose.mongo.BSON.Decimal128;
  principalWithdrawn?: mongoose.mongo.BSON.Decimal128;
  interestWithdrawn?: mongoose.mongo.BSON.Decimal128;

  totalDeposited?: mongoose.mongo.BSON.Decimal128;
  totalWithdrawn?: mongoose.mongo.BSON.Decimal128;

  feesPaidUsdc?: mongoose.mongo.BSON.Decimal128;

  lastOnChainBalance?: unknown;
  lastSyncedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

type UserMongo = {
  _id: mongoose.Types.ObjectId;
  savingsAccounts?: SavingsAccountMongo[];
};

export async function PATCH(req: NextRequest) {
  try {
    enforceOrigin(req);

    const body = (await req.json().catch(() => null)) as {
      txSig?: string;
      marginfiAccount?: string; // optional consistency check only
    } | null;

    const txSig = body?.txSig?.trim();
    const marginfiAccountProvided = body?.marginfiAccount?.trim() || null;
    if (!txSig) return json(400, { error: "txSig is required" });

    const { session, user: userLean } = await getAuthedUserOrThrow();

    const owner58 = String(userLean.walletAddress);
    const owner = new PublicKey(owner58);

    const conn = new Connection(RPC, "confirmed");
    const coder = new BorshInstructionCoder(marginfiIdl as Idl);

    const extracted = await extractMarginfiUsdcDepositFromTxSig(
      conn,
      txSig,
      coder,
      owner
    );

    const marginfiPkTrusted = extracted.marginfiAccount.toBase58();

    if (
      marginfiAccountProvided &&
      marginfiAccountProvided !== marginfiPkTrusted
    ) {
      return json(400, { error: "marginfiAccount mismatch for txSig" });
    }

    await connectMongo();

    const userId =
      (session.userId &&
        (await User.findById(session.userId, { _id: 1 }).lean())?._id) ||
      (await User.findOne({ privyId: session.sub }, { _id: 1 }).lean())?._id;

    if (!userId) throw new Error("Unauthorized (user not found)");

    const now = new Date();

    // ✅ ensure mongoose is connected before using mongoose.connection.db
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error(
        "MongoDB not connected (mongoose.connection.db is undefined)"
      );
    }

    // ✅ typed native collection (no `any`)
    const usersCol = db.collection<UserMongo>(User.collection.name);

    const flexSubdoc: SavingsAccountMongo = {
      type: "flex",
      walletAddress: owner58,
      marginfiAccountPk: marginfiPkTrusted,

      principalDeposited: D128.fromString("0"),
      principalWithdrawn: D128.fromString("0"),
      interestWithdrawn: D128.fromString("0"),

      totalDeposited: D128.fromString("0"),
      totalWithdrawn: D128.fromString("0"),

      feesPaidUsdc: D128.fromString("0"),

      lastOnChainBalance: null,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    // Ensure flex subdoc exists (schema-agnostic, avoids mongoose PushOperator typing issues)
    await usersCol.updateOne(
      {
        _id: userId,
        savingsAccounts: { $not: { $elemMatch: { type: "flex" } } },
      },
      {
        $push: { savingsAccounts: flexSubdoc },
      }
    );

    // Persist the pk (and keep walletAddress consistent)
    await usersCol.updateOne(
      { _id: userId },
      {
        $set: {
          "savingsAccounts.$[acc].walletAddress": owner58,
          "savingsAccounts.$[acc].marginfiAccountPk": marginfiPkTrusted,
          "savingsAccounts.$[acc].lastSyncedAt": now,
          "savingsAccounts.$[acc].updatedAt": now,
        },
      },
      { arrayFilters: [{ "acc.type": "flex" }] }
    );

    return json(200, {
      ok: true,
      txSig,
      accountType: "flex",
      marginfiAccount: marginfiPkTrusted,
      userUsdcAta: extracted.userUsdcAta.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "record failed";
    const status = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("origin")
      ? 403
      : 500;
    return json(status, { error: msg });
  }
}
