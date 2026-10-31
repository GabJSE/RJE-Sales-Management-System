import TikTokShop from "../models/TikTokShop.js";
import { getTikTokConfig } from "../config/tiktok.js";
import {
  consumeAuthorizationState,
  exchangeAuthorizationCode,
  getAuthorizationUrl,
  saveTokenResponse,
} from "../services/tiktokOAuthService.js";

export const authorize = async (req, res, next) => {
  try {
    res.json({ authorizationUrl: await getAuthorizationUrl(req.user._id) });
  } catch (error) {
    next(error);
  }
};

export const callback = async (req, res, next) => {
  try {
    const { code, auth_code: authCode, state, error, error_description: errorDescription } = req.query;
    if (error) {
      const callbackError = new Error(errorDescription || `TikTok authorization failed: ${error}.`);
      callbackError.statusCode = 400;
      throw callbackError;
    }
    await consumeAuthorizationState(state);
    if (!code && !authCode) {
      const callbackError = new Error("TikTok authorization code is missing.");
      callbackError.statusCode = 400;
      throw callbackError;
    }
    await saveTokenResponse(await exchangeAuthorizationCode(code || authCode));
    const redirectUrl = new URL(getTikTokConfig().frontendRedirectUri);
    redirectUrl.searchParams.set("connected", "1");
    res.redirect(redirectUrl.toString());
  } catch (error) {
    next(error);
  }
};

export const getStatus = async (_req, res, next) => {
  try {
    const shop = await TikTokShop.findOne({ key: "singleton" }).lean();
    res.json({
      connected: shop?.status === "connected",
      shopId: shop?.shopId || null,
      shopName: shop?.shopName || null,
      region: shop?.region || null,
      scopes: shop?.scopes || [], lastProductSyncAt: shop?.lastProductSyncAt || null,
      connectedAt: shop?.connectedAt || null,
      accessTokenExpiresAt: shop?.accessTokenExpiresAt || null,
      status: shop?.status || "disconnected",
    });
  } catch (error) {
    next(error);
  }
};

export const disconnect = async (_req, res, next) => {
  try {
    await TikTokShop.findOneAndUpdate(
      { key: "singleton" },
      {
        $set: { status: "disconnected", disconnectedAt: new Date() },
        $unset: { accessToken: 1, refreshToken: 1 },
      }
    );
    res.json({ message: "TikTok Shop disconnected successfully." });
  } catch (error) {
    next(error);
  }
};

