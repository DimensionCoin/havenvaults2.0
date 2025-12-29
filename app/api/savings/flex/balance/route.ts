// app/api/savings/flex/balance/route.ts
import "server-only";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import BN from "bn.js";
import { Buffer } from "buffer";

import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";
import marginfiIdl from "@/lib/marginfi_idl.json";
import { getSessionFromCookies } from "@/lib/auth";

/* ───────── response helpers ───────── */

function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) console.error("[/api/savings/flex/balance]", body);
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function noContent() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

function requiredAny(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  throw new Error(`Missing env: one of [${names.join(", ")}]`);
}

/* ───────── decode helpers ───────── */

const disc = (name: string) =>
  createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asNumberArray = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((n) => typeof n === "number") ? v : null;

function decodeByDiscriminator(
  coder: BorshAccountsCoder,
  buf: Buffer
): { name: string; decoded: UnknownRecord } {
  const d = buf.subarray(0, 8);
  const idl = (coder as unknown as { idl?: Idl }).idl;
  if (!idl) throw new Error("Coder missing IDL");

  for (const a of idl.accounts ?? []) {
    if (disc(a.name).equals(d)) {
      const decoded = coder.decode(a.name, buf) as unknown;
      if (!isRecord(decoded)) throw new Error(`Decoded ${a.name} not object`);
      return { name: a.name, decoded };
    }
  }
  throw new Error("Unknown account discriminator");
}

function bnFromI80F48Like(value: unknown): BN | null {
  if (BN.isBN(value)) return value;

  // Often Anchor returns: { value: number[] }
  if (isRecord(value)) {
    const arr = asNumberArray((value as { value?: unknown }).value);
    if (arr) return new BN(Uint8Array.from(arr), "le");
  }

  const arr = asNumberArray(value);
  if (arr) return new BN(Uint8Array.from(arr), "le");

  return null;
}

function asPubkey(v: unknown): PublicKey | null {
  try {
    if (!v) return null;
    if (v instanceof PublicKey) return v;
    if (typeof v === "string" && v.trim()) return new PublicKey(v.trim());
    if (v instanceof Uint8Array && v.length === 32) return new PublicKey(v);
    const arr = asNumberArray(v);
    if (arr && arr.length === 32) return new PublicKey(Uint8Array.from(arr));
    if (isRecord(v)) {
      const arr2 = asNumberArray((v as { value?: unknown }).value);
      if (arr2 && arr2.length === 32)
        return new PublicKey(Uint8Array.from(arr2));
    }
    return null;
  } catch {
    return null;
  }
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

const getFirstField = (obj: UnknownRecord, keys: string[]): unknown => {
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  return undefined;
};

/* ───────── auth helpers ───────── */

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

  if (!user?._id) throw new Error("Unauthorized");
  return user;
}

type SavingsAccountLean = { type?: string; marginfiAccountPk?: string | null };
type UserLean = { savingsAccounts?: SavingsAccountLean[] | null };

function getFlexMarginfiAccountPkStrict(userLean: UserLean): string | null {
  const flex = Array.isArray(userLean?.savingsAccounts)
    ? userLean.savingsAccounts.find((a) => a?.type === "flex")
    : null;

  const pk = flex?.marginfiAccountPk;
  return typeof pk === "string" && pk.trim() ? pk.trim() : null;
}

/* ───────── route ───────── */

