import mongoose from "mongoose";

const schema = new mongoose.Schema({
  shopId: { type: String, required: true },
  transactionId: { type: String, required: true },
  statementId: { type: String, required: true },
  orderId: String,
  type: String,
  settlementDate: { type: Date, required: true },
  currency: String,
  grossRevenue: { type: Number, default: 0 },
  platformFees: { type: Number, default: 0 },
  withholdingTaxes: { type: Number, default: 0 },
  shippingAdjustments: { type: Number, default: 0 },
  adjustmentAmount: { type: Number, default: 0 },
  netSettlement: { type: Number, default: 0 },
  capitalCost: { type: Number, default: 0 },
  capitalCostKnown: { type: Boolean, default: true },
  profit: Number,
  rawFingerprint: String,
  synchronizedAt: { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ shopId: 1, transactionId: 1 }, { unique: true });
schema.index({ shopId: 1, settlementDate: 1 });
export default mongoose.model("TikTokSettlementTransaction", schema);
