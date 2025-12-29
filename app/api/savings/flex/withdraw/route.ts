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
  getMint,
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

/* ───────── response helper ───────── */
function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) console.error("[/api/savings/flex/withdraw]", body);
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requiredAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  throw new Error(`Missing env: one of [${names.join(", ")}]`);
}

/* ───────── numeric helpers (BN only) ───────── */
function uiToBN(amountUi: number | string, decimals: number): BN {
  const s = String(amountUi);
  const [wRaw, fRaw = ""] = s.split(".");
  const w = wRaw.replace(/\D/g, "") || "0";
  const f = ((fRaw.replace(/\D/g, "") || "") + "0".repeat(decimals)).slice(
    0,
    decimals
  );
  const base = new BN(10).pow(new BN(decimals));
  return new BN(w).mul(base).add(new BN(f));
}

function bnToUiString(base: BN, decimals: number): string {
  const raw = base.toString(10);
  if (decimals <= 0) return raw;

  const pad = raw.padStart(decimals + 1, "0");
  const i = pad.length - decimals;
  const whole = pad.slice(0, i);
  const frac = pad.slice(i).replace(/0+$/, "");
  return frac.length ? `${whole}.${frac}` : whole;
}

// env is a fraction like 0.005 = 0.5%
function getWithdrawFeeRate(): number {
  const raw = Number(process.env.NEXT_PUBLIC_FLEX_WITHDRAW_FEE_UI ?? "0");
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
}

function feeFromAmountBase(amountBase: BN, feeRate: number): BN {
  if (!feeRate) return new BN(0);
  const ppm = Math.max(0, Math.round(feeRate * 1_000_000));
  if (!ppm) return new BN(0);
  return amountBase.muln(ppm).divn(1_000_000);
}

/* ───────── token program detection ───────── */
async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("USDC mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ───────── auth / user ───────── */
async function getAuthedUserOrThrow() {
  const session = await getSessionFromCookies();
  if (!session?.sub) throw new Error("Unauthorized");

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

  if (!user?._id || !user.walletAddress) throw new Error("Unauthorized");
  return user;
}

type SavingsAccountLean = { type?: string; marginfiAccountPk?: string | null };
type UserLean = { savingsAccounts?: SavingsAccountLean[] | null };

function getFlexMarginfiAccountPk(userLean: UserLean): string | null {
  const flex = Array.isArray(userLean?.savingsAccounts)
    ? userLean.savingsAccounts.find((a) => a?.type === "flex")
    : null;

  const pk =
    typeof flex?.marginfiAccountPk === "string" && flex.marginfiAccountPk.trim()
      ? flex.marginfiAccountPk.trim()
      : null;

  return pk;
}

/* ───────── marginfi decode helpers ───────── */
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
    } catch {}
  }
  return null;
}

function decodeByDisc(
  coder: BorshAccountsCoder,
  data: Buffer
): { name: string; decoded: UnknownRecord } {
  const maybeIdl = (coder as unknown as { idl?: Idl }).idl;
  if (!maybeIdl) throw new Error("BorshAccountsCoder missing idl property");

  const idl = maybeIdl;
  const disc = data.subarray(0, 8);

  const quick = tryDecodeAny(coder, data, [
    "MarginfiAccount",
    "MarginfiGroup",
    "Bank",
    "marginfiAccount",
    "marginfiGroup",
    "bank",
  ]);
  if (quick) return quick;

  for (const acc of idl.accounts ?? []) {
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
  if (isRecord(value) && typeof (value as { data?: unknown }).data === "string")
    return String((value as { data?: unknown }).data);
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
    if (!assetShares && arr) {
      assetShares = new BN(Uint8Array.from(arr), "le");
    }
  }

  const bankPk = toB58(entry["bank_pk"] ?? entry["bankPk"] ?? entry["bank"]);
  return { active, bankPk, assetShares };
}

async function collectRemainingPairs(
  conn: Connection,
  acctCoder: BorshAccountsCoder,
  balances: UnknownRecord[],
  groupPk: PublicKey
): Promise<Array<[PublicKey, PublicKey]>> {
  const pairs: Array<[PublicKey, PublicKey]> = [];

  for (const b of balances) {
    const { active, bankPk, assetShares } = extractBalanceInfo(b);
    if (!active || !bankPk || !assetShares || assetShares.isZero()) continue;

    const bankPubkey = new PublicKey(bankPk);
    const info = await conn.getAccountInfo(bankPubkey, "confirmed");
    if (!info?.data) continue;

    const { decoded: bankAny } = decodeByDisc(acctCoder, info.data);
    const bankConfig = getNestedRecord(bankAny, "config");

    const bankGroup =
      toB58(bankAny["group"]) ??
      (bankConfig ? toB58(bankConfig["group"]) : null) ??
      toB58(bankAny["bankGroup"]);
    if (bankGroup !== groupPk.toBase58()) continue;

    const oracleKeysSource =
      bankAny["oracle_keys"] ??
      bankAny["oracleKeys"] ??
      (bankConfig
        ? bankConfig["oracle_keys"] ?? bankConfig["oracleKeys"]
        : null) ??
      [];

    const oracleKeys = (Array.isArray(oracleKeysSource) ? oracleKeysSource : [])
      .map(toB58)
      .filter((key): key is string => typeof key === "string");

    const defaultKey = PublicKey.default.toBase58();
    const oracleB58 = oracleKeys.find((key) => key !== defaultKey);
    if (!oracleB58) continue;

    pairs.push([bankPubkey, new PublicKey(oracleB58)]);
  }

  return pairs;
}

