import test from "node:test";
import assert from "node:assert/strict";
import { createThemeStore, normalizeTheme, resolveTheme, THEME_KEY } from "../src/utils/theme.js";

function environment(saved, systemDark = false, blocked = false) {
  const host = new EventTarget(); const media = new EventTarget(); media.matches = systemDark;
  host.document = { documentElement: { dataset: {}, style: {} }, querySelector: () => null };
  host.matchMedia = () => media;
  host.localStorage = { getItem() { if (blocked) throw Error("blocked"); return saved; }, setItem(key, value) { if (blocked) throw Error("blocked"); assert.equal(key, THEME_KEY); saved = value; } };
  return { host, media, saved: () => saved };
}
test("validates preferences and resolves all three modes", () => {
  assert.equal(normalizeTheme("invalid"), "system");
  for (const dark of [true, false]) {
    assert.equal(resolveTheme("dark", dark), "dark"); assert.equal(resolveTheme("light", dark), "light");
    assert.equal(resolveTheme("system", dark), dark ? "dark" : "light");
  }
});
test("applies saved preference immediately and persists without a reload", () => {
  const env = environment("dark"); const store = createThemeStore(env.host);
  assert.equal(env.host.document.documentElement.dataset.theme, "dark");
  let changes = 0; const unsubscribe = store.subscribe(() => changes++);
  store.setPreference("light"); assert.equal(env.saved(), "light"); assert.equal(changes, 1);
  const stable = store.getSnapshot(); store.setPreference("light"); assert.equal(store.getSnapshot(), stable);
  unsubscribe();
});
test("system follows OS changes; explicit choices ignore them", () => {
  const env = environment("system"); const store = createThemeStore(env.host); const off = store.subscribe(() => {});
  env.media.matches = true; env.media.dispatchEvent(new Event("change")); assert.equal(store.getSnapshot().resolved, "dark");
  store.setPreference("light"); env.media.dispatchEvent(new Event("change")); assert.equal(store.getSnapshot().resolved, "light");
  off(); env.media.matches = false; store.subscribe(() => {})(); assert.equal(store.getSnapshot().resolved, "light");
});
test("synchronizes other tabs, handles clearing and cleans up listeners", () => {
  const env = environment("light", true); const store = createThemeStore(env.host); let changes = 0; const off = store.subscribe(() => changes++);
  const event = new Event("storage"); Object.assign(event, { key: THEME_KEY, newValue: "dark" }); env.host.dispatchEvent(event);
  assert.equal(store.getSnapshot().preference, "dark");
  const clear = new Event("storage"); Object.assign(clear, { key: null, newValue: null }); env.host.dispatchEvent(clear);
  assert.equal(store.getSnapshot().preference, "system"); assert.equal(changes, 2);
  off(); env.media.matches = false; env.media.dispatchEvent(new Event("change")); assert.equal(changes, 2);
});
test("blocked storage and absent media support retain functional controls", () => {
  const env = environment(null, true, true); const store = createThemeStore(env.host);
  assert.equal(store.getSnapshot().resolved, "dark"); assert.doesNotThrow(() => store.setPreference("light"));
  delete env.host.matchMedia; assert.equal(createThemeStore(env.host).getSnapshot().resolved, "light");
});
