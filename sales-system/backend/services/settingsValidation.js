export const currencySymbols = { PHP: "₱", USD: "$", EUR: "€", JPY: "¥", SGD: "S$" };
export const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const normalizePhone = value => String(value).trim().replace(/[\s().-]/g, "");
export const validPhone = value => value === "" || /^(?:09\d{9}|\+639\d{9}|0[2-8]\d{7,9}|\+63[2-8]\d{7,9})$/.test(normalizePhone(value));
export const validTimezone = value => { try { if (typeof value !== "string" || !value) return false; new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } };
export function validateSettings(data) {
  const errors = {};
  if (data.businessName !== undefined && (typeof data.businessName !== "string" || !data.businessName.trim() || data.businessName.length > 160)) errors.businessName = "Enter a business name of up to 160 characters.";
  if (data.address !== undefined && (typeof data.address !== "string" || data.address.length > 300)) errors.address = "Address must be at most 300 characters.";
  if (data.email !== undefined && (typeof data.email !== "string" || data.email.length > 160 || data.email !== "" && !validEmail(data.email))) errors.email = "Enter a valid business email or leave it blank.";
  if (data.contactNumber !== undefined && (typeof data.contactNumber !== "string" || !validPhone(data.contactNumber))) errors.contactNumber = "Use a Philippine number including 0 or +63 and an area/mobile code.";
  if (data.lowStockThreshold !== undefined && (!/^\d+$/.test(String(data.lowStockThreshold)) || !Number.isSafeInteger(Number(data.lowStockThreshold)) || Number(data.lowStockThreshold) > 100000)) errors.lowStockThreshold = "Enter a whole number from 0 to 100,000.";
  if (data.enableLowStockAlerts !== undefined && typeof data.enableLowStockAlerts !== "boolean") errors.enableLowStockAlerts = "Choose enabled or disabled.";
  if (data.currency !== undefined && !Object.hasOwn(currencySymbols, data.currency)) errors.currency = "Choose a supported currency.";
  if (data.dateFormat !== undefined && !["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(data.dateFormat)) errors.dateFormat = "Choose a supported date format.";
  if (data.timezone !== undefined && !validTimezone(data.timezone)) errors.timezone = "Choose a valid IANA timezone.";
  if (data.defaultDashboardPeriod !== undefined && !["today", "week", "month", "year"].includes(data.defaultDashboardPeriod)) errors.defaultDashboardPeriod = "Choose a supported dashboard period.";
  return errors;
}
export const passwordIssue = value => typeof value !== "string" || [...value].length < 15 ? "Use a passphrase of at least 15 characters." : Buffer.byteLength(value, "utf8") > 72 ? "Password must not exceed 72 UTF-8 bytes." : null;
