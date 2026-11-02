import mongoose from "mongoose";

const systemSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "singleton", unique: true, immutable: true },
    businessName: { type: String, default: "RJE Motorparts & Accessories", trim: true, maxlength: 160 },
    address: { type: String, default: "", trim: true, maxlength: 300 },
    contactNumber: { type: String, default: "", trim: true, maxlength: 40 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },
    logo: { type: String, default: "", trim: true, maxlength: 500 },
    currency: { type: String, enum: ["PHP", "USD", "EUR", "JPY", "SGD"], default: "PHP" },
    currencySymbol: { type: String, default: "₱", trim: true, maxlength: 5 },
    dateFormat: { type: String, enum: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"], default: "DD/MM/YYYY" },
    timezone: { type: String, default: "Asia/Manila", trim: true },
    lowStockThreshold: { type: Number, min: 0, max: 100000, default: 5 },
    enableLowStockAlerts: { type: Boolean, default: true },
    pricingMinimumMargin: { type: Number, min: 20, max: 99, default: 20 },
    pricingTargetMargin: { type: Number, min: 20, max: 99.99, default: 25 },
    pricingDeductionRate: { type: Number, min: 0, max: 99.99, default: null },
    pricingRoundingIncrement: { type: Number, min: 0.01, max: 1000000000, default: 0.01 },
    pricingOperatingExpense: { type: Number, min: 0, max: 1000000000, default: 0 },
    defaultTikTokFee: { type: Number, min: 0, default: 0 },
    allowManualTikTokFee: { type: Boolean, default: true },
    defaultDashboardPeriod: { type: String, enum: ["today", "week", "month", "year"], default: "month" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("SystemSettings", systemSettingsSchema);
