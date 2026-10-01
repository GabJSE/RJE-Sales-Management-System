import SystemSettings from "../models/SystemSettings.js";

const defaults = {
  key: "singleton",
  businessName: "RJE Motorparts & Accessories",
  address: "",
  contactNumber: "",
  email: "",
  logo: "",
  currency: "PHP",
  currencySymbol: "₱",
  dateFormat: "DD/MM/YYYY",
  timezone: "Asia/Manila",
  lowStockThreshold: 5,
  enableLowStockAlerts: true,
  defaultTikTokFee: 0,
  allowManualTikTokFee: true,
  defaultDashboardPeriod: "month",
};

export const getSettingsDocument = async () => SystemSettings.findOneAndUpdate({ key: "singleton" }, { $setOnInsert: defaults }, { new: true, upsert: true });

export const getSettings = async (_req, res, next) => {
  try { res.json(await getSettingsDocument()); } catch (error) { next(error); }
};

const sectionFields = {
  business: ["businessName", "address", "contactNumber", "email", "logo"],
  inventory: ["lowStockThreshold", "enableLowStockAlerts"],
  sales: ["defaultTikTokFee", "allowManualTikTokFee"],
  preferences: ["currency", "currencySymbol", "dateFormat", "timezone", "defaultDashboardPeriod"],
};

const validate = (data) => {
  if (data.lowStockThreshold !== undefined && (!Number.isInteger(Number(data.lowStockThreshold)) || Number(data.lowStockThreshold) < 0)) throw Object.assign(new Error("Low-stock threshold must be a non-negative whole number."), { statusCode: 400 });
  if (data.defaultTikTokFee !== undefined && (!Number.isFinite(Number(data.defaultTikTokFee)) || Number(data.defaultTikTokFee) < 0)) throw Object.assign(new Error("Default TikTok fee cannot be negative."), { statusCode: 400 });
  if (data.currency !== undefined && !["PHP", "USD", "EUR", "JPY", "SGD"].includes(data.currency)) throw Object.assign(new Error("Unsupported currency."), { statusCode: 400 });
  if (data.dateFormat !== undefined && !["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(data.dateFormat)) throw Object.assign(new Error("Unsupported date format."), { statusCode: 400 });
  if (data.defaultDashboardPeriod !== undefined && !["today", "week", "month", "year"].includes(data.defaultDashboardPeriod)) throw Object.assign(new Error("Unsupported dashboard period."), { statusCode: 400 });
};

export const updateSettings = async (req, res, next) => {
  try {
    const allowed = req.params.section ? sectionFields[req.params.section] : Object.values(sectionFields).flat();
    if (!allowed) return res.status(400).json({ message: "Invalid settings section." });
    const updates = Object.fromEntries(allowed.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    validate(updates);
    if (updates.lowStockThreshold !== undefined) updates.lowStockThreshold = Number(updates.lowStockThreshold);
    if (updates.defaultTikTokFee !== undefined) updates.defaultTikTokFee = Number(updates.defaultTikTokFee);
    const settings = await SystemSettings.findOneAndUpdate({ key: "singleton" }, { ...updates, updatedBy: req.user._id }, { new: true, upsert: true, setDefaultsOnInsert: true });
    res.json(settings);
  } catch (error) { next(error); }
};
