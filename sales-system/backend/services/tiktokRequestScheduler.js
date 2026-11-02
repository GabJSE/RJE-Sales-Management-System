import { countSync } from "./syncTelemetry.js";
let active = 0; const waiting = []; const cooldowns = new Map();
// One process-wide cap across orders, products and finance, rather than three per caller.
export async function scheduleTikTokRequest(key, send, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  await new Promise(resolve => { if (active < 3) { active++; resolve(); } else waiting.push(resolve); });
  try {
    const delay = (cooldowns.get(key) || 0) - Date.now();
    if (delay > 10000) throw Object.assign(new Error("TikTok requested a rate-limit pause. Synchronization will retry later."), { statusCode: 503, retryAfterMs: delay });
    if (delay > 0) await sleep(delay);
    countSync("apiRequests");
    return await send();
  } finally { const next = waiting.shift(); if (next) next(); else active--; }
}
export function delayTikTokRequests(key, delay) { cooldowns.set(key, Math.max(cooldowns.get(key) || 0, Date.now() + delay)); }
