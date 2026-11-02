import crypto from "node:crypto";
import TikTokOAuthState from "../models/TikTokOAuthState.js";
import TikTokShop from "../models/TikTokShop.js";
import { decryptToken, encryptToken, getTikTokConfig } from "../config/tiktok.js";

const stateLifetimeMs = 10 * 60 * 1000;
const tokenEndpoint = "/api/v2/token/get";
const refreshEndpoint = "/api/v2/token/refresh";

const apiError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const parseTokenResponse = (payload) => {
  if (payload?.code !== undefined && Number(payload.code) !== 0) {
    throw apiError("TikTok token request failed. Reconnect the shop.");
  }
  const data = payload?.data || payload;
  if (!data?.access_token || !data?.refresh_token) throw apiError("TikTok returned an incomplete token response.");
  return data;
};

const requestToken = async (endpoint, params) => {
  const { tokenBaseUrl } = getTikTokConfig();

  const url = new URL(`${tokenBaseUrl}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw apiError(
      `TikTok token request failed with HTTP ${response.status}.`
    );
  }

  return parseTokenResponse(payload);
};

export const createAuthorizationState = async (userId) => {
  const rawState = crypto.randomBytes(32).toString("base64url");
  const stateHash = crypto.createHash("sha256").update(rawState).digest("hex");
  await TikTokOAuthState.create({
    stateHash,
    userId,
    expiresAt: new Date(Date.now() + stateLifetimeMs),
  });
  return rawState;
};

export const consumeAuthorizationState = async (rawState) => {
  if (!rawState || typeof rawState !== "string") throw apiError("OAuth state is missing.", 400);
  const stateHash = crypto.createHash("sha256").update(rawState).digest("hex");
  const state = await TikTokOAuthState.findOneAndDelete({ stateHash, expiresAt: { $gt: new Date() } });
  if (!state) throw apiError("OAuth state is invalid or expired.", 400);
  return state;
};

export const buildAuthorizationUrl = ({ appKey, serviceId, redirectUri, state, authorizationUrl }) => {
  const url = new URL(authorizationUrl);
  url.searchParams.set("service_id", serviceId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
};

export const getAuthorizationUrl = async (userId) => {
  const config = getTikTokConfig();
  const state = await createAuthorizationState(userId);
  return buildAuthorizationUrl({
    appKey: config.appKey,
    serviceId: config.serviceId,
    redirectUri: config.redirectUri,
    state,
    authorizationUrl: config.authorizationUrl,
  });
};

export const exchangeAuthorizationCode = async (code) => {
  const config = getTikTokConfig();

  return requestToken(tokenEndpoint, {
    app_key: config.appKey,
    app_secret: config.appSecret,
    auth_code: code,
    grant_type: "authorized_code",
  });
};

export const saveTokenResponse = async (tokenData, { refreshing = false } = {}) => {
  const now = new Date();
  const grantedScopes = tokenData.granted_scopes ?? tokenData.scope;
  // TikTok returns these fields as Unix timestamps in seconds, despite the
  // "expire_in" suffix. Treating them as durations produces dates decades
  // in the future and prevents proactive refresh.
  const accessTokenExpiresAt = new Date(Number(tokenData.access_token_expire_in) * 1000);
  const refreshTokenExpiresAt = new Date(Number(tokenData.refresh_token_expire_in) * 1000);
  if (Number.isNaN(accessTokenExpiresAt.getTime()) || Number.isNaN(refreshTokenExpiresAt.getTime())) {
    throw apiError("TikTok returned invalid token expiration timestamps.");
  }
  return TikTokShop.findOneAndUpdate(
    { key: "singleton" },
    {
      $set: {
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: encryptToken(tokenData.refresh_token),
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        ...(grantedScopes
          ? { scopes: Array.isArray(grantedScopes) ? grantedScopes : String(grantedScopes).split(/[,\s]+/).filter(Boolean) }
          : refreshing ? {} : { scopes: [] }),
        status: "connected",
        ...(!refreshing ? { connectedAt: now } : {}),
        disconnectedAt: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

let refreshing;
const performRefresh = async () => {
  const config = getTikTokConfig();
  const shop = await TikTokShop.findOne({ key: "singleton" }).select("+accessToken +refreshToken");
  if (shop?.status !== "connected" || !shop?.refreshToken) throw apiError("TikTok Shop is not connected.", 401);
  const tokenData = await requestToken(refreshEndpoint, {
  app_key: config.appKey,
  app_secret: config.appSecret,
  refresh_token: decryptToken(shop.refreshToken),
  grant_type: "refresh_token",
});
  const saved = await saveTokenResponse(tokenData, { refreshing: true });
  saved.lastRefreshedAt = new Date();
  await saved.save();
  return tokenData.access_token;
};

export const refreshAccessToken = () => {
  if (!refreshing) refreshing = performRefresh().finally(() => { refreshing = null; });
  return refreshing;
};
export const getAccessToken = async () => {
  const shop = await TikTokShop.findOne({ key: "singleton" }).select("+accessToken +refreshToken");
  if (!shop || shop.status !== "connected" || !shop.accessToken) throw apiError("TikTok Shop is not connected.", 401);
  if (!shop.accessTokenExpiresAt || shop.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return decryptToken(shop.accessToken);
  }
  return refreshAccessToken();
};
