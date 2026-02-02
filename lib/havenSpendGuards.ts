// lib/havenSpendGuards.ts
import "server-only";

import {
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * Hard cap on how many lamports Haven is allowed to fund in *a single tx*
 * via SystemProgram createAccount/createAccountWithSeed.
 * - ATA creation rent is tiny (~0.002 SOL).
 * - This blocks draining attacks where a user asks Haven to fund a large createAccount.
 */
const HAVEN_MAX_LAMPORTS_FUND_PER_TX = Number(
  process.env.HAVEN_MAX_LAMPORTS_FUND_PER_TX ?? "20000000", // 0.02 SOL default
);

const _havenAddr = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS;
if (!_havenAddr) {
  throw new Error(
    "Missing required env var NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS — cannot initialize spend guards",
  );
}
const HAVEN_PUBKEY = new PublicKey(_havenAddr);

/* ───────── Binary helpers ───────── */

function readU32LE(buf: Uint8Array, offset: number): number {
  const b = Buffer.from(buf);
  return b.readUInt32LE(offset);
}

function readU64LEBigint(buf: Uint8Array, offset: number): bigint {
  const b = Buffer.from(buf);
  const lo = BigInt(b.readUInt32LE(offset));
  const hi = BigInt(b.readUInt32LE(offset + 4));
  return (hi << BigInt(32)) + lo;
}

/**
 * Validates that a Haven-sponsored transaction doesn't drain SOL from
 * the Haven fee payer wallet.
 *
 * We only allow Haven to pay *small* system lamports for safe account
 * creation (e.g. ATA rent). We reject:
 * - any SystemProgram.transfer from HAVEN_PUBKEY
 * - any createAccount/createAccountWithSeed where lamports is too large
 * - program IDs resolved from lookup tables (must be static for safety)
 *
 * Returns total lamports Haven funds via SystemProgram create* in this tx.
 * Throws on disallowed patterns.
 */
type TransferAllowance = { to: PublicKey; maxLamports: number };

export function validateHavenSpendGuards(
  tx: VersionedTransaction,
  opts?: { allowSystemTransfers?: TransferAllowance[] },
): {
  fundedLamports: number;
  transferredLamports: number;
} {
  const msg = tx.message;

  const staticKeys = msg.staticAccountKeys;
  const staticLen = staticKeys.length;

  // Ensure we can resolve every programId deterministically (no program IDs in lookups).
  // This is a strong safety invariant for sponsored txs.
  const compiled = (msg as unknown as { compiledInstructions?: unknown })
    .compiledInstructions as
    | Array<{
        programIdIndex: number;
        accountKeyIndexes: number[];
        data: Uint8Array;
      }>
    | undefined;

  if (!compiled || !Array.isArray(compiled)) {
    throw new Error("Unsupported transaction message format");
  }

  let fundedLamports = 0;
  let transferredLamports = 0;
  const allow = Array.isArray(opts?.allowSystemTransfers)
    ? opts!.allowSystemTransfers!
    : [];
  const allowMap = new Map<string, { max: number; used: number }>();
  for (const a of allow) {
    if (!a?.to) continue;
    const max = Number(a.maxLamports);
    if (!Number.isFinite(max) || max <= 0) continue;
    const key = a.to.toBase58();
    const prev = allowMap.get(key);
    if (!prev) {
      allowMap.set(key, { max, used: 0 });
    } else {
      allowMap.set(key, { max: prev.max + max, used: prev.used });
    }
  }

  for (const ix of compiled) {
    const pidIndex = ix.programIdIndex;

    if (!Number.isFinite(pidIndex) || pidIndex < 0) {
      throw new Error("Invalid instruction program id index");
    }

    // Must be static so we can validate it.
    if (pidIndex >= staticLen) {
      throw new Error("Unsafe transaction (program id in lookup table)");
    }

    const programId = staticKeys[pidIndex];

    // Only guard SystemProgram. (Token drains would require authority signers; Haven signer is the payer.)
    if (!programId.equals(SystemProgram.programId)) continue;

    const data = ix.data;
    if (!(data instanceof Uint8Array) || data.length < 4) {
      throw new Error("Invalid SystemProgram instruction data");
    }

    const ixType = readU32LE(data, 0);

    // SystemProgram instruction layouts:
    // 0 = CreateAccount { lamports: u64, space: u64, programId: Pubkey }
    // 2 = Transfer { lamports: u64 }
    // 3 = CreateAccountWithSeed { base: Pubkey, seed: string, lamports: u64, space: u64, programId: Pubkey }
    //
    // Account index conventions (for Transfer/CreateAccount):
    // - accounts[0] is "from"/payer
    // - accounts[1] is "to"/new account
    const acctIdxs = Array.isArray(ix.accountKeyIndexes)
      ? ix.accountKeyIndexes
      : [];

    const fromIndex = acctIdxs[0];
    if (typeof fromIndex !== "number" || fromIndex < 0) {
      throw new Error("Invalid SystemProgram accounts");
    }

    const fromKey = fromIndex < staticLen ? staticKeys[fromIndex] : undefined;

    // If we can't resolve fromKey, treat as unsafe.
    if (!fromKey) {
      throw new Error("Unsafe transaction (system fromKey unresolved)");
    }

    // ---- Transfer: hard block if from=Haven ----
    if (ixType === 2) {
      if (data.length < 12) throw new Error("Invalid transfer data");
      const lamports = readU64LEBigint(data, 4);

      if (fromKey.equals(HAVEN_PUBKEY)) {
        const toIndex = acctIdxs[1];
        const toKey = typeof toIndex === "number" && toIndex < staticLen
          ? staticKeys[toIndex]
          : undefined;

        if (!toKey) {
          throw new Error("Unsafe transaction (system toKey unresolved)");
        }

        const allowance = allowMap.get(toKey.toBase58());
        const n = Number(lamports);
        if (
          !allowance ||
          !Number.isFinite(n) ||
          n < 0 ||
          allowance.used + n > allowance.max
        ) {
          throw new Error(
            `Unsafe transaction (SystemProgram.transfer from fee payer: ${lamports.toString()} lamports)`,
          );
        }

        allowance.used += n;
        transferredLamports += n;
      }

      continue;
    }

    // ---- CreateAccount: cap lamports if from=Haven ----
    if (ixType === 0) {
      if (data.length < 12) throw new Error("Invalid createAccount data");
      const lamports = readU64LEBigint(data, 4);

      if (fromKey.equals(HAVEN_PUBKEY)) {
        const n = Number(lamports);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("Invalid createAccount lamports");
        }
        fundedLamports += n;

        if (n > HAVEN_MAX_LAMPORTS_FUND_PER_TX) {
          throw new Error(
            `Unsafe transaction (createAccount funds too much: ${n} lamports)`,
          );
        }
      }

      continue;
    }

    // ---- CreateAccountWithSeed: cap lamports if from=Haven ----
    if (ixType === 3) {
      if (data.length < 4 + 32 + 4 + 8) {
        throw new Error("Invalid createAccountWithSeed data");
      }

      const seedLen = readU32LE(data, 4 + 32);
      const lamportsOffset = 4 + 32 + 4 + seedLen;

      if (data.length < lamportsOffset + 8) {
        throw new Error("Invalid createAccountWithSeed lamports");
      }

      const lamports = readU64LEBigint(data, lamportsOffset);

      if (fromKey.equals(HAVEN_PUBKEY)) {
        const n = Number(lamports);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("Invalid createAccountWithSeed lamports");
        }
        fundedLamports += n;

        if (n > HAVEN_MAX_LAMPORTS_FUND_PER_TX) {
          throw new Error(
            `Unsafe transaction (createAccountWithSeed funds too much: ${n} lamports)`,
          );
        }
      }

      continue;
    }
  }

  // Cap total funded lamports across multiple create instructions too.
  if (fundedLamports > HAVEN_MAX_LAMPORTS_FUND_PER_TX) {
    throw new Error(
      `Unsafe transaction (total funded lamports too much: ${fundedLamports})`,
    );
  }

  return { fundedLamports, transferredLamports };
}
