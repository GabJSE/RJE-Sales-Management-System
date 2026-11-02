import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";

export default function ThemeControl({ compact = false }) {
  const { resolved, setPreference } = useTheme();
  const dark = resolved === "dark";
  const nextTheme = dark ? "light" : "dark";

  return <div className={`theme-control ${compact ? "theme-control-compact" : ""}`}>
    {!compact && <span className="theme-control-label">Theme</span>}
    <button
      className="theme-switch"
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      data-theme-state={resolved}
      onClick={() => setPreference(nextTheme)}
    >
      <span className="theme-switch-thumb" aria-hidden="true" />
      <Sun className="theme-switch-icon theme-switch-sun" size={15} strokeWidth={2.2} aria-hidden="true" />
      <Moon className="theme-switch-icon theme-switch-moon" size={14} strokeWidth={2.2} aria-hidden="true" />
    </button>
    {!compact && <span className="theme-control-value" aria-hidden="true">{dark ? "Dark mode" : "Light mode"}</span>}
  </div>;
}
