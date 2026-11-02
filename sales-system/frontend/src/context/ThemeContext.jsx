import { createContext, useContext, useSyncExternalStore } from "react";
import { createThemeStore } from "../utils/theme.js";

const ThemeContext = createContext(null);
const themeStore = createThemeStore(window);
export function ThemeProvider({ children }) {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  return <ThemeContext.Provider value={{ ...theme, setPreference: themeStore.setPreference }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
