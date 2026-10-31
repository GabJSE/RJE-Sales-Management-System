import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shopId: { type: String, required: true }, transactionId: { type: String, required: true },
  type: { type: String, enum: ["WITHDRAW", "SETTLE", "TRANSFER", "REVERSE"], required: true },
  status: String, amountMinor: { type: String, required: true }, originalAmount: { type: String, required: true },
  currency: { type: String, required: true }, transactionDate: { type: Date, required: true, index: true }, lastSyncedAt: Date,
  linkedSettlementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "TikTokSettlement" }],
  capitalCostMinor: String, profitMinor: String, orderCount: { type: Number, default: 0 }, adjustmentCount: { type: Number, default: 0 },
  reconciliationStatus: { type: String, enum: ["awaiting_transactions", "awaiting_cost", "reconciled", "ambiguous", "amount_mismatch"], default: "awaiting_transactions", index: true },
}, { timestamps: true });
schema.index({ shopId: 1, transactionId: 1 }, { unique: true });
schema.index({ shopId: 1, transactionDate: -1 });
export default mongoose.model("TikTokEarning", schema);
