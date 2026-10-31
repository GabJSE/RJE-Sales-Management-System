import mongoose from "mongoose";
const lineSchema = new mongoose.Schema({
  lineItemId: String, productId: String, skuId: String, sellerSku: String, skuName: String,
  productName: String, imageUrl: String, currency: String, quantity: { type: Number, default: 1 },
  originalPrice: String, salePrice: String, platformDiscount: String, sellerDiscount: String, itemTax: String,
  rjeProductId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  capitalCostSnapshot: Number,
  capitalCostMinorSnapshot: { type: String, default: null }, capitalCostEffectiveAt: Date,
  capitalCostSource: { type: String, enum: ["variant_history", "legacy_product", "historical_override", "missing"], default: "missing" },
  mappingStatus: { type: String, enum: ["mapped", "unmatched", "duplicate"], default: "unmatched" },
  mappingSource: { type: String, enum: ["sku_id", "seller_sku", "none"], default: "none" },
}, { _id: false });
const statusHistorySchema = new mongoose.Schema({ status: String, observedAt: Date }, { _id: false });
const schema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true }, orderId: { type: String, required: true },
  status: { type: String, index: true }, orderType: String, fulfillmentType: String, shippingType: String,
  currency: String, totalAmount: String, subtotal: String, shippingFee: String, platformDiscount: String, sellerDiscount: String,
  paymentMethodName: String, isCod: Boolean, isSampleOrder: Boolean, isOnHoldOrder: Boolean,
  buyerNickname: String,
  recipient: { name: String, regionCode: String, postTown: String, district: String, postalCode: String },
  trackingNumber: String, shippingProvider: String,
  createdAtTikTok: { type: Date, index: true }, updatedAtTikTok: { type: Date, index: true }, paidAtTikTok: Date,
  cancelledAtTikTok: Date, deliveredAtTikTok: Date,
  lines: { type: [lineSchema], default: [] }, statusHistory: { type: [statusHistorySchema], default: [] },
  finance: { type: mongoose.Schema.Types.Mixed, default: null }, financeSyncedAt: Date,
  importedAt: { type: Date, default: Date.now }, lastSynchronizedAt: Date,
}, { timestamps: true });
schema.index({ shopId: 1, orderId: 1 }, { unique: true });
schema.index({ shopId: 1, createdAtTikTok: -1, orderId: 1 });
export default mongoose.model("TikTokOrder", schema);
