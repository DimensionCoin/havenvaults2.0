import mongoose, { Schema, Types } from "mongoose";

export type ErrorSource = "client" | "server";

export interface IErrorEvent {
  userId?: Types.ObjectId;
  privyId?: string;
  email?: string;

  source: ErrorSource;
  name?: string;
  message: string;
  stack?: string;
  route?: string;
  url?: string;
  userAgent?: string;
  fingerprint: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
}

const ErrorEventSchema = new Schema<IErrorEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    privyId: { type: String, required: false, index: true },
    email: { type: String, required: false, index: true },

    source: { type: String, required: true, index: true, enum: ["client", "server"] },
    name: { type: String, required: false },
    message: { type: String, required: true },
    stack: { type: String, required: false },
    route: { type: String, required: false, index: true },
    url: { type: String, required: false },
    userAgent: { type: String, required: false },
    fingerprint: { type: String, required: true, index: true },
    meta: { type: Schema.Types.Mixed, required: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ErrorEventSchema.index({ createdAt: -1 });
ErrorEventSchema.index({ source: 1, createdAt: -1 });
ErrorEventSchema.index({ route: 1, createdAt: -1 });

export const ErrorEvent =
  (mongoose.models.ErrorEvent as mongoose.Model<IErrorEvent>) ||
  mongoose.model<IErrorEvent>("ErrorEvent", ErrorEventSchema);
