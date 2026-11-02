import SystemSettings from "../models/SystemSettings.js";
import { pricingFields, validatePricingSettings } from "../services/tiktokPricingMath.js";
import { currencySymbols, normalizePhone, validateSettings } from "../services/settingsValidation.js";
const defaults = { key: "singleton", businessName: "RJE Motorparts & Accessories", address: "", contactNumber: "", email: "", logo: "", currency: "PHP", currencySymbol: "₱", dateFormat: "DD/MM/YYYY", timezone: "Asia/Manila", lowStockThreshold: 5, enableLowStockAlerts: true, defaultDashboardPeriod: "month" };
export const getSettingsDocument = async () => SystemSettings.findOneAndUpdate({ key: "singleton" }, { $setOnInsert: defaults }, { new: true, upsert: true });
export const getSettings = async (_req, res, next) => { try { const settings = await getSettingsDocument(); res.json({ ...settings.toObject(), currencySymbol: currencySymbols[settings.currency] || "₱" }); } catch (error) { next(error); } };
const sectionFields = { business: ["businessName", "address", "contactNumber", "email", "logo"], inventory: ["lowStockThreshold", "enableLowStockAlerts"], preferences: ["currency", "currencySymbol", "dateFormat", "timezone", "defaultDashboardPeriod"], pricing: pricingFields };
export const updateSettings = async (req, res, next) => {
  try {
    if (req.params.section && !Object.hasOwn(sectionFields, req.params.section)) return res.status(400).json({ message: "Invalid settings section." });
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ message: "Provide a settings object." });
    const allowed = req.params.section ? sectionFields[req.params.section] : Object.values(sectionFields).flat();
    const updates = Object.fromEntries(allowed.filter(field => req.body[field] !== undefined).map(field => [field, req.body[field]]));
    if (pricingFields.some(field => updates[field] !== undefined)) {
      if (!pricingFields.every(field => updates[field] !== undefined)) return res.status(400).json({ message: "Save all five pricing preferences together." });
      const pricingErrors = validatePricingSettings(updates);
      if (Object.keys(pricingErrors).length) return res.status(400).json({ message: "Check the highlighted pricing preferences.", errors: pricingErrors });
      for (const field of pricingFields) if (updates[field] !== null) updates[field] = Number(updates[field]);
    }
    for (const field of ["businessName", "address", "email", "contactNumber"]) if (typeof updates[field] === "string") updates[field] = updates[field].trim();
    const errors = validateSettings(updates); if (Object.keys(errors).length) return res.status(400).json({ message: "Check the highlighted settings.", errors });
    if (updates.contactNumber !== undefined) updates.contactNumber = normalizePhone(updates.contactNumber);
    if (updates.email !== undefined) updates.email = updates.email.toLowerCase();
    if (updates.lowStockThreshold !== undefined) updates.lowStockThreshold = Number(updates.lowStockThreshold);
    if (updates.currency !== undefined || updates.currencySymbol !== undefined) { const current = await getSettingsDocument(); updates.currencySymbol = currencySymbols[updates.currency || current.currency]; }
    const settings = await SystemSettings.findOneAndUpdate({ key: "singleton" }, { $set: { ...updates, updatedBy: req.user._id } }, { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true });
    res.json(settings);
  } catch (error) { next(error); }
};
