import mongoose from "mongoose";

const saleItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    sellingPrice: { type: Number, required: true, min: 0 },
    capitalPrice: { type: Number, required: true, min: 0 },
    totalSales: { type: Number, required: true, min: 0 },
    totalCapital: { type: Number, required: true, min: 0 },
    allocatedTikTokFee: { type: Number, required: true, min: 0, default: 0 },
    allocatedWithholdingTax: { type: Number, required: true, min: 0, default: 0 },
    netSales: { type: Number, required: true },
    profit: { type: Number, required: true },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    orderId: { type: String, trim: true, unique: true, sparse: true, maxlength: 80 },
    orderReference: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 500 },
    items: { type: [saleItemSchema], default: undefined },
    totalQuantity: { type: Number, min: 0, validate: Number.isInteger },
    date: {
      type: Date,
      required: [true, "Sale date is required."],
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    productName: {
      type: String,
      required: [true, "Product name is required."],
      trim: true,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required."],
      min: [0, "Quantity cannot be negative."],
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number.",
      },
    },
    sellingPrice: {
      type: Number,
      required: [true, "Selling price is required."],
      min: [0, "Selling price cannot be negative."],
    },
    capitalPrice: {
      type: Number,
      required: [true, "Capital price is required."],
      min: [0, "Capital price cannot be negative."],
    },
    totalSales: { type: Number, required: true, min: 0 },
    totalCapital: { type: Number, required: true, min: 0 },
    tiktokFees: { type: Number, required: true, min: 0 },
    withholdingTax: { type: Number, required: true, min: 0, default: 0 },
    netSales: { type: Number, required: true },
    profit: { type: Number, required: true },
    profitMargin: { type: Number, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Sale", saleSchema);
