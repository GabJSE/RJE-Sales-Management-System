import crypto from "node:crypto";
import { enqueueSync } from "./tiktokSyncJobService.js";
import { getTikTokConfig } from "../config/tiktok.js";
import TikTokShop from "../models/TikTokShop.js";
import TikTokWebhookEvent from "../models/TikTokWebhookEvent.js";
import { failure, tiktokRequest } from "./tiktokApiService.js";

export const supportedWebhookTopics = ["ORDER_STATUS_CHANGE", "PRODUCT_STATUS_CHANGE", "PRODUCT_INFORMATION_CHANGE", "PRODUCT_CREATION", "PRODUCT_CATEGORY_CHANGE"];

export async function registerSupportedTikTokWebhooks() {
  const address = String(process.env.TIKTOK_WEBHOOK_URL || "").trim();
  if (!/^https:\/\//i.test(address) || address.length > 255) throw failure("Configure TIKTOK_WEBHOOK_URL with the public HTTPS webhook endpoint first.", 409);
  const shop = await TikTokShop.findOne({ key: "singleton" }).select("+shopCipher");
  if (!shop?.shopCipher || shop.status !== "connected") throw failure("Connect TikTok Shop and refresh shop information first.", 409);
  const registered = [];
  for (const eventType of supportedWebhookTopics) { await tiktokRequest("/event/202309/webhooks", { method: "PUT", query: { shop_cipher: shop.shopCipher }, body: { address, event_type: eventType } }); registered.push(eventType); }
  return { address, registered };
}

export function verifyTikTokWebhook(rawBody, authorization, config = getTikTokConfig()) {
  if (!Buffer.isBuffer(rawBody) || !authorization || !/^[a-f0-9]{64}$/i.test(authorization)) return false;
  const expected = crypto.createHmac("sha256", config.appSecret).update(config.appKey).update(rawBody).digest("hex");
  const supplied = Buffer.from(authorization.toLowerCase(), "hex"); const calculated = Buffer.from(expected, "hex");
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
}

export const webhookCategory = payload => Number(payload?.type) === 71 ? "inventory" : payload?.data?.order_id ? "order" : payload?.data?.product_id || payload?.data?.sku_id ? "product" : "unknown";

async function schedule(category, event) {
  const type = category === "order" ? "orders" : "products";
  try {
    const job = await enqueueSync(type, {}, "webhook");
    await TikTokWebhookEvent.updateOne({ _id: event._id }, { $set: { status: "completed", processedAt: new Date(), syncJobId: job._id }, $unset: { errorMessage: 1 } });
  } catch (error) {
    await TikTokWebhookEvent.updateOne({ _id: event._id }, { $set: { status: "failed", errorMessage: "Could not queue webhook synchronization. The notification can be retried." } });
    throw error;
  }
}

export async function acceptTikTokWebhook(payload) {
  const notificationId = String(payload?.tts_notification_id || "").trim();
  if (!notificationId || !Number.isInteger(Number(payload?.type))) return { accepted: false, reason: "invalid" };
  const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); const receivedShop = String(payload.shop_id || payload.seller_open_id || "");
  if (!shop?.shopId || (payload.shop_id && String(payload.shop_id) !== String(shop.shopId))) return { accepted: false, reason: "shop_mismatch" };
  const category = webhookCategory(payload); let event;
  try { event = await TikTokWebhookEvent.create({ notificationId, shopId: receivedShop || shop.shopId, type: Number(payload.type), category, eventTimestamp: payload.timestamp ? new Date(Number(payload.timestamp) * 1000) : undefined }); }
  catch (error) { if (error.code !== 11000) throw error; event = await TikTokWebhookEvent.findOne({ notificationId }); if (["completed", "ignored"].includes(event?.status)) return { accepted: true, duplicate: true }; if (!event) throw error; }
  if (category === "unknown") { event.status = "ignored"; event.processedAt = new Date(); await event.save(); return { accepted: true, ignored: true }; }
  await schedule(category, event); return { accepted: true, duplicate: false };
}
