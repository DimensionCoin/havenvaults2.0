// models/Bundle.ts
import mongoose, { Schema, Types } from "mongoose";
import type { Document } from "mongoose";

/* ──────────────────────────────────────────────────────────────────────────────
  Types
────────────────────────────────────────────────────────────────────────────── */

export type BundleRiskLevel = "low" | "medium" | "high" | "degen";
export type BundleKind = "stocks" | "crypto" | "mixed";
export type BundleVisibility = "public" | "private";

export interface IBundleAllocation {
  symbol: string;
  weight: number; // Percentage (0-100), all weights must sum to 100
}

export interface IBundle extends Document {
  userId: Types.ObjectId;

  name: string;
  subtitle?: string;

  allocations: IBundleAllocation[];

  risk: BundleRiskLevel;
  kind: BundleKind;
  visibility: BundleVisibility;

  // Stats
  totalPurchases: number;
  totalVolume: mongoose.Types.Decimal128; // Total USD volume

  // Metadata
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

/* ──────────────────────────────────────────────────────────────────────────────
  Schemas
────────────────────────────────────────────────────────────────────────────── */

const BundleAllocationSchema = new Schema<IBundleAllocation>(
  {
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    weight: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
  },
  { _id: false },
);

const BundleSchema = new Schema<IBundle>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50,
    },

    subtitle: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    allocations: {
      type: [BundleAllocationSchema],
      required: true,
      validate: [
        {
          validator: function (allocations: IBundleAllocation[]) {
            return allocations.length >= 2 && allocations.length <= 5;
          },
          message: "Bundle must have between 2 and 5 assets",
        },
        {
          validator: function (allocations: IBundleAllocation[]) {
            const total = allocations.reduce((sum, a) => sum + a.weight, 0);
            return Math.abs(total - 100) < 0.5;
          },
          message: "Allocation weights must sum to 100%",
        },
      ],
    },

    risk: {
      type: String,
      enum: ["low", "medium", "high", "degen"],
      required: true,
      default: "medium",
    },

    kind: {
      type: String,
      enum: ["stocks", "crypto", "mixed"],
      required: true,
      default: "crypto",
    },

    visibility: {
      type: String,
      enum: ["public", "private"],
      required: true,
      default: "private",
    },

    totalPurchases: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalVolume: {
      type: Schema.Types.Decimal128,
      default: mongoose.Types.Decimal128.fromString("0"),
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

/* ──────────────────────────────────────────────────────────────────────────────
  Indexes
────────────────────────────────────────────────────────────────────────────── */

// For fetching user's bundles
BundleSchema.index({ userId: 1, isActive: 1, createdAt: -1 });

// For fetching public bundles
BundleSchema.index({ visibility: 1, isActive: 1, createdAt: -1 });

// For popular public bundles
BundleSchema.index({ visibility: 1, isActive: 1, totalPurchases: -1 });

// Compound index for user + visibility queries
BundleSchema.index({ userId: 1, visibility: 1, isActive: 1 });

/* ──────────────────────────────────────────────────────────────────────────────
  Virtuals
────────────────────────────────────────────────────────────────────────────── */

BundleSchema.virtual("assetCount").get(function (this: IBundle) {
  return this.allocations?.length ?? 0;
});

BundleSchema.set("toJSON", { virtuals: true });
BundleSchema.set("toObject", { virtuals: true });

/* ──────────────────────────────────────────────────────────────────────────────
  Export
────────────────────────────────────────────────────────────────────────────── */

export const Bundle =
  (mongoose.models.Bundle as mongoose.Model<IBundle>) ||
  mongoose.model<IBundle>("Bundle", BundleSchema);

export default Bundle;
