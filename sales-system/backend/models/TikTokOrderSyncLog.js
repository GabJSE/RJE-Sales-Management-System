import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true }, mode: { type: String, enum: ["manual", "scheduled"], required: true },
  rangeStart: Date, rangeEnd: Date, status: { type: String, enum: ["running", "completed", "failed"], required: true, index: true },
  pagesProcessed: { type: Number, default: 0 }, ordersFound: { type: Number, default: 0 }, ordersCreated: { type: Number, default: 0 },
  ordersUpdated: { type: Number, default: 0 }, unmatchedItems: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now }, completedAt: Date, errorMessage: String,
}, { timestamps: true });
schema.index({ startedAt: -1 });
export default mongoose.model("TikTokOrderSyncLog", schema);
