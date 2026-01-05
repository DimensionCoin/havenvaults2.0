// app/api/savings/flex/open-and-deposit/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
} from "@solana/spl-token";

import { BorshInstructionCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";

import marginfiIdl from "@/lib/marginfi_idl.json";
import { getSessionFromCookies } from "@/lib/auth";
import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";

/* ───────── ENV (parsed once at module load) ───────── */

function requiredAny(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v?.trim()) return v.trim();
  }
  throw new Error(`Missing env: one of [${names.join(", ")}]`);
}

const RPC = requiredAny(["SOLANA_RPC", "NEXT_PUBLIC_SOLANA_RPC"]);
const USDC_MINT_STR = requiredAny(["USDC_MINT", "NEXT_PUBLIC_USDC_MINT"]);
const HAVEN_PUBKEY_STR = requiredAny([
  "HAVEN_FEEPAYER_ADDRESS",
  "NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS",
]);
const MARGINFI_PROGRAM_ID_STR = requiredAny(["MARGINFI_PROGRAM_ID"]);
const MARGINFI_GROUP_STR = requiredAny(["MARGINFI_GROUP"]);
const MARGINFI_USDC_BANK_STR = requiredAny(["MARGINFI_USDC_BANK"]);
const MARGINFI_USDC_BANK_LIQ_VAULT_STR = requiredAny([
  "MARGINFI_USDC_BANK_LIQ_VAULT",
]);

// Pre-parse PublicKeys at module load (avoid repeated parsing)
const USDC_MINT = new PublicKey(USDC_MINT_STR);
const HAVEN_PUBKEY = new PublicKey(HAVEN_PUBKEY_STR);
const MARGINFI_PROGRAM_ID = new PublicKey(MARGINFI_PROGRAM_ID_STR);
const MARGINFI_GROUP = new PublicKey(MARGINFI_GROUP_STR);
const MARGINFI_USDC_BANK = new PublicKey(MARGINFI_USDC_BANK_STR);
const MARGINFI_USDC_BANK_LIQ_VAULT = new PublicKey(
  MARGINFI_USDC_BANK_LIQ_VAULT_STR
);

// USDC has 6 decimals (constant, no need to fetch)
const USDC_DECIMALS = 6;

// Pre-create the instruction coder (reuse across requests)
const marginfiCoder = new BorshInstructionCoder(marginfiIdl as Idl);

// Connection singleton
let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(RPC, {
      commitment: "confirmed",
      disableRetryOnRateLimit: false,
    });
  }
  return _conn;
}

/* ───────── CONSTANTS ───────── */

// Compute units - measured from actual transactions
// Marginfi deposit uses ~35k CU + token transfer ~4k + ATA check ~10k + buffer
const COMPUTE_UNITS_DEPOSIT_ONLY = 80_000; // Deposit to existing account
const COMPUTE_UNITS_INIT_AND_DEPOSIT = 150_000; // Init new account + deposit
const PRIORITY_FEE_MICROLAMPORTS = 50_000; // ~0.005 SOL priority fee

// Token program cache
const tokenProgramCache = new Map<string, PublicKey>();

const D128 = mongoose.Types.Decimal128;

/* ───────── HELPERS ───────── */

function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) {
    console.error(
      "[savings/flex/open-and-deposit]",
      status,
      body.error || body.code
    );
  }
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function enforceOrigin(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return;

  const allowed = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!allowed) return;

  let allowedOrigin: string | null = null;
  try {
    allowedOrigin = new URL(allowed).origin;
  } catch {
    return;
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) {
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
  const frac = pad.slice(i).replace(/0+$/, "");
  return frac.length ? `${whole}.${frac}` : whole;
}

