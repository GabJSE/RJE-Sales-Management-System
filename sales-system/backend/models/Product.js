import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required."],
      trim: true,
      maxlength: [120, "Product name must be 120 characters or fewer."],
    },
    brand: {
      type: String,
      trim: true,
      maxlength: [60, "Brand must be 60 characters or fewer."],
    },
    model: {
      type: String,
      trim: true,
      maxlength: [60, "Model must be 60 characters or fewer."],
    },
    sku: {
      type: String,
      required: [true, "SKU is required."],
      trim: true,
      uppercase: true,
      unique: true,
      maxlength: [50, "SKU must be 50 characters or fewer."],
    },
    category: {
      type: String,
      required: [true, "Category is required."],
      trim: true,
      maxlength: [80, "Category must be 80 characters or fewer."],
    },
    capitalPrice: {
      type: Number,
      required: [true, "Capital price is required."],
      min: [0, "Capital price cannot be negative."],
    },
    sellingPrice: {
      type: Number,
      required: [true, "Selling price is required."],
      min: [0, "Selling price cannot be negative."],
    },
    stock: {
      type: Number,
      required: [true, "Stock is required."],
      min: [0, "Stock cannot be negative."],
      validate: {
        validator: Number.isInteger,
        message: "Stock must be a whole number.",
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Product", productSchema);
