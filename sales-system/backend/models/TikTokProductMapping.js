import mongoose from "mongoose";
const schema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true },
  tiktokProductId: { type: String, required: true },
  tiktokSkuId: { type: String, required: true },
  title: String, imageUrl: String, sellerSku: String, normalizedSku: { type: String, index: true },
  price: String, currency: String, stock: { type: Number, default: null }, status: String,
  capitalCostMinor: { type: String, default: null }, capitalCostEffectiveFrom: { type: Date, default: null },
  archivedAt: { type: Date, default: null },
  variations: [{ _id: false, name: String, value: String }],
  rjeProductId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  mappingSource: { type: String, enum: ["auto", "manual"], default: "auto" },
  mappingStatus: { type: String, enum: ["mapped", "unmatched", "duplicate"], default: "unmatched" },
  lastSyncedAt: Date,
}, { timestamps: true });
schema.index({ shopId: 1, tiktokProductId: 1, tiktokSkuId: 1 }, { unique: true });
schema.index({ shopId: 1, capitalCostMinor: 1, archivedAt: 1 });
schema.index({ archivedAt: 1, stock: 1 });
export default mongoose.model("TikTokProductMapping", schema);
