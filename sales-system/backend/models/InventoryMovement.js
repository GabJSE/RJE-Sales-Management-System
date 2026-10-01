import mongoose from "mongoose";

const inventoryMovementSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["STOCK_IN", "STOCK_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "SALE", "SALE_CANCELLATION"],
      required: true,
    },
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    previousStock: { type: Number, required: true, min: 0, validate: Number.isInteger },
    newStock: { type: Number, required: true, min: 0, validate: Number.isInteger },
    reason: { type: String, required: true, trim: true, maxlength: 200 },
    referenceId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

export default mongoose.model("InventoryMovement", inventoryMovementSchema);
