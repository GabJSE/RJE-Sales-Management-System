import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shopId: { type: String, required: true }, transactionId: { type: String, required: true }, statementId: { type: String, required: true, index: true },
  tiktokOrderId: String, transactionType: String, transactionDate: Date, orderDate: Date, statementDate: Date,
  currency: { type: String, default: "PHP" }, revenueMinor: { type: String, default: "0" }, feeMinor: { type: String, default: "0" },
  taxMinor: { type: String, default: "0" }, shippingMinor: { type: String, default: "0" }, refundMinor: { type: String, default: "0" },
  adjustmentMinor: { type: String, default: "0" }, settlementMinor: { type: String, default: "0" }, capitalCostMinor: String, profitMinor: String,
  capitalCostKnown: { type: Boolean, default: false }, reconciliationStatus: { type: String, enum: ["reconciled", "awaiting_order", "awaiting_cost", "unmatchable"], index: true },
  linkedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "TikTokOrder" }, feeBreakdown: mongoose.Schema.Types.Mixed, taxBreakdown: mongoose.Schema.Types.Mixed,
  retryCount: { type: Number, default: 0 }, lastRetriedAt: { type: Date, default: null },
  originalAmounts: mongoose.Schema.Types.Mixed, lastSyncedAt: Date,
  revenueBreakdown: mongoose.Schema.Types.Mixed, shippingBreakdown: mongoose.Schema.Types.Mixed, supplementaryAmounts: mongoose.Schema.Types.Mixed,
  isCurrent: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ shopId: 1, transactionId: 1 }, { unique: true });
schema.index({ shopId: 1, statementDate: -1 });
schema.index({ shopId: 1, tiktokOrderId: 1, transactionType: 1, reconciliationStatus: 1, statementDate: 1 });
schema.index({ shopId: 1, reconciliationStatus: 1, statementId: 1 });
schema.index({ shopId: 1, statementId: 1, transactionDate: 1 });
schema.index({ tiktokOrderId: 1, shopId: 1 });
export default mongoose.model("TikTokFinanceTransaction", schema);
