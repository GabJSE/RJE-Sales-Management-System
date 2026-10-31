import mongoose from "mongoose";

const schema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true },
  tiktokProductId: { type: String, required: true },
  tiktokSkuId: { type: String, required: true },
  costMinor: { type: String, required: true, match: /^\d+$/ },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, default: null },
  source: { type: String, enum: ["manual", "migration", "historical_override"], required: true },
  reason: { type: String, maxlength: 300, default: "" },
  orderId: { type: String, default: null },
  lineItemId: { type: String, default: null },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

schema.index({ shopId: 1, tiktokProductId: 1, tiktokSkuId: 1, effectiveFrom: -1 });
schema.index({ shopId: 1, orderId: 1, lineItemId: 1 });
export default mongoose.model("TikTokVariantCost", schema);
