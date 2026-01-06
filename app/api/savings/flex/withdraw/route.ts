// app/api/savings/flex/withdraw/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  type Idl,
} from "@coral-xyz/anchor";

import BN from "bn.js";
import { Buffer } from "buffer";
import { createHash } from "crypto";

import marginfiIdl from "@/lib/marginfi_idl.json";
import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";
import { getSessionFromCookies } from "@/lib/auth";

/* ───────── ENV (parsed once at module load) ───────── */

function requiredAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v?.trim()) return v.trim();
  }
  throw new Error(`Missing env: one of [${names.join(", ")}]`);
}

const RPC = requiredAny(["SOLANA_RPC", "NEXT_PUBLIC_SOLANA_RPC"]);
const USDC_MINT_STR = requiredAny(["USDC_MINT", "NEXT_PUBLIC_USDC_MINT"]);
const HAVEN_FEEPAYER_STR = requiredAny([
  "HAVEN_FEEPAYER_ADDRESS",
  "NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS",
]);
const TREASURY_OWNER_STR = requiredAny([
  "TREASURY_OWNER",
  "NEXT_PUBLIC_APP_TREASURY_OWNER",
]);
const MARGINFI_PROGRAM_ID_STR = requiredAny(["MARGINFI_PROGRAM_ID"]);
const MARGINFI_GROUP_STR = requiredAny(["MARGINFI_GROUP"]);

// Pre-parse PublicKeys at module load
const USDC_MINT = new PublicKey(USDC_MINT_STR);
const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);
const MARGINFI_PROGRAM_ID = new PublicKey(MARGINFI_PROGRAM_ID_STR);
const MARGINFI_GROUP = new PublicKey(MARGINFI_GROUP_STR);

// USDC has 6 decimals (constant)
const USDC_DECIMALS = 6;

// Pre-create coders (reuse across requests)
const acctCoder = new BorshAccountsCoder(marginfiIdl as Idl);
const ixCoder = new BorshInstructionCoder(marginfiIdl as Idl);

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

// FeeState PDA (computed once)
const [FEE_STATE_PK] = PublicKey.findProgramAddressSync(
  [Buffer.from("feestate")],
  MARGINFI_PROGRAM_ID
);

/* ───────── CONSTANTS ───────── */

// Compute units - withdraw is heavier than deposit due to remaining accounts
const COMPUTE_UNITS_WITHDRAW = 200_000;
const COMPUTE_UNITS_WITHDRAW_WITH_FEE = 220_000;
const PRIORITY_FEE_MICROLAMPORTS = 50_000;

// Token program cache
const tokenProgramCache = new Map<string, PublicKey>();

// Bank oracle cache (5 min TTL)
const bankOracleCache = new Map<string, { oracle: PublicKey; at: number }>();
const BANK_CACHE_TTL = 5 * 60 * 1000;

/* ───────── HELPERS ───────── */

function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) {
    console.error("[savings/flex/withdraw]", status, body.error || body.code);
  }
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

function getWithdrawFeeRate(): number {
  const raw = Number(process.env.NEXT_PUBLIC_FLEX_WITHDRAW_FEE_UI ?? "0");
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function feeFromAmountBase(amountBase: BN, feeRate: number): BN {
  if (!feeRate) return new BN(0);
  const ppm = Math.max(0, Math.round(feeRate * 1_000_000));
  if (!ppm) return new BN(0);
  return amountBase.muln(ppm).divn(1_000_000);
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

  if (!user?._id || !user.walletAddress) throw new Error("Unauthorized");
  return user;
}

type SavingsAccountLean = { type?: string; marginfiAccountPk?: string | null };
type UserLean = { savingsAccounts?: SavingsAccountLean[] | null };

function getFlexMarginfiAccountPk(userLean: UserLean): string | null {
  const flex = userLean?.savingsAccounts?.find((a) => a?.type === "flex");
  return flex?.marginfiAccountPk?.trim() || null;
}

/* ───────── MARGINFI DECODE HELPERS ───────── */

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumberArray = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((n) => typeof n === "number")
    ? (value as number[])
    : null;

const getNestedRecord = (
  value: UnknownRecord,
  key: string
): UnknownRecord | null => {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
};

function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

function tryDecodeAny(
  coder: BorshAccountsCoder,
  data: Buffer,
  names: string[]
): { name: string; decoded: UnknownRecord } | null {
  for (const name of names) {
    try {
      const decoded = coder.decode(name, data) as unknown;
      if (isRecord(decoded)) return { name, decoded };
    } catch {
      // continue
    }
  }
  return null;
}

function decodeByDisc(
  coder: BorshAccountsCoder,
  data: Buffer
): { name: string; decoded: UnknownRecord } {
  const maybeIdl = (coder as unknown as { idl?: Idl }).idl;
  if (!maybeIdl) throw new Error("BorshAccountsCoder missing idl property");

  const disc = data.subarray(0, 8);

  // Try common names first
  const quick = tryDecodeAny(coder, data, [
    "MarginfiAccount",
    "MarginfiGroup",
    "Bank",
    "marginfiAccount",
    "marginfiGroup",
    "bank",
  ]);
  if (quick) return quick;

  // Fall back to discriminator matching
  for (const acc of maybeIdl.accounts ?? []) {
    if (accountDiscriminator(acc.name).equals(disc)) {
      const decoded = coder.decode(acc.name, data) as unknown;
      if (!isRecord(decoded)) throw new Error(`Decoded ${acc.name} not object`);
      return { name: acc.name, decoded };
    }
  }
  throw new Error("Unknown account discriminator");
}

const toB58 = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    try {
      return new PublicKey(value).toBase58();
    } catch {
      return null;
    }
  }
  const toBase58Method = (value as { toBase58?: unknown }).toBase58;
  if (typeof toBase58Method === "function") {
    try {
      return toBase58Method.call(value as unknown);
    } catch {
      return null;
    }
  }
  if (
    isRecord(value) &&
    typeof (value as { data?: unknown }).data === "string"
  ) {
    return String((value as { data?: unknown }).data);
  }
  return null;
};