async function getTokenProgramId(
  conn: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const key = mint.toBase58();
  const cached = tokenProgramCache.get(key);
  if (cached) return cached;

  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found: ${key}`);

  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  tokenProgramCache.set(key, programId);
  return programId;
}

/* ───────── AUTH ───────── */

async function getAuthedUserOrThrow() {
  const session = await getSessionFromCookies();
  if (!session?.sub) throw new Error("Unauthorized");

  await connectMongo();

  const projection = { walletAddress: 1, privyId: 1, savingsAccounts: 1 };

  const user = session.userId
    ? await User.findById(session.userId, projection).lean()
    : await User.findOne({ privyId: session.sub }, projection).lean();

  if (!user?._id) throw new Error("Unauthorized");
  if (!user.walletAddress || user.walletAddress === "pending") {
    throw new Error("Wallet not set");
  }

  return { session, user };
}

/* ───────── MARGINFI ACCOUNT RESOLUTION ───────── */

type SavingsAccountLean = { type?: string; marginfiAccountPk?: string | null };
type UserLean = { savingsAccounts?: SavingsAccountLean[] | null };

function pickFlexPkCandidates(
  userLean: UserLean,
  hint?: string | null
): string[] {
  const out: string[] = [];

  if (hint?.trim()) out.push(hint.trim());

  const acc = userLean?.savingsAccounts?.find((a) => a?.type === "flex");
  if (acc?.marginfiAccountPk?.trim()) {
    out.push(acc.marginfiAccountPk.trim());
  }

  return [...new Set(out)];
}

async function resolveReusableFlexMarginfiPk(
  conn: Connection,
  userLean: UserLean,
  hint?: string | null
): Promise<{ pk: PublicKey | null; stale: string[] }> {
  const candidates = pickFlexPkCandidates(userLean, hint);
  const stale: string[] = [];

  for (const s of candidates) {
    try {
      const pk = new PublicKey(s);
      const info = await conn.getAccountInfo(pk, "confirmed");

      // Valid if: exists, owned by marginfi program, has data
      if (
        info &&
        info.owner.equals(MARGINFI_PROGRAM_ID) &&
        info.data?.length >= 8
      ) {
        return { pk, stale };
      }
      stale.push(s);
    } catch {
      stale.push(s);
    }
  }

  return { pk: null, stale };
}

/* ───────── POST: BUILD TRANSACTION ───────── */

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    enforceOrigin(req);

    const body = (await req.json().catch(() => null)) as {
      amountUi?: number | string;
      ensureAta?: boolean;
      marginfiAccount?: string;
    } | null;

    const ensureAta = body?.ensureAta !== false;
    const amountUiRaw = body?.amountUi;

    if (!isPlainUiAmount(amountUiRaw)) {
      return json(400, { error: "amountUi must be a positive number" });
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
      return json(500, { error: "Invalid wallet address" });
    }

    const conn = getConnection();

    const hint = body?.marginfiAccount?.trim() || null;

    /* ═══════════════════════════════════════════════════════════════
       PARALLEL RPC CALLS - This is the main optimization
       Instead of sequential calls, we batch everything possible
    ═══════════════════════════════════════════════════════════════ */

    const [tokenProgram, reuseResolved, blockhashData] = await Promise.all([
      // 1. Get token program (cached after first call)
      getTokenProgramId(conn, USDC_MINT),

      // 2. Check if user has existing marginfi account
      resolveReusableFlexMarginfiPk(conn, user, hint),

      // 3. Get blockhash
      conn.getLatestBlockhash("confirmed"),
    ]);

    // Derive ATA (sync, no RPC needed)
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      tokenProgram
    );

    // Convert amount to BN
    const amountBn = uiToBN(amountUiRaw, USDC_DECIMALS);

    // Check balance (only if ATA might exist)
    const ataInfo = await conn.getAccountInfo(userUsdcAta, "confirmed");
    if (ataInfo && ataInfo.data) {
      // Parse token account balance directly from data (faster than getAccount)
      // Token account layout: mint (32) + owner (32) + amount (8) = offset 64
      const amountBytes = ataInfo.data.slice(64, 72);
      const balance = new BN(amountBytes, "le");

      if (balance.lt(amountBn)) {
        return json(400, {
          error: "Insufficient USDC balance",
          code: "INSUFFICIENT_BALANCE",
          details: {
            required: bnToUiString(amountBn, USDC_DECIMALS),
            available: bnToUiString(balance, USDC_DECIMALS),
          },
        });
      }
    }

    // Determine if we need to init a new marginfi account
    const reusePk = reuseResolved.pk;
    let marginfiAccountPk: PublicKey;
    let marginfiSigner: Keypair | null = null;

    if (reusePk) {
      marginfiAccountPk = reusePk;
    } else {
      marginfiSigner = Keypair.generate();
      marginfiAccountPk = marginfiSigner.publicKey;
    }

    const needsInit = !reusePk;
    const computeUnits = needsInit
      ? COMPUTE_UNITS_INIT_AND_DEPOSIT
      : COMPUTE_UNITS_DEPOSIT_ONLY;

    /* ═══════════════════════════════════════════════════════════════
       BUILD INSTRUCTIONS - Optimized order for compute efficiency
    ═══════════════════════════════════════════════════════════════ */

    const ixs: TransactionInstruction[] = [
      // 1. Set compute unit limit FIRST (helps validator estimation)
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),

      // 2. Set priority fee
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_FEE_MICROLAMPORTS,
      }),
    ];

    // 3. Ensure ATA exists (idempotent, safe to always include)
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

    // 4. Init marginfi account (if needed)
    if (needsInit) {
      const initIxData = marginfiCoder.encode(
        "marginfi_account_initialize",
        {}
      );
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

    // 5. Deposit instruction
    const depositIxData = marginfiCoder.encode("lending_account_deposit", {
      amount: amountBn,
      deposit_up_to_limit: null,
    });

    // TOKEN_2022 requires mint as remaining account
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

    /* ═══════════════════════════════════════════════════════════════
       COMPILE & SERIALIZE
    ═══════════════════════════════════════════════════════════════ */

    const { blockhash, lastValidBlockHeight } = blockhashData;

    const message = new TransactionMessage({
      payerKey: HAVEN_PUBKEY,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);

    // Sign with marginfi account keypair if initializing
    if (marginfiSigner) {
      tx.sign([marginfiSigner]);
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    const buildTime = Date.now() - startTime;

    console.log(
      `[savings/deposit] ${buildTime}ms | ${needsInit ? "INIT+" : ""}DEPOSIT | ${bnToUiString(amountBn, USDC_DECIMALS)} USDC | CU=${computeUnits}`
    );

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
        decimals: USDC_DECIMALS,
        reusedExistingAccount: !!reusePk,
        staleStoredCandidates: reuseResolved.stale,
        computeUnits,
        buildTimeMs: buildTime,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Build failed";
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized")
      ? 401
      : lower.includes("origin")
        ? 403
        : 500;
    return json(status, { error: msg });
  }
}

/* ───────── PATCH: RECORD DEPOSIT ───────── */

type DepositExtract = {
  amountBn: BN;
  owner: PublicKey;
  marginfiAccount: PublicKey;
  userUsdcAta: PublicKey;
  tokenProgram: PublicKey;
};

async function extractMarginfiUsdcDepositFromTxSig(
  conn: Connection,
  txSig: string,
  expectedOwner: PublicKey
): Promise<DepositExtract> {
  const txResp = await conn.getTransaction(txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!txResp?.transaction || !txResp?.meta) {
    throw new Error("Transaction not found");
  }
  if (txResp.meta.err) {
    throw new Error("Transaction failed on-chain");
  }

  const msg = txResp.transaction.message;
  const loaded = txResp.meta.loadedAddresses ?? { writable: [], readonly: [] };

  // Cast message to access properties that vary between legacy and versioned transactions
  const msgAny = msg as unknown as {
    staticAccountKeys?: PublicKey[];
    accountKeys?: PublicKey[];
    compiledInstructions?: Array<{
      programIdIndex: number;
      accountKeyIndexes: number[];
      data: Uint8Array;
    }>;
  };

  // Get account keys - handle both legacy and versioned transactions
  const staticKeys: PublicKey[] =
    msgAny.staticAccountKeys ?? msgAny.accountKeys ?? [];

  const accountKeys: PublicKey[] = [
    ...staticKeys,
    ...(loaded.writable ?? []),
    ...(loaded.readonly ?? []),
  ];

  // Get compiled instructions
  const compiledIxs = msgAny.compiledInstructions ?? [];

  for (const ix of compiledIxs) {
    const programId = accountKeys[ix.programIdIndex];
    if (!programId?.equals?.(MARGINFI_PROGRAM_ID)) continue;

    const decoded = marginfiCoder.decode(Buffer.from(ix.data)) as {
      name: string;
      data: { amount?: BN };
    } | null;

    if (!decoded || decoded.name !== "lending_account_deposit") continue;

    const keys = (ix.accountKeyIndexes ?? []).map((k) => accountKeys[k]);
    const [
      group,
      marginfiAccount,
      owner,
      bank,
      userUsdcAta,
      liqVault,
      tokenProgram,
    ] = keys;

    if (!group?.equals(MARGINFI_GROUP)) continue;
    if (!bank?.equals(MARGINFI_USDC_BANK)) continue;
    if (!liqVault?.equals(MARGINFI_USDC_BANK_LIQ_VAULT)) continue;
    if (!owner?.equals(expectedOwner)) {
      throw new Error("Owner mismatch");
    }

    const amountBn = decoded.data?.amount;
    if (!amountBn || !(amountBn instanceof BN) || amountBn.lte(new BN(0))) {
      throw new Error("Invalid deposit amount");
    }

    return { amountBn, owner, marginfiAccount, userUsdcAta, tokenProgram };
  }

  throw new Error("Deposit instruction not found in tx");
}

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
  const startTime = Date.now();

  try {
    enforceOrigin(req);

    const body = (await req.json().catch(() => null)) as {
      txSig?: string;
      marginfiAccount?: string;
    } | null;

    const txSig = body?.txSig?.trim();
    const marginfiAccountProvided = body?.marginfiAccount?.trim() || null;

    if (!txSig) {
      return json(400, { error: "txSig is required" });
    }

    const { session, user: userLean } = await getAuthedUserOrThrow();
    const owner58 = String(userLean.walletAddress);
    const owner = new PublicKey(owner58);

    const conn = getConnection();

    const extracted = await extractMarginfiUsdcDepositFromTxSig(
      conn,
      txSig,
      owner
    );
    const marginfiPkTrusted = extracted.marginfiAccount.toBase58();

    if (
      marginfiAccountProvided &&
      marginfiAccountProvided !== marginfiPkTrusted
    ) {
      return json(400, { error: "marginfiAccount mismatch" });
    }

    await connectMongo();

    const userId = session.userId
      ? (await User.findById(session.userId, { _id: 1 }).lean())?._id
      : (await User.findOne({ privyId: session.sub }, { _id: 1 }).lean())?._id;

    if (!userId) throw new Error("Unauthorized");

    const now = new Date();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB not connected");

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

    // Upsert flex subdoc if not exists
    await usersCol.updateOne(
      {
        _id: userId,
        savingsAccounts: { $not: { $elemMatch: { type: "flex" } } },
      },
      { $push: { savingsAccounts: flexSubdoc } }
    );

    // Update existing flex subdoc
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

    const patchTime = Date.now() - startTime;
    console.log(`[savings/record] ${patchTime}ms | ${txSig.slice(0, 8)}...`);

    return json(200, {
      ok: true,
      txSig,
      accountType: "flex",
      marginfiAccount: marginfiPkTrusted,
      userUsdcAta: extracted.userUsdcAta.toBase58(),
      recordTimeMs: patchTime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Record failed";
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized")
      ? 401
      : lower.includes("origin")
        ? 403
        : 500;
    return json(status, { error: msg });
  }
}
