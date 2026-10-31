import { getTikTokConfig } from "../config/tiktok.js";
import { createTikTokSignature } from "./tiktokSignature.js";
import { getAccessToken, refreshAccessToken } from "./tiktokOAuthService.js";
export const failure = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function tiktokRequest(path, { method = "GET", query = {}, body } = {}, deps = {}) {
  const config = (deps.config || getTikTokConfig)();
  const send = deps.fetch || fetch;
  let token = await (deps.getToken || getAccessToken)();
  let refreshed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const params = { ...query, app_key: config.appKey, timestamp: Math.floor(Date.now() / 1000) };
    const serialized = body === undefined ? "" : JSON.stringify(body);
    params.sign = createTikTokSignature({ appSecret: config.appSecret, path, query: params, body: serialized });
    const url = new URL(path, config.apiBaseUrl);
    Object.entries(params).forEach(([key, value]) => { if (value !== undefined) url.searchParams.set(key, String(value)); });
    let response;
    try {
      response = await send(url, { method, headers: { "Content-Type": "application/json", "x-tts-access-token": token }, ...(serialized ? { body: serialized } : {}), signal: AbortSignal.timeout(20000) });
    } catch { throw failure("TikTok could not be reached. Please retry."); }
    const payload = await response.json().catch(() => null);
    const code = Number(payload?.code);
    if ((response.status === 401 || [105002, 105006, 105007].includes(code)) && !refreshed) {
      token = await (deps.refreshToken || refreshAccessToken)(); refreshed = true; continue;
    }
    if (response.status === 429 || code === 104029 || response.status >= 500) {
      if (attempt < 3) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 500 * 2 ** attempt;
        await (deps.sleep || sleep)(Math.min(10000, Math.max(500, delay || 500))); continue;
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
    if (!response.ok || !payload || code !== 0 || !payload.data) throw failure(`TikTok request failed (HTTP ${response.status}, code ${Number.isFinite(code) ? code : "unknown"}).`);
    return payload.data;
  }
  throw failure("TikTok authorization could not be refreshed. Reconnect the shop.", 401);
}

