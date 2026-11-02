import mongoose from "mongoose";

const schema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true },
  mode: { type: String, enum: ["manual", "scheduled", "webhook"], required: true },
  status: { type: String, enum: ["running", "completed", "failed", "skipped"], required: true, index: true },
  variantsFound: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now, index: true },
  completedAt: Date,
  errorMessage: String,
}, { timestamps: true });

schema.index({ shopId: 1, startedAt: -1 });
export default mongoose.model("TikTokProductSyncLog", schema);
