import mongoose from "mongoose";

const schema = new mongoose.Schema({
  notificationId: { type: String, required: true, unique: true, index: true },
  shopId: { type: String, index: true },
  type: { type: Number, required: true },
  category: { type: String, enum: ["order", "product", "inventory", "unknown"], default: "unknown" },
  status: { type: String, enum: ["received", "processing", "completed", "failed", "ignored"], default: "received", index: true },
  eventTimestamp: Date,
  syncJobId: { type: mongoose.Schema.Types.ObjectId, ref: "TikTokSyncJob" },
  processedAt: Date,
  errorMessage: String,
}, { timestamps: true });

schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
export default mongoose.model("TikTokWebhookEvent", schema);