function extractBalanceInfo(entry: UnknownRecord) {
  const activeValue =
    entry["active"] ??
    entry["isActive"] ??
    entry["Active"] ??
    entry["activeFlag"];
  const active = Boolean(activeValue);

  const sharesCandidate =
    entry["asset_shares"] ??
    entry["assetShares"] ??
    entry["assets_shares"] ??
    entry["assetsShares"] ??
    entry["assets"] ??
    entry["deposit_shares"] ??
    entry["depositShares"];

  let assetShares: BN | null = null;
  if (sharesCandidate instanceof BN) {
    assetShares = sharesCandidate;
  } else {
    const sharesValue = isRecord(sharesCandidate)
      ? sharesCandidate["value"]
      : sharesCandidate;
    const arr = asNumberArray(sharesValue);
    if (arr) {
      assetShares = new BN(Uint8Array.from(arr), "le");
    }
  }

  const bankPk = toB58(entry["bank_pk"] ?? entry["bankPk"] ?? entry["bank"]);
  return { active, bankPk, assetShares };
}

/* ───────── BANK INFO EXTRACTION (with caching) ───────── */

type BankInfo = {
  bankPk: PublicKey;
  oraclePk: PublicKey;
  liquidityVault: PublicKey;
  mint: string;
  group: string;
};

async function getBankInfo(
  conn: Connection,
  bankPk: PublicKey
): Promise<BankInfo | null> {
  const key = bankPk.toBase58();
  const now = Date.now();

  // Check cache for oracle
  const cached = bankOracleCache.get(key);

  const info = await conn.getAccountInfo(bankPk, "confirmed");
  if (!info?.data || !info.owner.equals(MARGINFI_PROGRAM_ID)) return null;

  const { decoded: bankAny } = decodeByDisc(acctCoder, info.data);
  const bankConfig = getNestedRecord(bankAny, "config");

  const group =
    toB58(bankAny["group"]) ??
    (bankConfig ? toB58(bankConfig["group"]) : null) ??
    toB58(bankAny["bankGroup"]);
  const mint =
    toB58(bankAny["mint"]) ??
    (bankConfig ? toB58(bankConfig["mint"]) : null) ??
    toB58(bankAny["bankMint"]);
  const vaultB58 = toB58(
    bankAny["liquidity_vault"] ?? bankAny["liquidityVault"]
  );

  if (!group || !mint || !vaultB58) return null;

  // Use cached oracle if fresh
  let oraclePk: PublicKey | null = null;
  if (cached && now - cached.at < BANK_CACHE_TTL) {
    oraclePk = cached.oracle;
  } else {
    const oracleKeysSource =
      bankAny["oracle_keys"] ??
      bankAny["oracleKeys"] ??
      (bankConfig
        ? (bankConfig["oracle_keys"] ?? bankConfig["oracleKeys"])
        : null) ??
      [];

    const oracleKeys = (Array.isArray(oracleKeysSource) ? oracleKeysSource : [])
      .map(toB58)
      .filter((k): k is string => typeof k === "string");

    const defaultKey = PublicKey.default.toBase58();
    const oracleB58 = oracleKeys.find((k) => k !== defaultKey);

    if (oracleB58) {
      oraclePk = new PublicKey(oracleB58);
      bankOracleCache.set(key, { oracle: oraclePk, at: now });
    }
  }

  if (!oraclePk) return null;

  return {
    bankPk,
    oraclePk,
    liquidityVault: new PublicKey(vaultB58),
    mint,
    group,
  };
}

