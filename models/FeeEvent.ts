// models/FeeEvent.ts
import mongoose, { Schema, Types } from "mongoose";

export interface IFeeToken {
  mint: string; // SPL mint base58
  symbol?: string; // optional
  decimals: number; // 0..18
  amountUi: mongoose.Types.Decimal128; // UI units, stored with `decimals` precision
}

export interface IFeeEvent {
  userId: Types.ObjectId;
  kind: string; // e.g. "transfer", "swap", "savings_deposit"
  signature: string; // UNIQUE idempotency key (txSig, requestId, etc.)
  tokens: IFeeToken[]; // ✅ multi-token fees paid in this tx
  createdAt: Date;
}

const FeeTokenSchema = new Schema<IFeeToken>(
  {
    mint: { type: String, required: true, index: true },
    symbol: { type: String, required: false },
    decimals: { type: Number, required: true },
    amountUi: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: false }
);

const FeeEventSchema = new Schema<IFeeEvent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    kind: { type: String, required: true, index: true },
    signature: { type: String, required: true, unique: true, index: true },

    // ✅ NEW FIELD (replaces amountUsdc)
    tokens: { type: [FeeTokenSchema], required: true, default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Helpful indexes for analytics
FeeEventSchema.index({ userId: 1, createdAt: -1 });
FeeEventSchema.index({ kind: 1, createdAt: -1 });
FeeEventSchema.index({ "tokens.mint": 1, createdAt: -1 });

export const FeeEvent =
  (mongoose.models.FeeEvent as mongoose.Model<IFeeEvent>) ||
  mongoose.model<IFeeEvent>("FeeEvent", FeeEventSchema);
