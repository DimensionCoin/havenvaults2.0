// models/SavingsLedger.ts
import mongoose, { Schema, Types } from "mongoose";

type Direction = "deposit" | "withdraw";

export interface ISavingsLedger {
  userId: Types.ObjectId;
  accountType: "flex" | "plus";
  direction: Direction;

  // raw requested amount (USDC)
  amount: mongoose.Types.Decimal128;

  // ✅ split used to keep aggregates correct
  principalPart: mongoose.Types.Decimal128;
  interestPart: mongoose.Types.Decimal128;

  // ✅ fee actually charged (USDC)
  feeUsdc: mongoose.Types.Decimal128;

  // ✅ idempotency key
  signature: string;

  createdAt: Date;
}

const SavingsLedgerSchema = new Schema<ISavingsLedger>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    accountType: {
      type: String,
      enum: ["flex", "plus"],
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["deposit", "withdraw"], required: true },

    amount: { type: Schema.Types.Decimal128, required: true },
    principalPart: { type: Schema.Types.Decimal128, required: true },
    interestPart: { type: Schema.Types.Decimal128, required: true },
    feeUsdc: { type: Schema.Types.Decimal128, required: true },

    signature: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const SavingsLedger =
  mongoose.models.SavingsLedger ||
  mongoose.model<ISavingsLedger>("SavingsLedger", SavingsLedgerSchema);