/* ───────── TRANSFER CHECKED IX (no BigInt) ───────── */

function makeTransferCheckedIx(opts: {
  tokenProgramId: PublicKey;
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amountBase: BN;
  decimals: number;
}): TransactionInstruction {
  const {
    tokenProgramId,
    source,
    mint,
    destination,
    authority,
    amountBase,
    decimals,
  } = opts;

  // SPL Token instruction enum: TransferChecked = 12
  const data = Buffer.concat([
    Buffer.from([12]),
    amountBase.toArrayLike(Buffer, "le", 8),
    Buffer.from([decimals & 0xff]),
  ]);

  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/* ───────── POST: BUILD WITHDRAW TRANSACTION ───────── */

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body = (await req.json().catch(() => null)) as {
      amountUi?: number;
      withdrawAll?: boolean;
      ensureAta?: boolean;
    } | null;

    const withdrawAllRequested = body?.withdrawAll === true;
    const ensureAta = body?.ensureAta !== false;

    const amountUi = Number(body?.amountUi);
    if (!Number.isFinite(amountUi) || amountUi <= 0) {
      return json(400, { error: "amountUi is required and must be > 0" });
    }

    const user = await getAuthedUserOrThrow();
    const marginfiAccountPkStr = getFlexMarginfiAccountPk(user);
    if (!marginfiAccountPkStr) {
      return json(404, { error: "No flex savings account found" });
    }

    const owner = new PublicKey(user.walletAddress as string);
    const marginfiAccountPk = new PublicKey(marginfiAccountPkStr);

    const conn = getConnection();

    /* ═══════════════════════════════════════════════════════════════
       PARALLEL RPC CALLS - Batch initial lookups
    ═══════════════════════════════════════════════════════════════ */

    const [tokenProgram, mAccInfo, blockhashData] = await Promise.all([
      getTokenProgramId(conn, USDC_MINT),
      conn.getAccountInfo(marginfiAccountPk, "confirmed"),
      conn.getLatestBlockhash("confirmed"),
    ]);

    if (!mAccInfo?.data) {
      return json(404, { error: "Savings account not found on chain" });
    }
    if (!mAccInfo.owner.equals(MARGINFI_PROGRAM_ID)) {
      return json(500, { error: "Invalid savings account owner" });
    }

    // Decode marginfi account
    const { decoded: mAcc } = decodeByDisc(acctCoder, mAccInfo.data);

    // Extract balances
    const balancesSrc =
      (isRecord(mAcc["lending_account"])
        ? (mAcc["lending_account"] as UnknownRecord)["balances"]
        : undefined) ??
      mAcc["balances"] ??
      (isRecord(mAcc["lendingAccount"])
        ? (mAcc["lendingAccount"] as UnknownRecord)["balances"]
        : undefined) ??
      [];

    const balances: UnknownRecord[] = Array.isArray(balancesSrc)
      ? balancesSrc.filter(isRecord)
      : [];

    // Derive ATAs (sync, no RPC)
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      tokenProgram
    );
    const treasuryUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      TREASURY_OWNER,
      false,
      tokenProgram
    );

    /* ═══════════════════════════════════════════════════════════════
       FIND USDC BANK AND BUILD REMAINING ACCOUNTS
    ═══════════════════════════════════════════════════════════════ */

    // Collect all active bank PKs first
    const activeBankPks: PublicKey[] = [];
    for (const b of balances) {
      const { active, bankPk, assetShares } = extractBalanceInfo(b);
      if (active && bankPk && assetShares && !assetShares.isZero()) {
        activeBankPks.push(new PublicKey(bankPk));
      }
    }

    // Fetch all bank infos in parallel
    const bankInfoPromises = activeBankPks.map((pk) => getBankInfo(conn, pk));
    const bankInfoResults = await Promise.all(bankInfoPromises);

    // Filter valid banks in our group
    const validBanks = bankInfoResults.filter(
      (info): info is BankInfo =>
        info !== null && info.group === MARGINFI_GROUP.toBase58()
    );

    // Find USDC bank
    const usdcBank = validBanks.find(
      (info) => info.mint === USDC_MINT.toBase58()
    );
    if (!usdcBank) {
      return json(400, {
        error: "No active USDC balance found in savings account",
        code: "NO_USDC_BALANCE",
      });
    }

    // Build remaining accounts: [bank, oracle] pairs, USDC bank first
    const remainingPairs: Array<[PublicKey, PublicKey]> = [];

    // Add USDC bank first
    remainingPairs.push([usdcBank.bankPk, usdcBank.oraclePk]);

    // Add other banks
    for (const info of validBanks) {
      if (!info.bankPk.equals(usdcBank.bankPk)) {
        remainingPairs.push([info.bankPk, info.oraclePk]);
      }
    }

    // Build remaining metas
    const remainingMetas = remainingPairs.flat().map((pubkey) => ({
      pubkey,
      isSigner: false as const,
      isWritable: false as const,
    }));

    // TOKEN_2022 requires mint in remaining accounts
    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      remainingMetas.unshift({
        pubkey: USDC_MINT,
        isSigner: false as const,
        isWritable: false as const,
      });
    }

    // Add fee state PDA
    remainingMetas.push({
      pubkey: FEE_STATE_PK,
      isSigner: false as const,
      isWritable: false as const,
    });

    /* ═══════════════════════════════════════════════════════════════
       FEE CALCULATION
    ═══════════════════════════════════════════════════════════════ */

    const feeRate = getWithdrawFeeRate();
    const amountBase = uiToBN(amountUi, USDC_DECIMALS);
    const feeBase = feeFromAmountBase(amountBase, feeRate);
    const netBase = BN.max(new BN(0), amountBase.sub(feeBase));

    // withdraw_all only safe when no fee (otherwise amount unknown)
    const withdrawAllUsed = withdrawAllRequested && feeRate === 0;
    const hasFee = !feeBase.isZero();

    const computeUnits = hasFee
      ? COMPUTE_UNITS_WITHDRAW_WITH_FEE
      : COMPUTE_UNITS_WITHDRAW;

    /* ═══════════════════════════════════════════════════════════════
       BUILD INSTRUCTIONS
    ═══════════════════════════════════════════════════════════════ */

    // Derive liquidity vault auth PDA
    const [bankLiquidityVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity_vault_auth"), usdcBank.bankPk.toBuffer()],
      MARGINFI_PROGRAM_ID
    );

    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_FEE_MICROLAMPORTS,
      }),
    ];

    // Ensure ATAs exist
    if (ensureAta) {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_FEEPAYER,
          userUsdcAta,
          owner,
          USDC_MINT,
          tokenProgram
        )
      );
      if (hasFee) {
        ixs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            treasuryUsdcAta,
            TREASURY_OWNER,
            USDC_MINT,
            tokenProgram
          )
        );
      }
    }

    // Withdraw instruction
    const withdrawIxData = ixCoder.encode("lending_account_withdraw", {
      amount: withdrawAllUsed ? new BN(0) : amountBase,
      withdraw_all: withdrawAllUsed ? true : null,
    });

    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: [
        { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: true },
        { pubkey: marginfiAccountPk, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: usdcBank.bankPk, isSigner: false, isWritable: true },
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        { pubkey: bankLiquidityVaultAuth, isSigner: false, isWritable: false },
        { pubkey: usdcBank.liquidityVault, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ...remainingMetas,
      ],
      data: withdrawIxData,
    });

    // Fee transfer (after withdraw)
    if (hasFee) {
      ixs.push(
        makeTransferCheckedIx({
          tokenProgramId: tokenProgram,
          source: userUsdcAta,
          mint: USDC_MINT,
          destination: treasuryUsdcAta,
          authority: owner,
          amountBase: feeBase,
          decimals: USDC_DECIMALS,
        })
      );
    }

    /* ═══════════════════════════════════════════════════════════════
       COMPILE & SERIALIZE
    ═══════════════════════════════════════════════════════════════ */

    const { blockhash, lastValidBlockHeight } = blockhashData;

    const message = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    const b64 = Buffer.from(tx.serialize()).toString("base64");

    const buildTime = Date.now() - startTime;
    console.log(
      `[savings/withdraw] ${buildTime}ms | ${bnToUiString(amountBase, USDC_DECIMALS)} USDC | fee=${bnToUiString(feeBase, USDC_DECIMALS)} | CU=${computeUnits}`
    );

    return json(200, {
      ok: true,
      transaction: b64,

      direction: "withdraw",
      accountType: "flex",

      requiredClientSigner: owner.toBase58(),
      feePayer: HAVEN_FEEPAYER.toBase58(),
      treasuryOwner: TREASURY_OWNER.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      treasuryUsdcAta: treasuryUsdcAta.toBase58(),
      marginfiAccount: marginfiAccountPk.toBase58(),
      bank: usdcBank.bankPk.toBase58(),

      decimals: USDC_DECIMALS,
      amountUi: bnToUiString(amountBase, USDC_DECIMALS),
      feeUi: bnToUiString(feeBase, USDC_DECIMALS),
      netUi: bnToUiString(netBase, USDC_DECIMALS),
      feeRate,

      withdrawAllRequested,
      withdrawAllUsed,

      lastValidBlockHeight,
      remainingCount: remainingMetas.length,
      computeUnits,
      buildTimeMs: buildTime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized") ? 401 : 500;
    return json(status, { error: msg || "Unknown error" });
  }
}
