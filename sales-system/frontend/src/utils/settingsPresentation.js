export const symbols = { PHP: "₱", USD: "$", EUR: "€", JPY: "¥", SGD: "S$" };
export const pricingPreferenceDefaults = { pricingMinimumMargin: 20, pricingTargetMargin: 25, pricingDeductionRate: null, pricingRoundingIncrement: 0.01, pricingOperatingExpense: 0 };
export const settingsFields = { business: ["businessName", "address", "contactNumber", "email"], preferences: ["currency", "dateFormat", "timezone", "defaultDashboardPeriod"], inventory: ["lowStockThreshold", "enableLowStockAlerts"], pricing: Object.keys(pricingPreferenceDefaults) };
export function settingsSnapshot(settings) { return { ...Object.fromEntries(Object.entries(pricingPreferenceDefaults).map(([key,value]) => [key, String(settings[key] ?? value ?? "")])), businessName: settings.businessName ?? "", address: settings.address ?? "", contactNumber: settings.contactNumber ?? "", email: settings.email ?? "", currency: settings.currency || "PHP", dateFormat: settings.dateFormat || "DD/MM/YYYY", timezone: settings.timezone || "Asia/Manila", defaultDashboardPeriod: settings.defaultDashboardPeriod || "month", lowStockThreshold: String(settings.lowStockThreshold ?? 5), enableLowStockAlerts: settings.enableLowStockAlerts !== false }; }
export const changedFields = (form, baseline, fields) => Boolean(form && baseline && fields.some(field => form[field] !== baseline[field]));
export function settingErrors(section, form) {
  const errors = {}; if (!form) return errors;
  if (section === "business") { if (!form.businessName.trim() || form.businessName.length > 160) errors.businessName = "Enter a business name (up to 160 characters)."; if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email address."; if (form.contactNumber && !/^(?:09\d{9}|\+639\d{9}|0[2-8]\d{7,9}|\+63[2-8]\d{7,9})$/.test(form.contactNumber.replace(/[\s().-]/g, ""))) errors.contactNumber = "Use 09…, +639… or a landline with its area code."; }
  if (section === "inventory" && (!/^\d+$/.test(form.lowStockThreshold) || Number(form.lowStockThreshold) > 100000)) errors.lowStockThreshold = "Enter a whole number from 0 to 100,000.";
  if (section === "preferences") { try { new Intl.DateTimeFormat("en", { timeZone: form.timezone }); } catch { errors.timezone = "Choose a valid timezone."; } }
  if (section === "pricing") {
    for (const key of Object.keys(pricingPreferenceDefaults)) {
      if (key === "pricingDeductionRate" && form[key] === "") continue;
      if (!/^\d+(?:\.\d{1,2})?$/.test(String(form[key])) || Number(form[key]) > 1000000000) errors[key] = "Enter a nonnegative amount with up to two decimals.";
    }
    if (Number(form.pricingMinimumMargin) < 20 || Number(form.pricingMinimumMargin) > 99) errors.pricingMinimumMargin = "Minimum must be from 20% to 99%.";
    if (Number(form.pricingTargetMargin) < Number(form.pricingMinimumMargin) || Number(form.pricingTargetMargin) >= 100) errors.pricingTargetMargin = "Target must be at least the minimum and below 100%.";
    if (form.pricingDeductionRate !== "" && Number(form.pricingDeductionRate) >= 100) errors.pricingDeductionRate = "Deduction rate must be below 100%.";
    if (Number(form.pricingRoundingIncrement) < .01) errors.pricingRoundingIncrement = "Increment must be at least 0.01.";
  }
  return errors;
}
export const passwordValidation = value => [...value].length < 15 ? "Use a passphrase of at least 15 characters." : new TextEncoder().encode(value).length > 72 ? "Use no more than 72 UTF-8 bytes." : "";
export function displayDate(value, settings = {}, includeTime = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Not available";
  let parts; try { parts = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone || "Asia/Manila", day: "2-digit", month: "2-digit", year: "numeric", ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).formatToParts(new Date(value)); } catch { return displayDate(value, { ...settings, timezone: "Asia/Manila" }, includeTime); }
  const get = key => parts.find(part => part.type === key)?.value || "";
  const date = settings.dateFormat === "YYYY-MM-DD" ? `${get("year")}-${get("month")}-${get("day")}` : settings.dateFormat === "MM/DD/YYYY" ? `${get("month")}/${get("day")}/${get("year")}` : `${get("day")}/${get("month")}/${get("year")}`;
  return includeTime ? `${date}, ${get("hour")}:${get("minute")}` : date;
}
export const displayMoney = (value, currency = "PHP") => value == null || !Number.isFinite(Number(value)) ? "Unconfirmed" : new Intl.NumberFormat("en-PH", { style: "currency", currency: Object.hasOwn(symbols, currency) ? currency : "PHP" }).format(Number(value));
export function connectionHealth(status, now = Date.now()) { if (!status?.connected) return "Disconnected"; if (status.refreshTokenExpiresAt && new Date(status.refreshTokenExpiresAt).getTime() <= now) return "Expired"; if (!status.shopId || !status.scopes?.length) return "Needs Attention"; return "Connected"; }
export function displayCalendarDate(value, format = "DD/MM/YYYY") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) return "Select date";
  const [year, month, day] = value.split("-"); return format === "YYYY-MM-DD" ? value : format === "MM/DD/YYYY" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}
