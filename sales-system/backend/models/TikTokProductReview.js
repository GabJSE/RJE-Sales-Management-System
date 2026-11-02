import mongoose from "mongoose";

const auditSchema = new mongoose.Schema({ action: { type: String, required: true }, at: { type: Date, default: Date.now }, user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, details: { type: String, maxlength: 500, default: "" } }, { _id: true });
const schema = new mongoose.Schema({
  shopId: { type: String, required: true, index: true }, source: { type: String, enum: ["manual", "csv"], required: true }, externalReviewId: { type: String, trim: true, default: null },
  variantId: { type: mongoose.Schema.Types.ObjectId, ref: "TikTokProductMapping", default: null }, tiktokProductId: String, tiktokSkuId: String, productName: { type: String, required: true, trim: true, maxlength: 300 }, sellerSku: { type: String, trim: true, maxlength: 120 },
  rating: { type: Number, required: true, min: 1, max: 5 }, reviewerName: { type: String, trim: true, maxlength: 80, default: "TikTok customer" }, reviewText: { type: String, trim: true, maxlength: 5000, default: "" }, reviewDate: { type: Date, required: true, index: true },
  replyText: { type: String, trim: true, maxlength: 2000, default: "" }, replyLanguage: { type: String, enum: ["tagalog", "taglish", "english"], default: "tagalog" }, replyTone: { type: String, enum: ["friendly", "professional", "casual", "warm"], default: "friendly" },
  status: { type: String, enum: ["NEW", "DRAFT_GENERATED", "PENDING_APPROVAL", "APPROVED", "MANUALLY_PUBLISHED"], default: "NEW", index: true },
  approvedAt: Date, approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, manuallyPublishedAt: Date, manuallyPublishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, auditHistory: { type: [auditSchema], default: [] },
}, { timestamps: true });
schema.index({ shopId: 1, externalReviewId: 1 }, { unique: true, partialFilterExpression: { externalReviewId: { $type: "string" } } });
schema.index({ shopId: 1, rating: 1, status: 1, reviewDate: -1 });
export default mongoose.model("TikTokProductReview", schema);
