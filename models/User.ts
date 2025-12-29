// models/User.ts
import mongoose, { Schema, Types } from "mongoose";
import type { Document } from "mongoose";
import crypto from "crypto";

/* ──────────────────────────────────────────────────────────────────────────────
  Types
────────────────────────────────────────────────────────────────────────────── */

export type RiskLevel = "low" | "medium" | "high";
export type FinancialKnowledgeLevel =
  | "none"
  | "beginner"
  | "intermediate"
  | "advanced";

/**
 * Central list of currencies Haven supports for display.
 * Major fiat + USDC.
 */
export const DISPLAY_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "JPY",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "HRK",
  "BRL",
  "MXN",
  "CLP",
  "COP",
  "PEN",
  "ARS",
  "CNY",
  "HKD",
  "SGD",
  "KRW",
  "INR",
  "IDR",
  "THB",
  "MYR",
  "PHP",
  "VND",
  "TWD",
  "PKR",
  "ILS",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "ZAR",
  "NGN",
  "GHS",
  "KES",
  "MAD",
  "USDC",
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export type SavingsAccountType = "flex" | "plus";
export type ContactStatus = "invited" | "active" | "external";
export type InviteStatus = "sent" | "clicked" | "signed_up";

/* ──────────────────────────────────────────────────────────────────────────────
  Interfaces
────────────────────────────────────────────────────────────────────────────── */

export interface ISavingsAccount {
  type: SavingsAccountType;

  // authority / owner wallet
  walletAddress: string;

  // Marginfi account you query for balance
  marginfiAccountPk?: string;

  /**
   * Aggregates (fast path)
   * These are kept in sync from SavingsLedger (source of truth).
   */

  // principal-only accounting
  principalDeposited: mongoose.Types.Decimal128; // sum of deposit principal
  principalWithdrawn: mongoose.Types.Decimal128; // principal portion withdrawn
  interestWithdrawn: mongoose.Types.Decimal128; // interest portion withdrawn

  // totals
  totalDeposited: mongoose.Types.Decimal128; // sum of ledger.amount where direction=deposit
  totalWithdrawn: mongoose.Types.Decimal128; // sum of ledger.amount where direction=withdraw

  feesPaidUsdc: mongoose.Types.Decimal128;

  // optional cached reconciliation fields
  lastOnChainBalance?: mongoose.Types.Decimal128;
  lastSyncedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export interface IContact {
  name?: string;
  email?: string;
  walletAddress?: string;
  havenUser?: Types.ObjectId;
  status: ContactStatus;
  invitedAt?: Date;
  joinedAt?: Date;
}

export interface IInvite {
  email?: string;

  sentAt: Date;
  status: InviteStatus;
  invitedUser?: Types.ObjectId;

  inviteToken?: string;
  isPersonal?: boolean;

  recipientName?: string;
  message?: string;

  clickedAt?: Date;
  redeemedAt?: Date;

  claimedEmail?: string;
  claimedWalletAddress?: string;
}

export interface IBalanceBreakdown {
  savingsFlex?: mongoose.Types.Decimal128;
  savingsPlus?: mongoose.Types.Decimal128;
  invest?: mongoose.Types.Decimal128;
  amplify?: mongoose.Types.Decimal128;
}

export interface IBalanceSnapshot {
  asOf: Date;
  totalBalanceUSDC: mongoose.Types.Decimal128;
  breakdown?: IBalanceBreakdown;
}

export interface IUser extends Document {
  privyId: string;
  email: string;
  walletAddress: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  displayCurrency: DisplayCurrency;
  profileImageUrl?: string;

  savingsAccounts: ISavingsAccount[];

  wishlistTokenMints: string[];

  financialKnowledgeLevel?: FinancialKnowledgeLevel;
  riskLevel?: RiskLevel;

  contacts: IContact[];
  invites: IInvite[];

  referralCode: string;
  referrals: Types.ObjectId[];
  referredBy?: Types.ObjectId;

  balanceSnapshots: IBalanceSnapshot[];

  isPro: boolean;
  isOnboarded: boolean;
  lastLoginAt?: Date;
  lastBalanceSyncAt?: Date;

  createdAt: Date;
  updatedAt: Date;

  fullName?: string;
  savingsFlex?: ISavingsAccount;
  savingsPlus?: ISavingsAccount;