export async function GET() {
  try {
    const RPC = requiredAny(["NEXT_PUBLIC_SOLANA_RPC", "SOLANA_RPC"]);
    const MARGINFI_PROGRAM_ID_STR = requiredAny(["MARGINFI_PROGRAM_ID"]);
    const MARGINFI_GROUP_STR = requiredAny(["MARGINFI_GROUP"]);
    const USDC_MINT_STR = requiredAny(["NEXT_PUBLIC_USDC_MINT"]);

    const user = await getAuthedUserOrThrow();
    const accountPkStr = getFlexMarginfiAccountPkStrict(user);
    if (!accountPkStr) return noContent();

    let accountPk: PublicKey;
    try {
      accountPk = new PublicKey(accountPkStr);
    } catch {
      return noContent();
    }

    const conn = new Connection(RPC, { commitment: "confirmed" });
    const coder = new BorshAccountsCoder(marginfiIdl as Idl);

    const MARGINFI_PROGRAM_ID = new PublicKey(MARGINFI_PROGRAM_ID_STR);
    const MARGINFI_GROUP = new PublicKey(MARGINFI_GROUP_STR);
    const USDC_MINT = new PublicKey(USDC_MINT_STR);

    const mAccInfo = await conn.getAccountInfo(accountPk, "confirmed");
    if (!mAccInfo?.data) {
      return json(200, {
        ok: true,
        marginfiAccountPk: accountPkStr,
        amountUi: "0",
        decimals: 6,
        source: "missing_marginfi_account_onchain",
      });
    }
    if (!mAccInfo.owner.equals(MARGINFI_PROGRAM_ID)) {
      return json(500, {
        error: "MarginfiAccount owner mismatch",
        owner: mAccInfo.owner.toBase58(),
        expected: MARGINFI_PROGRAM_ID.toBase58(),
      });
    }

    const { decoded: mAcc } = decodeByDiscriminator(coder, mAccInfo.data);

    const balancesContainer = getFirstField(mAcc, [
      "lending_account",
      "lendingAccount",
    ]);
    const balancesSource =
      (isRecord(balancesContainer)
        ? balancesContainer.balances
        : undefined) ?? getFirstField(mAcc, ["balances"]) ?? [];

    const balances: UnknownRecord[] = Array.isArray(balancesSource)
      ? balancesSource.filter(isRecord)
      : [];

    // Collect candidate bank PKs from balances
    const candidates: { bankPk: PublicKey; balance: UnknownRecord }[] = [];
    for (const b of balances) {
      const active = Boolean(getFirstField(b, ["active"]));
      if (!active) continue;

      const bankPk =
        asPubkey(getFirstField(b, ["bank_pk", "bankPk", "bank"]));

      if (!bankPk) continue;

      const shares = bnFromI80F48Like(
        getFirstField(b, ["asset_shares", "assetShares"])
      );

      if (!shares || shares.isZero()) continue;

      candidates.push({ bankPk, balance: b });
    }

    if (!candidates.length) {
      return json(200, {
        ok: true,
        marginfiAccountPk: accountPkStr,
        amountUi: "0",
        decimals: 6,
        source: "no_active_balance",
      });
    }

    // Fetch all bank accounts in one RPC call
    const bankInfos = await conn.getMultipleAccountsInfo(
      candidates.map((c) => c.bankPk),
      "confirmed"
    );

    // Choose the USDC bank in the correct group
    let chosen: {
      bankPk: PublicKey;
      balance: UnknownRecord;
      bankDecoded: UnknownRecord;
    } | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const info = bankInfos[i];
      if (!info?.data) continue;
      if (!info.owner.equals(MARGINFI_PROGRAM_ID)) continue;

      const { decoded: bankAny } = decodeByDiscriminator(coder, info.data);

      const cfgCandidate = getFirstField(bankAny, ["config"]);
      const cfg = isRecord(cfgCandidate) ? cfgCandidate : null;

      const groupPk =
        asPubkey(getFirstField(bankAny, ["group"])) ||
        (cfg ? asPubkey(getFirstField(cfg, ["group"])) : null);

      if (!groupPk || !groupPk.equals(MARGINFI_GROUP)) continue;

      const mintPk =
        asPubkey(getFirstField(bankAny, ["mint"])) ||
        (cfg ? asPubkey(getFirstField(cfg, ["mint"])) : null);

      if (!mintPk || !mintPk.equals(USDC_MINT)) continue;

      chosen = {
        bankPk: candidates[i].bankPk,
        balance: candidates[i].balance,
        bankDecoded: bankAny,
      };
      break;
    }

    if (!chosen) {
      return json(200, {
        ok: true,
        marginfiAccountPk: accountPkStr,
        amountUi: "0",
        decimals: 6,
        source: "no_usdc_bank_found_in_group",
      });
    }

    const cfgChosenCandidate = getFirstField(chosen.bankDecoded, ["config"]);
    const cfg = isRecord(cfgChosenCandidate) ? cfgChosenCandidate : null;

    const mintDecimals =
      (typeof getFirstField(chosen.bankDecoded, ["mint_decimals"]) ===
        "number" &&
        (getFirstField(chosen.bankDecoded, ["mint_decimals"]) as number)) ||
      (cfg &&
        typeof getFirstField(cfg, ["mint_decimals"]) === "number" &&
        (getFirstField(cfg, ["mint_decimals"]) as number)) ||
      6;

    const userShares = bnFromI80F48Like(
      getFirstField(chosen.balance, ["asset_shares", "assetShares"])
    );

    if (!userShares || userShares.isZero()) {
      return json(200, {
        ok: true,
        marginfiAccountPk: accountPkStr,
        amountUi: "0",
        decimals: mintDecimals,
        source: "no_user_shares",
      });
    }

    // This is the key: bank.asset_share_value (I80F48)
    const asv =
      bnFromI80F48Like(
        getFirstField(chosen.bankDecoded, ["asset_share_value", "assetShareValue"])
      ) ||
      (cfg
        ? bnFromI80F48Like(
            getFirstField(cfg, ["asset_share_value", "assetShareValue"])
          )
        : null);

    if (!asv) {
      return json(200, {
        ok: true,
        marginfiAccountPk: accountPkStr,
        amountUi: "0",
        decimals: mintDecimals,
        source: "missing_asset_share_value",
      });
    }

    // I80F48 * I80F48 => scale 2^96. Convert to integer base units with >> 96.
    const amountBase = userShares.mul(asv).shrn(96);

    return json(200, {
      ok: true,
      marginfiAccountPk: accountPkStr,
      bank: chosen.bankPk.toBase58(),
      amountUi: bnToUiString(amountBase, mintDecimals),
      amountBase: amountBase.toString(10),
      decimals: mintDecimals,
      source: "asset_share_value",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message.toLowerCase().includes("unauthorized") ? 401 : 500;
    return json(status, { error: message || "Unknown error" });
  }
}
