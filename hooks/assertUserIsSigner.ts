import { PublicKey, VersionedTransaction } from "@solana/web3.js";

/**
 * Validate that a given wallet address is among the required signers
 * of a VersionedTransaction before the user signs it.
 *
 * Prevents a compromised or MITM'd server response from tricking
 * the client into signing a transaction the user isn't party to.
 */
export function assertUserIsSigner(
  txBytes: Uint8Array,
  ownerBase58: string,
): void {
  const tx = VersionedTransaction.deserialize(txBytes);
  const msg = tx.message as unknown as {
    header?: { numRequiredSignatures?: number };
    staticAccountKeys?: PublicKey[];
  };
  const numSigners = msg.header?.numRequiredSignatures ?? 0;
  const signerKeys = (msg.staticAccountKeys ?? [])
    .slice(0, numSigners)
    .map((k) => (k instanceof PublicKey ? k : new PublicKey(k)));

  if (!signerKeys.some((k) => k.toBase58() === ownerBase58)) {
    throw new Error("Transaction doesn't include user as signer — rejecting.");
  }
}