  getSavingsAccount(type: SavingsAccountType): ISavingsAccount | undefined;
}

/* ──────────────────────────────────────────────────────────────────────────────
  Helpers
────────────────────────────────────────────────────────────────────────────── */

const D128 = mongoose.Types.Decimal128;
const zero = () => D128.fromString("0");

const ensureD128 = (v: any) => (v ? v : zero());

const makeDefaultSavingsAccount = (
  type: SavingsAccountType,
  walletAddress: string
): ISavingsAccount => ({
  type,
  walletAddress,
  marginfiAccountPk: undefined,

  principalDeposited: zero(),
  principalWithdrawn: zero(),
  interestWithdrawn: zero(),

  totalDeposited: zero(),
  totalWithdrawn: zero(),

  feesPaidUsdc: zero(),

  lastOnChainBalance: undefined,
  lastSyncedAt: undefined,
});

const makeReferralCode = () => crypto.randomBytes(5).toString("base64url"); // short, URL-safe

/* ──────────────────────────────────────────────────────────────────────────────
  Schemas
────────────────────────────────────────────────────────────────────────────── */

const SavingsAccountSchema = new Schema<ISavingsAccount>(
  {
    type: { type: String, enum: ["flex", "plus"], required: true },
    walletAddress: { type: String, required: true, index: true },

    marginfiAccountPk: { type: String, trim: true },

    principalDeposited: {
      type: Schema.Types.Decimal128,
      default: 0,
      required: true,
    },
    principalWithdrawn: {
      type: Schema.Types.Decimal128,
      default: 0,
      required: true,
    },
    interestWithdrawn: {
      type: Schema.Types.Decimal128,
      default: 0,
      required: true,
    },

    totalDeposited: {
      type: Schema.Types.Decimal128,
      default: 0,
      required: true,
    },
    totalWithdrawn: {
      type: Schema.Types.Decimal128,
      default: 0,
      required: true,
    },

    feesPaidUsdc: { type: Schema.Types.Decimal128, default: 0, required: true },

    lastOnChainBalance: { type: Schema.Types.Decimal128, default: undefined },
    lastSyncedAt: { type: Date, default: undefined },
  },
  { _id: false, timestamps: true }
);

const ContactSchema = new Schema<IContact>(
  {
    name: { type: String },
    email: { type: String, lowercase: true, trim: true },
    walletAddress: { type: String, trim: true },
    havenUser: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["invited", "active", "external"],
      required: true,
      default: "external",
    },
    invitedAt: { type: Date },
    joinedAt: { type: Date },
  },
  { _id: false }
);

const InviteSchema = new Schema<IInvite>(
  {
    email: { type: String, required: false, lowercase: true, trim: true },

    sentAt: { type: Date, required: true, default: () => new Date() },
    status: {
      type: String,
      enum: ["sent", "clicked", "signed_up"],
      required: true,
      default: "sent",
    },
    invitedUser: { type: Schema.Types.ObjectId, ref: "User" },

    inviteToken: { type: String, trim: true },
    isPersonal: { type: Boolean, default: false },

    recipientName: { type: String },
    message: { type: String },

    clickedAt: { type: Date },
    redeemedAt: { type: Date },

    claimedEmail: { type: String, lowercase: true, trim: true },
    claimedWalletAddress: { type: String, trim: true },
  },
  { _id: false }
);

const BalanceBreakdownSchema = new Schema<IBalanceBreakdown>(
  {
    savingsFlex: { type: Schema.Types.Decimal128, default: undefined },
    savingsPlus: { type: Schema.Types.Decimal128, default: undefined },
    invest: { type: Schema.Types.Decimal128, default: undefined },
    amplify: { type: Schema.Types.Decimal128, default: undefined },
  },
  { _id: false }
);

const BalanceSnapshotSchema = new Schema<IBalanceSnapshot>(
  {
    asOf: { type: Date, required: true },
    totalBalanceUSDC: { type: Schema.Types.Decimal128, required: true },
    breakdown: { type: BalanceBreakdownSchema, default: undefined },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    privyId: { type: String, required: true, unique: true, index: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    walletAddress: { type: String, required: true, unique: true, index: true },

    firstName: { type: String },
    lastName: { type: String },
    country: { type: String },

    displayCurrency: {
      type: String,
      enum: DISPLAY_CURRENCIES as unknown as string[],
      default: "USD",
    },

    profileImageUrl: { type: String },

    savingsAccounts: { type: [SavingsAccountSchema], default: [] },

    wishlistTokenMints: { type: [String], default: [] },

    financialKnowledgeLevel: {
      type: String,
      enum: ["none", "beginner", "intermediate", "advanced"],
      default: "none",
    },

    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },

    contacts: { type: [ContactSchema], default: [] },
    invites: { type: [InviteSchema], default: [] },

    // NOTE: required, but we auto-generate it in pre("validate")
    referralCode: { type: String, required: true, unique: true, index: true },

    referrals: [{ type: Schema.Types.ObjectId, ref: "User", index: true }],
    referredBy: { type: Schema.Types.ObjectId, ref: "User", index: true },

    balanceSnapshots: { type: [BalanceSnapshotSchema], default: [] },

    isPro: { type: Boolean, default: false },
    isOnboarded: { type: Boolean, default: false, index: true },

    lastLoginAt: { type: Date },
    lastBalanceSyncAt: { type: Date },
  },
  { timestamps: true }
);

