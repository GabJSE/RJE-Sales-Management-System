import { enqueueSync } from "../services/tiktokSyncJobService.js";
import TikTokShop from "../models/TikTokShop.js";
import TikTokOrderSyncLog from "../models/TikTokOrderSyncLog.js";
import TikTokFinanceSyncLog from "../models/TikTokFinanceSyncLog.js";
import TikTokProductSyncLog from "../models/TikTokProductSyncLog.js";
import TikTokWebhookEvent from "../models/TikTokWebhookEvent.js";

const enabled = name => String(process.env[name] || "true").toLowerCase() === "true";
const publicError = error => error?.statusCode === 403 ? "Required TikTok permission is unavailable." : error?.statusCode === 409 ? "A synchronization is already running." : error?.statusCode === 401 ? "TikTok Shop is not connected." : "Synchronization failed. Check the sync log.";

export const getAutomaticSyncStatus = async (_req, res, next) => { try {
  const shop = await TikTokShop.findOne({ key: "singleton" }).lean();
  const [orderLog, productLog, financeLog, webhookSummary] = await Promise.all([
    TikTokOrderSyncLog.findOne({ shopId: shop?.shopId }).sort({ startedAt: -1 }).lean(), TikTokProductSyncLog.findOne({ shopId: shop?.shopId }).sort({ startedAt: -1 }).lean(), TikTokFinanceSyncLog.findOne({ shopId: shop?.shopId }).sort({ startedAt: -1 }).lean(),
    TikTokWebhookEvent.aggregate([{ $match: { shopId: shop?.shopId || "" } }, { $group: { _id: "$status", count: { $sum: 1 }, latest: { $max: "$createdAt" } } }]),
  ]);
  const now = new Date();
  res.json({
    connected: shop?.status === "connected",
    running: Boolean(shop && [shop.orderSyncLeaseUntil, shop.syncLeaseUntil, shop.settlementSyncLeaseUntil].some(value => value && new Date(value) > now)),
    schedules: {
      orders: { enabled: enabled("TIKTOK_ORDER_SYNC_ENABLED"), intervalMinutes: Math.max(5, Number(process.env.TIKTOK_ORDER_SYNC_INTERVAL_MINUTES) || 5), lastSyncedAt: shop?.lastOrderSyncAt || null, latest: orderLog },
      products: { enabled: enabled("TIKTOK_PRODUCT_SYNC_ENABLED"), intervalMinutes: Math.max(15, Number(process.env.TIKTOK_PRODUCT_SYNC_INTERVAL_MINUTES) || 15), lastSyncedAt: shop?.lastProductSyncAt || null, latest: productLog },
      settlements: { enabled: enabled("TIKTOK_SETTLEMENT_SYNC_ENABLED"), intervalMinutes: Math.max(1, Number(process.env.TIKTOK_SETTLEMENT_SYNC_INTERVAL_HOURS) || 1) * 60, lastSyncedAt: shop?.lastSettlementSyncAt || null, latest: financeLog },
    },
    webhooks: { endpoint: "/api/tiktok/webhooks", events: Object.fromEntries(webhookSummary.map(row => [row._id, { count: row.count, latest: row.latest }])) },
  });
} catch (error) { next(error); } };

export const syncEverythingNow = async (_req, res, next) => { try {
  const tasks = ["orders", "products", "settlements"].map(type => [type, () => enqueueSync(type)]);
  const results = {};
  for (const [name, task] of tasks) { try { results[name] = { ok: true, job: await task() }; } catch (error) { results[name] = { ok: false, message: publicError(error) }; } }
  res.json({ results, completedAt: new Date(), inventoryWriteBack: false });
} catch (error) { next(error); } };
