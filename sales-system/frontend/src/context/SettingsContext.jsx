import { createContext, useContext, useEffect, useRef, useState } from "react";
import { getSettings } from "../services/settingsService.js";
import { displayDate, displayMoney, symbols } from "../utils/settingsPresentation.js";
const defaults = { currency: "PHP", currencySymbol: "₱", dateFormat: "DD/MM/YYYY", timezone: "Asia/Manila", lowStockThreshold: 5, defaultDashboardPeriod: "month", enableLowStockAlerts: true, businessName: "RJE Motorparts & Accessories" };
const SettingsContext = createContext(null);
export function SettingsProvider({ children }) {
  const sequence = useRef(0);
  const [settings, setSettings] = useState(defaults); const [isLoading, setIsLoading] = useState(true); const [error, setError] = useState("");
  const refreshSettings = async () => { const version = ++sequence.current; setIsLoading(true); try { const next = await getSettings(); if (!next?._id || typeof next.businessName !== "string") throw new Error("The server did not return saved settings. Please retry."); if (version === sequence.current) { setSettings({ ...next, currencySymbol: symbols[next.currency] || "?" }); setError(""); } return next; } catch (failure) { if (version === sequence.current) setError(failure.message); throw failure; } finally { if (version === sequence.current) setIsLoading(false); } };
  useEffect(() => { if (!sequence.current) refreshSettings().catch(() => {}); }, []);
  const formatCurrency = (value, currency = settings.currency) => displayMoney(value, currency);
  const formatDate = value => displayDate(value, settings); const formatDateTime = value => displayDate(value, settings, true);
  return <SettingsContext.Provider value={{ settings, setSettings, refreshSettings, formatCurrency, formatDate, formatDateTime, isLoading, error }}>{children}</SettingsContext.Provider>;
}
export const useSettings = () => useContext(SettingsContext);
