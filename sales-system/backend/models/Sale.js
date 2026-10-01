import mongoose from "mongoose";

const saleSchema = new mongoose.Schema(
  {
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
