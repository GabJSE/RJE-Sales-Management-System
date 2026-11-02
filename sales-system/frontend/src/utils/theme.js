export const THEME_KEY = "rje-appearance";
export const themeOptions = [["light", "Light Mode"], ["dark", "Dark Mode"], ["system", "System Default"]];
export const normalizeTheme = value => themeOptions.some(([key]) => key === value) ? value : "system";
export const resolveTheme = (preference, systemDark) => normalizeTheme(preference) === "system" ? (systemDark ? "dark" : "light") : preference;

export function readTheme(storage) {
  try { return normalizeTheme(storage.getItem(THEME_KEY)); } catch { return "system"; }
}

// Also used before React mounts; storage may be unavailable in private browsers.
export function createThemeStore(host) {
  let preference;
  try { preference = readTheme(host.localStorage); } catch { preference = "system"; }
  const media = host.matchMedia?.("(prefers-color-scheme: dark)");
  const listeners = new Set();
  let snapshot;
  const apply = () => {
    const resolved = resolveTheme(preference, Boolean(media?.matches));
    if (snapshot?.preference === preference && snapshot?.resolved === resolved) return;
    snapshot = { preference, resolved };
    host.document.documentElement.dataset.theme = resolved;
    host.document.documentElement.style.colorScheme = resolved;
    host.document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#0B1220" : "#F5F7FB");
    listeners.forEach(listener => listener());
  };
  const storageChanged = event => {
    if (event.key === THEME_KEY || event.key === null) {
      preference = normalizeTheme(event.newValue); apply();
    }
  };
  let listening = false;
  const start = () => {
    if (listening) return; listening = true;
    media?.addEventListener("change", apply);
    host.addEventListener("storage", storageChanged);
    apply();
  };
  const stop = () => {
    if (!listening) return; listening = false;
    media?.removeEventListener("change", apply);
    host.removeEventListener("storage", storageChanged);
  };
  apply();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); start(); return () => { listeners.delete(listener); if (!listeners.size) stop(); }; },
    setPreference(value) {
      preference = normalizeTheme(value);
      try { host.localStorage.setItem(THEME_KEY, preference); } catch { /* Still usable for this session. */ }
      apply();
    },
  };
}
