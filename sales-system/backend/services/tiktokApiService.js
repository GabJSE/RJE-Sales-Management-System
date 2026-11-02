import { scheduleTikTokRequest, delayTikTokRequests } from "./tiktokRequestScheduler.js";
import { getTikTokConfig } from "../config/tiktok.js";
import { createTikTokSignature } from "./tiktokSignature.js";
import { getAccessToken, refreshAccessToken } from "./tiktokOAuthService.js";
export const failure = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
function requestFailure(response, payload, path, method) {
  const code = Number(payload?.code);
  const normalized = String(payload?.message || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const field = ["create_time_ge", "create_time_lt", "statement_time_ge", "statement_time_lt", "update_time_ge", "update_time_lt", "page_size"].find(name => normalized.includes(name.replaceAll("_", "")));
  const category = field ? "parameter " + field : normalized.includes("timestamp") ? "request timestamp" : normalized.includes("version") ? "API version" : null;
  // Only allowlisted descriptions and an opaque request ID leave the API boundary.
  const requestId = /^[a-f0-9-]{8,128}$/i.test(String(payload?.request_id || "")) ? payload.request_id : undefined;
  return Object.assign(failure(`TikTok request failed (HTTP ${response.status}, code ${Number.isFinite(code) ? code : "unknown"}) at ${method} ${path}.${category ? " Rejected " + category + "." : ""}`), { apiDiagnostics: { path, method, httpStatus: response.status, code: Number.isFinite(code) ? code : null, field, requestId } });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function tiktokRequest(path, { method = "GET", query = {}, body, retry = true } = {}, deps = {}) {
  const config = (deps.config || getTikTokConfig)();
  const send = deps.fetch || fetch;
  let token = await (deps.getToken || getAccessToken)();
  let refreshed = false;
  const scheduleKey = `${config.appKey}:${query.shop_cipher || "app"}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const params = { ...query, app_key: config.appKey, timestamp: Math.floor(Date.now() / 1000) };
    const serialized = body === undefined ? "" : JSON.stringify(body);
    params.sign = createTikTokSignature({ appSecret: config.appSecret, path, query: params, body: serialized });
    const url = new URL(path, config.apiBaseUrl);
    Object.entries(params).forEach(([key, value]) => { if (value !== undefined) url.searchParams.set(key, String(value)); });
    let response;
    try {
      response = await scheduleTikTokRequest(scheduleKey, () => send(url, { method, headers: { "Content-Type": "application/json", "x-tts-access-token": token }, ...(serialized ? { body: serialized } : {}), signal: AbortSignal.timeout(20000) }), deps.sleep || sleep);
    } catch (error) { if (!retry) throw Object.assign(failure("Delivery is uncertain. Refresh message history before taking further action.", 502), { deliveryUncertain: true }); if (error.retryAfterMs) throw error; throw failure("TikTok could not be reached. Please retry."); }
    const payload = await response.json().catch(() => null);
    const code = Number(payload?.code);
    // Message POSTs must never be replayed, including after auth failures or 5xx.
    if (!retry) {
      if (response.status === 429 || code === 104029) {
        const retryAfter = response.headers.get("retry-after");
        const wait = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 60_000;
        delayTikTokRequests(scheduleKey, Math.max(60_000, wait || 60_000));
      }
      if (response.status >= 500 || !payload || !Number.isFinite(code)) throw Object.assign(failure("Delivery is uncertain. Refresh message history before taking further action.", 502), { deliveryUncertain: true });
      if (!response.ok || code !== 0) throw requestFailure(response, payload, path, method);
      if (!payload.data) throw Object.assign(failure("Delivery is uncertain. Refresh message history.", 502), { deliveryUncertain: true });
      return payload.data;
    }
    if ((response.status === 401 || [105002, 105006, 105007].includes(code)) && !refreshed) {
      token = await (deps.refreshToken || refreshAccessToken)(); refreshed = true; continue;
    }
    if (response.status === 429 || code === 104029 || response.status >= 500) {
      if (attempt < 3) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 500 * 2 ** attempt;
        const wait = Math.max(500, delay || 500);
        delayTikTokRequests(scheduleKey, wait);
        if (wait > 10000) throw Object.assign(failure("TikTok requested a longer rate-limit pause. Synchronization will retry later.", 503), { retryAfterMs: wait });
        await (deps.sleep || sleep)(wait); continue;
      }
      throw failure("TikTok is busy or rate limited. Please retry later.", 503);
    }
    // Never forward upstream messages, URLs, headers or response bodies containing credentials.
    if (code === 106001) {
      throw failure(
        "TikTok rejected the request signature. Verify that TIKTOK_APP_KEY and TIKTOK_APP_SECRET match the same effective OpenAPI app in Partner Center, then restart the backend.",
        502
      );
    }
    if (response.status === 403 || code === 105005) throw failure("TikTok denied access. Verify the required API scope in Partner Center and reauthorize the shop.", 403);
    if (!response.ok || !payload || code !== 0 || !payload.data) throw requestFailure(response, payload, path, method);
    return payload.data;
  }
  throw failure("TikTok authorization could not be refreshed. Reconnect the shop.", 401);
}

