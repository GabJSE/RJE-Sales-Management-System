import { createContext, useContext, useEffect, useState } from "react";
import { getSettings } from "../services/settingsService.js";

const defaults = { currency: "PHP", currencySymbol: "₱", dateFormat: "DD/MM/YYYY", timezone: "Asia/Manila", lowStockThreshold: 5, defaultTikTokFee: 0, allowManualTikTokFee: true, defaultDashboardPeriod: "month", enableLowStockAlerts: true, businessName: "RJE Motorparts & Accessories" };
const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(defaults);
  const [isLoading, setIsLoading] = useState(true);
  const refreshSettings = async () => { const next = await getSettings(); setSettings(next); return next; };
  useEffect(() => { refreshSettings().catch(() => {}).finally(() => setIsLoading(false)); }, []);
  const formatCurrency = (value) => `${settings.currencySymbol || settings.currency} ${new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    if (settings.dateFormat === "YYYY-MM-DD") return date.toLocaleDateString("en-CA", { timeZone: settings.timezone });
    return date.toLocaleDateString(settings.dateFormat === "MM/DD/YYYY" ? "en-US" : "en-GB", { timeZone: settings.timezone });
  };
  return <SettingsContext.Provider value={{ settings, setSettings, refreshSettings, formatCurrency, formatDate, isLoading }}>{children}</SettingsContext.Provider>;
}
export const useSettings = () => useContext(SettingsContext);
