import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true }, mode: { type: String, enum: ["manual", "scheduled"], required: true }, status: { type: String, enum: ["running", "completed", "failed"], required: true },
  rangeStart: Date, rangeEnd: Date, ordersChecked: { type: Number, default: 0 }, statementsFound: { type: Number, default: 0 }, transactionsImported: { type: Number, default: 0 },
  reconciledStatements: { type: Number, default: 0 }, startedAt: { type: Date, default: Date.now }, completedAt: Date, errorMessage: String,
}, { timestamps: true });
schema.index({ startedAt: -1 });
export default mongoose.model("TikTokFinanceSyncLog", schema);
