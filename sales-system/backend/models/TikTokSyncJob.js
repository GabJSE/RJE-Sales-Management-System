import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shopId: { type: String, required: true }, type: { type: String, enum: ["orders", "products", "settlements"], required: true },
  activeKey: String, status: { type: String, enum: ["pending", "running", "completed", "failed"], default: "pending" },
  mode: { type: String, enum: ["manual", "scheduled", "webhook"], default: "manual" },
  options: { from: Date, to: Date, forceFull: { type: Boolean, default: false } },
  stage: { type: String, default: "Queued" }, processed: { type: Number, default: 0 }, recordsProcessed: Number, total: Number, pages: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 }, maxAttempts: { type: Number, default: 4 }, nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date, owner: String, startedAt: Date, completedAt: Date, errorMessage: String,
  apiDiagnostics: mongoose.Schema.Types.Mixed, failedRecords: mongoose.Schema.Types.Mixed, result: mongoose.Schema.Types.Mixed, performance: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
schema.index({ activeKey: 1 }, { unique: true, sparse: true });
schema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
schema.index({ status: 1, leaseUntil: 1 });
schema.index({ shopId: 1, type: 1, createdAt: -1 });
export default mongoose.model("TikTokSyncJob", schema);
