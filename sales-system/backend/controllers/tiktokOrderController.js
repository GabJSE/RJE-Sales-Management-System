import TikTokOrder from "../models/TikTokOrder.js";
import TikTokOrderSyncLog from "../models/TikTokOrderSyncLog.js";
import TikTokShop from "../models/TikTokShop.js";
import { failure } from "../services/tiktokApiService.js";
import { syncTikTokOrders } from "../services/tiktokOrderService.js";
import { backfillMissingOrderCosts, setHistoricalOrderLineCost } from "../services/tiktokVariantCostService.js";

const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const escape = value => String(value || "").slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const shop = () => TikTokShop.findOne({ key: "singleton" }).lean();

export const listOrders = async (req, res, next) => { try {
  const connected = await shop();
  if (!connected?.shopId) return res.json({ orders: [], total: 0, page: 1, pages: 1, lastSyncedAt: null });
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1); const limit = 25;
  const filter = { shopId: connected.shopId };
  if (req.query.status) filter.status = String(req.query.status).slice(0, 50);
  if (dateOnly(req.query.from) || dateOnly(req.query.to)) filter.createdAtTikTok = { ...(dateOnly(req.query.from) ? { $gte: new Date(`${req.query.from}T00:00:00+08:00`) } : {}), ...(dateOnly(req.query.to) ? { $lte: new Date(`${req.query.to}T23:59:59.999+08:00`) } : {}) };
  const search = escape(req.query.search);
  if (search) filter.$or = [{ orderId: { $regex: search, $options: "i" } }, { "lines.sellerSku": { $regex: search, $options: "i" } }, { "lines.productName": { $regex: search, $options: "i" } }];
  const [orders, total, statuses] = await Promise.all([
    TikTokOrder.find(filter).sort({ createdAtTikTok: -1, orderId: 1 }).skip((page - 1) * limit).limit(limit).select("orderId status currency totalAmount buyerNickname createdAtTikTok updatedAtTikTok lines lastSynchronizedAt").lean(),
    TikTokOrder.countDocuments(filter), TikTokOrder.distinct("status", { shopId: connected.shopId }),
  ]);
  res.json({ orders, total, page, pages: Math.max(1, Math.ceil(total / limit)), statuses: statuses.filter(Boolean).sort(), lastSyncedAt: connected.lastOrderSyncAt });
} catch (error) { next(error); } };

export const getOrder = async (req, res, next) => { try {
  const connected = await shop();
  const order = await TikTokOrder.findOne({ shopId: connected?.shopId, orderId: req.params.orderId }).populate("lines.rjeProductId", "name sku").lean();
  if (!order) throw failure("TikTok order not found.", 404);
  res.json(order);
} catch (error) { next(error); } };

export const syncOrders = async (req, res, next) => { try {
  const from = dateOnly(req.body?.from) ? new Date(`${req.body.from}T00:00:00+08:00`) : undefined;
  const to = dateOnly(req.body?.to) ? new Date(`${req.body.to}T23:59:59.999+08:00`) : new Date();
  if (from && (from > to || to - from > 90 * 86400_000)) throw failure("Choose a valid date range of 90 days or fewer.", 400);
  res.json(await syncTikTokOrders({ from, to, mode: "manual" }));
} catch (error) { next(error); } };

export const listOrderSyncLogs = async (_req, res, next) => { try {
  const connected = await shop();
  const logs = connected?.shopId ? await TikTokOrderSyncLog.find({ shopId: connected.shopId }).sort({ startedAt: -1 }).limit(20).lean() : [];
  res.json({ logs });
} catch (error) { next(error); } };
export const updateLineCost = async (req, res, next) => { try { const connected = await shop(); const order = await setHistoricalOrderLineCost({ shopId: connected?.shopId, orderId: req.params.orderId, lineItemId: req.params.lineItemId, cost: req.body?.cost, reason: req.body?.reason, userId: req.user._id }); res.json(order); } catch (error) { next(error); } };
export const backfillCosts = async (req, res, next) => { try { const connected = await shop(); if (!connected?.shopId) throw failure("Connect TikTok Shop first.", 409); res.json(await backfillMissingOrderCosts({ shopId: connected.shopId, userId: req.user._id })); } catch (error) { next(error); } };