/* ───────── NO-BigInt TransferChecked builder ───────── */
function makeTransferCheckedIxNoBigInt(opts: {
  tokenProgramId: PublicKey;
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amountBase: BN;
  decimals: number;
}) {
  const { tokenProgramId, source, mint, destination, authority, amountBase } =
    opts;

  // SPL Token instruction enum: TransferChecked = 12
  const ix = 12;

  const amtLE = amountBase.toArrayLike(Buffer, "le", 8);
  const dec = Buffer.from([opts.decimals & 0xff]);
  const data = Buffer.concat([Buffer.from([ix]), amtLE, dec]);

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

/* ───────── route ───────── */
export async function POST(req: NextRequest) {
  try {
    const RPC = requiredAny(["NEXT_PUBLIC_SOLANA_RPC", "SOLANA_RPC"]);
    const USDC_MINT_STR = requiredAny(["NEXT_PUBLIC_USDC_MINT"]);
    const HAVEN_FEEPAYER_STR = requiredAny([
      "NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS",
    ]);
    const TREASURY_OWNER_STR = requiredAny(["NEXT_PUBLIC_APP_TREASURY_OWNER"]);

    const MARGINFI_PROGRAM_ID_STR = requiredAny(["MARGINFI_PROGRAM_ID"]);
    const MARGINFI_GROUP_STR = requiredAny(["MARGINFI_GROUP"]);

    const body = (await req.json().catch(() => null)) as {
      amountUi?: number; // requested gross leaving savings (USDC)
      withdrawAll?: boolean; // UI "max"
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
      return json(404, { error: "No flex marginfiAccountPk saved on user" });
    }

    const conn = new Connection(RPC, "confirmed");

    const USDC_MINT = new PublicKey(USDC_MINT_STR);
    const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
    const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);

    const MARGINFI_PROGRAM_ID = new PublicKey(MARGINFI_PROGRAM_ID_STR);
    const MARGINFI_GROUP = new PublicKey(MARGINFI_GROUP_STR);

    const owner = new PublicKey(user.walletAddress);
    const marginfiAccountPk = new PublicKey(marginfiAccountPkStr);

    const acctCoder = new BorshAccountsCoder(marginfiIdl as Idl);
    const ixCoder = new BorshInstructionCoder(marginfiIdl as Idl);

    // FeeState PDA (marginfi expects it in remaining accounts)
    const [feeStatePk] = PublicKey.findProgramAddressSync(
      [Buffer.from("feestate")],
      MARGINFI_PROGRAM_ID
    );

    // Token program (token-2022 vs legacy)
    const tokenProgram = await detectTokenProgramId(conn, USDC_MINT);

    // Always use mint decimals from chain
    const mintInfo = await getMint(conn, USDC_MINT, "confirmed", tokenProgram);
    const decimals = mintInfo.decimals;

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

    // Load & decode marginfiAccount to find the correct USDC bank
    const mAccInfo = await conn.getAccountInfo(marginfiAccountPk, "confirmed");
    if (!mAccInfo?.data)
      return json(404, { error: "MarginfiAccount not found" });
    if (!mAccInfo.owner.equals(MARGINFI_PROGRAM_ID)) {
      return json(500, {
        error: "MarginfiAccount owner mismatch",
        owner: mAccInfo.owner.toBase58(),
        expected: MARGINFI_PROGRAM_ID.toBase58(),
      });
    }

    const { decoded: mAcc } = decodeByDisc(acctCoder, mAccInfo.data);

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

    // Pick the USDC bank from balances
    let chosenBankPk: PublicKey | null = null;

    for (const b of balances) {
      const { active, bankPk, assetShares } = extractBalanceInfo(b);
      if (!active || !bankPk || !assetShares || assetShares.isZero()) continue;

      const bankPkPub = new PublicKey(bankPk);
      const info = await conn.getAccountInfo(bankPkPub, "confirmed");
      if (!info?.data) continue;

      const { decoded: bankAny } = decodeByDisc(acctCoder, info.data);
      const bankConfig = getNestedRecord(bankAny, "config");

      const bankGroup =
        toB58(bankAny["group"]) ??
        (bankConfig ? toB58(bankConfig["group"]) : null) ??
        toB58(bankAny["bankGroup"]);

      if (bankGroup !== MARGINFI_GROUP.toBase58()) continue;

      const mintStr =
        toB58(bankAny["mint"]) ??
        (bankConfig ? toB58(bankConfig["mint"]) : null) ??
        toB58(bankAny["bankMint"]);

      if (mintStr !== USDC_MINT.toBase58()) continue;

      chosenBankPk = bankPkPub;
      break;
    }

    if (!chosenBankPk) {
      return json(400, {
        error:
          "MarginfiAccount has no active USDC asset in this group; cannot withdraw",
        marginfiAccount: marginfiAccountPk.toBase58(),
        group: MARGINFI_GROUP.toBase58(),
        mint: USDC_MINT.toBase58(),
      });
    }

    // Decode chosen bank to get liquidity vault
    const bankInfo = await conn.getAccountInfo(chosenBankPk, "confirmed");
    if (!bankInfo?.data) return json(500, { error: "Chosen bank not found" });
    if (!bankInfo.owner.equals(MARGINFI_PROGRAM_ID)) {
      return json(500, {
        error: "Chosen bank owner mismatch",
        owner: bankInfo.owner.toBase58(),
        expected: MARGINFI_PROGRAM_ID.toBase58(),
      });
    }

    const { decoded: bankAny } = decodeByDisc(acctCoder, bankInfo.data);

    const vaultB58 = toB58(
      bankAny["liquidity_vault"] ?? bankAny["liquidityVault"]
    );
    if (!vaultB58) return json(500, { error: "Bank missing liquidity_vault" });

    const bankLiquidityVault = new PublicKey(vaultB58);
    const [bankLiquidityVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity_vault_auth"), chosenBankPk.toBuffer()],
      MARGINFI_PROGRAM_ID
    );

    // Remaining accounts: [bank, oracle] pairs for all active balances, chosen first
    const pairs = await collectRemainingPairs(
      conn,
      acctCoder,
      balances,
      MARGINFI_GROUP
    );

    const chosenIdx = pairs.findIndex(([bPk]) => bPk.equals(chosenBankPk!));
    if (chosenIdx > 0) {
      const [p] = pairs.splice(chosenIdx, 1);
      pairs.unshift(p);
    }

    const remainingMetas = pairs.flat().map((pubkey) => ({
      pubkey,
      isSigner: false as const,
      isWritable: false as const,
    }));

    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      remainingMetas.unshift({
        pubkey: USDC_MINT,
        isSigner: false as const,
        isWritable: false as const,
      });
    }

    remainingMetas.push({
      pubkey: feeStatePk,
      isSigner: false as const,
      isWritable: false as const,
    });

    // Fee math (gross -> fee + net)
    const feeRate = getWithdrawFeeRate();
    const feePpm = Math.max(0, Math.round(feeRate * 1_000_000));

    const amountBase = uiToBN(amountUi, decimals);
    const feeBase = feeFromAmountBase(amountBase, feeRate);
    const netBase = BN.max(new BN(0), amountBase.sub(feeBase));

    // IMPORTANT:
    // If UI requested "withdraw all" but feeRate > 0, we cannot safely use withdraw_all
    // because the actual withdrawn amount would be unknown and fee would be wrong.
    // So we treat it as a normal "withdraw max by amountUi" (withdraw_all disabled).
    const withdrawAllUsed = withdrawAllRequested && feeRate === 0;

    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 80_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 160_000 }),
    ];

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

    // Withdraw ix
    const withdrawIxData = ixCoder.encode("lending_account_withdraw", {
      amount: withdrawAllUsed ? new BN(0) : amountBase,
      withdraw_all: withdrawAllUsed ? true : null,
    });

    const baseKeys = [
      { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: true },
      { pubkey: marginfiAccountPk, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },

      { pubkey: chosenBankPk, isSigner: false, isWritable: true },
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },
      { pubkey: bankLiquidityVaultAuth, isSigner: false, isWritable: false },
      { pubkey: bankLiquidityVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ];

    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: [...baseKeys, ...remainingMetas],
      data: withdrawIxData,
    });

    // Fee transfer AFTER withdraw (only when feeBase > 0)
    if (!feeBase.isZero()) {
      ixs.push(
        makeTransferCheckedIxNoBigInt({
          tokenProgramId: tokenProgram,
          source: userUsdcAta,
          mint: USDC_MINT,
          destination: treasuryUsdcAta,
          authority: owner,
          amountBase: feeBase,
          decimals,
        })
      );
    }

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );

    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const b64 = Buffer.from(tx.serialize()).toString("base64");

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
      bank: chosenBankPk.toBase58(),

      decimals,
      amountUi: bnToUiString(amountBase, decimals), // gross
      feeUi: bnToUiString(feeBase, decimals),
      netUi: bnToUiString(netBase, decimals),
      feeRate,
      feePpm,

      withdrawAllRequested,
      withdrawAllUsed,

      lastValidBlockHeight,
      remainingCount: remainingMetas.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return json(status, { error: msg || "Unknown error" });
  }
}
