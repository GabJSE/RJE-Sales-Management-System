import { countSync } from "./syncTelemetry.js";
const entries = new Map(); const pending = new Map(); const generations = new Map();
export const financeCacheTtl = () => Math.max(120, Math.min(300, Number(process.env.TIKTOK_FINANCE_CACHE_SECONDS) || 180)) * 1000;
export const financeCacheKey = (shopId, path, query = {}) => JSON.stringify([shopId, path, Object.entries(query).sort(([a], [b]) => a.localeCompare(b))]);
export async function cachedFinance(shopId, path, query, load, { bypass = false, now = Date.now(), ttl = financeCacheTtl() } = {}) {
  const key = financeCacheKey(shopId, path, query); const cached = entries.get(key);
  if (!bypass && cached && cached.expires > now) { countSync("cacheHits"); return structuredClone(cached.value); }
  entries.delete(key);
  if (pending.has(key)) { countSync("cacheHits"); return structuredClone(await pending.get(key)); }
  const generation = generations.get(shopId) || 0;
  const promise = Promise.resolve().then(load).then(value => {
    if ((generations.get(shopId) || 0) === generation) {
      for (const [oldKey, entry] of entries) if (entry.expires <= Date.now()) entries.delete(oldKey);
      if (entries.size >= 1000) entries.delete(entries.keys().next().value);
      entries.set(key, { value: structuredClone(value), expires: Date.now() + ttl });
    }
    return value;
  });
  pending.set(key, promise);
  try { return structuredClone(await promise); } finally { if (pending.get(key) === promise) pending.delete(key); }
}
export function invalidateFinanceCache(shopId) {
  generations.set(shopId, (generations.get(shopId) || 0) + 1);
  for (const key of pending.keys()) if (JSON.parse(key)[0] === shopId) pending.delete(key);
  for (const key of entries.keys()) if (JSON.parse(key)[0] === shopId) entries.delete(key);
}
