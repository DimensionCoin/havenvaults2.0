// models/FeeEvent.ts
import mongoose, { Schema, Types } from "mongoose";

export interface IFeeToken {
  mint: string;
  symbol?: string;
  decimals: number;
  amountUi: mongoose.Types.Decimal128;
}

export interface IFeeEvent {
  userId: Types.ObjectId;
  kind: string;
  signature: string;
  tokens: IFeeToken[];
  createdAt: Date;
}

const FeeTokenSchema = new Schema<IFeeToken>(
  {
    mint: { type: String, required: true, index: true },
    symbol: { type: String, required: false },
    decimals: { type: Number, required: true },
    amountUi: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: false },
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

    // ❗️NOT unique by itself anymore
    signature: { type: String, required: true, index: true },

    tokens: { type: [FeeTokenSchema], required: true, default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// ✅ Idempotency should be signature + kind (not just signature)
FeeEventSchema.index({ signature: 1, kind: 1 }, { unique: true });

// Helpful indexes
FeeEventSchema.index({ userId: 1, createdAt: -1 });
FeeEventSchema.index({ kind: 1, createdAt: -1 });
FeeEventSchema.index({ "tokens.mint": 1, createdAt: -1 });

export const FeeEvent =
  (mongoose.models.FeeEvent as mongoose.Model<IFeeEvent>) ||
  mongoose.model<IFeeEvent>("FeeEvent", FeeEventSchema);