/* ──────────────────────────────────────────────────────────────────────────────
  Normalization middleware (Mongoose 7-safe)
  - ensures savings accounts exist + aligned
  - ensures new savings fields exist on older docs
  - generates referralCode when missing
────────────────────────────────────────────────────────────────────────────── */

UserSchema.pre("validate", async function () {
  const user = this as IUser;

  // Defensive defaults (helps when old docs are missing arrays)
  if (!Array.isArray(user.savingsAccounts)) user.savingsAccounts = [];
  if (!Array.isArray(user.contacts)) user.contacts = [];
  if (!Array.isArray(user.invites)) user.invites = [];
  if (!Array.isArray(user.wishlistTokenMints)) user.wishlistTokenMints = [];
  if (!Array.isArray(user.referrals)) user.referrals = [];
  if (!Array.isArray(user.balanceSnapshots)) user.balanceSnapshots = [];

  // Savings normalization
  if (user.walletAddress) {
    const seen = new Set<SavingsAccountType>();

    for (const acc of user.savingsAccounts) {
      const t = acc?.type as SavingsAccountType | undefined;
      if (!t) continue;

      if (seen.has(t)) {
        throw new Error(
          `User has duplicate savingsAccounts entries for type "${t}".`
        );
      }
      seen.add(t);

      if (acc.walletAddress !== user.walletAddress) {
        acc.walletAddress = user.walletAddress;
      }

      // Backfill missing Decimal128 fields for older docs
      acc.principalDeposited = ensureD128(acc.principalDeposited) as any;
      acc.principalWithdrawn = ensureD128(acc.principalWithdrawn) as any;
      acc.interestWithdrawn = ensureD128(acc.interestWithdrawn) as any;
      acc.totalDeposited = ensureD128(acc.totalDeposited) as any;
      acc.totalWithdrawn = ensureD128(acc.totalWithdrawn) as any;
      acc.feesPaidUsdc = ensureD128(acc.feesPaidUsdc) as any;
    }

    if (!seen.has("flex")) {
      user.savingsAccounts.push(
        makeDefaultSavingsAccount("flex", user.walletAddress)
      );
    }
    if (!seen.has("plus")) {
      user.savingsAccounts.push(
        makeDefaultSavingsAccount("plus", user.walletAddress)
      );
    }

    user.savingsAccounts.sort((a, b) => (a.type > b.type ? 1 : -1));
  }

  // Referral code generation (this is what invite/referral flows depend on)
  if (!user.referralCode) {
    for (let i = 0; i < 10; i++) {
      const code = makeReferralCode();
      // eslint-disable-next-line no-await-in-loop
      const exists = await mongoose
        .model("User")
        .exists({ referralCode: code });
      if (!exists) {
        user.referralCode = code;
        break;
      }
    }
    if (!user.referralCode) {
      throw new Error("Failed to generate unique referralCode");
    }
  }
});

/* ──────────────────────────────────────────────────────────────────────────────
  Virtuals + Methods
────────────────────────────────────────────────────────────────────────────── */

UserSchema.virtual("fullName").get(function (this: IUser) {
  if (!this.firstName && !this.lastName) return undefined;
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});

UserSchema.virtual("savingsFlex").get(function (this: IUser) {
  return this.savingsAccounts?.find((a) => a.type === "flex");
});

UserSchema.virtual("savingsPlus").get(function (this: IUser) {
  return this.savingsAccounts?.find((a) => a.type === "plus");
});

UserSchema.methods.getSavingsAccount = function (
  this: IUser,
  type: SavingsAccountType
) {
  return this.savingsAccounts?.find((a) => a.type === type);
};

UserSchema.set("toJSON", { virtuals: true });
UserSchema.set("toObject", { virtuals: true });

/* ──────────────────────────────────────────────────────────────────────────────
  Indexes
────────────────────────────────────────────────────────────────────────────── */

UserSchema.index({ privyId: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ walletAddress: 1 });
UserSchema.index({ referralCode: 1 });
UserSchema.index({ referredBy: 1 });
UserSchema.index({ isOnboarded: 1, createdAt: -1 });

UserSchema.index({ "savingsAccounts.type": 1 });
UserSchema.index({ "savingsAccounts.walletAddress": 1 });

UserSchema.index({ "invites.inviteToken": 1 });
UserSchema.index({ "invites.isPersonal": 1, "invites.inviteToken": 1 });
UserSchema.index({
  "invites.isPersonal": 1,
  "invites.status": 1,
  "invites.sentAt": -1,
});

UserSchema.index({ "contacts.email": 1 });
UserSchema.index({ "contacts.walletAddress": 1 });
UserSchema.index({ "contacts.havenUser": 1 });

export const User =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
export default User;
