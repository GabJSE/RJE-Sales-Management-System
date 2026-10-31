import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shopId: { type: String, required: true }, statementId: { type: String, required: true }, settlementDate: { type: Date, required: true, index: true },
  settlementPeriod: { start: Date, end: Date }, currency: { type: String, default: "PHP" },
  totalRevenueMinor: { type: String, default: "0" }, totalFeesMinor: { type: String, default: "0" }, totalTaxesMinor: { type: String, default: "0" },
  totalRefundsMinor: { type: String, default: "0" }, totalAdjustmentsMinor: { type: String, default: "0" }, netSettlementMinor: { type: String, default: "0" },
  totalCapitalCostMinor: { type: String, default: "0" }, calculatedProfitMinor: String, profitMarginBasisPoints: Number,
  unreconciledAmountMinor: { type: String, default: "0" }, orderCount: { type: Number, default: 0 }, transactionCount: { type: Number, default: 0 },
  reconciliationStatus: { type: String, enum: ["reconciled", "awaiting_reconciliation", "amount_mismatch"], default: "awaiting_reconciliation", index: true },
  sourceTotals: mongoose.Schema.Types.Mixed, lastSyncedAt: Date,
}, { timestamps: true });
schema.index({ shopId: 1, statementId: 1 }, { unique: true });
export default mongoose.model("TikTokSettlement", schema);
