import crypto from "node:crypto";
import { syncWindow, lowerTimeFilter, nextSyncToken, distinctBy, ownedFieldsChanged, syncBulkWrite } from "./syncDataService.js";
import { reportSync } from "./syncTelemetry.js";
import TikTokShop from "../models/TikTokShop.js";
import TikTokOrder from "../models/TikTokOrder.js";
import TikTokOrderSyncLog from "../models/TikTokOrderSyncLog.js";
import Mapping from "../models/TikTokProductMapping.js";
import TikTokVariantCost from "../models/TikTokVariantCost.js";
import { fromMinor, minorString, toMinor } from "./money.js";
import { failure, tiktokRequest } from "./tiktokApiService.js";

const LIST_PATH = "/order/202309/orders/search";
const DETAIL_PATH = "/order/202507/orders";
const ORDER_SCOPE = "seller.order.info";
const utc = value => value == null ? null : new Date(Number(value) * 1000);
const text = value => value == null ? undefined : String(value);
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const district = value => Array.isArray(value) ? value.map(item => item.address_name || item.name).filter(Boolean).join(", ") : text(value);
async function orderRequest(path, options, operation) {
  try { return await tiktokRequest(path, options); }
  catch (error) {
    if (error.statusCode === 403) throw failure(`TikTok denied ${operation}. Confirm seller.order.info is effective for this app, then disconnect and reauthorize the shop.`, 403);
    throw error;
  }
}

export function normalizeTikTokOrder(order, variantRows = [], costRows = [], existing = null, now = new Date()) {
  const bySkuId = new Map(variantRows.map(row => [String(row.tiktokSkuId), row]));
  const costsByVariant = new Map(); for (const row of costRows) { const key = `${row.tiktokProductId}:${row.tiktokSkuId}`; costsByVariant.set(key, [...(costsByVariant.get(key) || []), row]); }
  const previousLines = new Map((existing?.lines || []).map(line => [String(line.lineItemId || line.skuId), line]));
  const lines = (order.line_items || []).map(line => {
    const variant = bySkuId.get(String(line.sku_id || "")); const orderDate = utc(order.create_time) || now;
    const history = costsByVariant.get(`${String(line.product_id || variant?.tiktokProductId || "")}:${String(line.sku_id || "")}`) || [];
    const applicableCost = history.filter(row => new Date(row.effectiveFrom) <= orderDate && (!row.effectiveTo || new Date(row.effectiveTo) > orderDate)).sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
    const prior = previousLines.get(String(line.id || line.sku_id));
    const preservePrior = Boolean(prior);
    const costMinor = preservePrior ? (prior.capitalCostMinorSnapshot ?? (prior.capitalCostSnapshot == null ? null : minorString(toMinor(prior.capitalCostSnapshot)))) : applicableCost?.costMinor ?? null;
    return {
      lineItemId: text(line.id), productId: text(line.product_id), skuId: text(line.sku_id), sellerSku: text(line.seller_sku), skuName: text(line.sku_name),
      productName: text(line.product_name), imageUrl: text(line.sku_image), currency: text(line.currency), quantity: Number(line.quantity) || 1,
      originalPrice: text(line.original_price), salePrice: text(line.sale_price), platformDiscount: text(line.platform_discount), sellerDiscount: text(line.seller_discount), itemTax: text(line.item_tax),
      rjeProductId: prior?.rjeProductId || null,
      capitalCostSnapshot: costMinor == null ? undefined : fromMinor(costMinor), capitalCostMinorSnapshot: costMinor,
      capitalCostEffectiveAt: preservePrior ? prior.capitalCostEffectiveAt : applicableCost?.effectiveFrom,
      capitalCostSource: preservePrior ? (prior.capitalCostSource || (prior.capitalCostSnapshot == null ? "missing" : "legacy_product")) : applicableCost ? "variant_history" : "missing",
      mappingStatus: variant ? "mapped" : "unmatched", mappingSource: variant ? "sku_id" : "none",
    };
  });
  const payment = order.payment || {};
  const address = order.recipient_address || {};
  const history = [...(existing?.statusHistory || [])];
  if (!history.length || history.at(-1).status !== order.status) history.push({ status: text(order.status), observedAt: utc(order.update_time) || now });
  return {
    shopId: existing?.shopId, orderId: text(order.id), status: text(order.status), orderType: text(order.order_type), fulfillmentType: text(order.fulfillment_type), shippingType: text(order.shipping_type),
    currency: text(payment.currency || lines[0]?.currency), totalAmount: text(payment.total_amount), subtotal: text(payment.sub_total), shippingFee: text(payment.shipping_fee), platformDiscount: text(payment.platform_discount), sellerDiscount: text(payment.seller_discount),
    paymentMethodName: text(order.payment_method_name), isCod: order.is_cod, isSampleOrder: order.is_sample_order, isOnHoldOrder: order.is_on_hold_order,
    buyerNickname: text(order.buyer_nickname), recipient: { name: text(address.name), regionCode: text(address.region_code), postTown: text(address.post_town), district: district(address.district_info), postalCode: text(address.postal_code) },
    trackingNumber: text(order.tracking_number), shippingProvider: text(order.shipping_provider),
    createdAtTikTok: utc(order.create_time), updatedAtTikTok: utc(order.update_time), paidAtTikTok: utc(order.paid_time), cancelledAtTikTok: utc(order.cancel_time), deliveredAtTikTok: utc(order.delivery_time),
    lines, statusHistory: history, lastSynchronizedAt: now,
  };
}

async function getShop() {
  const shop = await TikTokShop.findOne({ key: "singleton" }).select("+shopCipher");
  if (!shop || shop.status !== "connected" || !shop.shopId || !shop.shopCipher) throw failure("Connect TikTok Shop and refresh authorized shop information first.", 409);
  if (!shop.scopes.includes(ORDER_SCOPE)) throw failure("Order Information permission is missing. Enable seller.order.info and reauthorize the shop.", 403);
  return shop;
}

async function acquireLease(shop) {
  const owner = crypto.randomUUID();
  const locked = await TikTokShop.findOneAndUpdate({ _id: shop._id, $or: [{ orderSyncLeaseUntil: { $lte: new Date() } }, { orderSyncLeaseUntil: null }] }, { orderSyncOwner: owner, orderSyncLeaseUntil: new Date(Date.now() + 15 * 60_000) }, { new: true });
  if (!locked) throw failure("A TikTok order synchronization is already running.", 409);
  return owner;
}

async function loadMatchingData(shopId, orders) {
  const skuIds = [...new Set(orders.flatMap(order => order.line_items || []).map(line => String(line.sku_id || "")).filter(Boolean))];
  const [variants, costs] = await Promise.all([Mapping.find({ shopId, tiktokSkuId: { $in: skuIds } }).lean(), TikTokVariantCost.find({ shopId, tiktokSkuId: { $in: skuIds } }).lean()]);
  return { variants, costs };
}

export async function syncTikTokOrders({ from, to = new Date(), mode = "manual", forceFull = false } = {}) {
  const shop = await getShop();
  const { start, end, advance } = syncWindow({ checkpoint: shop.orderCheckpoint, from, to, forceFull });
  const owner = await acquireLease(shop);
  const heartbeat = setInterval(() => TikTokShop.updateOne({ _id: shop._id, orderSyncOwner: owner }, { $set: { orderSyncLeaseUntil: new Date(Date.now() + 15 * 60_000) } }).catch(() => {}), 5 * 60_000); heartbeat.unref?.();
  let log;
  const totals = { pagesProcessed: 0, ordersFound: 0, ordersCreated: 0, ordersUpdated: 0, unmatchedItems: 0 };
  try {
    log = await TikTokOrderSyncLog.create({ shopId: shop.shopId, mode, rangeStart: start, rangeEnd: end, status: "running" });
    let token; const seen = new Set(); const processed = new Set();
    const importIds = async ids => {
      for (const batch of chunks([...new Set(ids)].filter(id => !processed.has(id)), 50)) {
        const details = await orderRequest(DETAIL_PATH, { query: { ids: batch, shop_cipher: shop.shopCipher } }, "Get Order Detail access");
        if (!Array.isArray(details.orders)) throw failure("TikTok returned an invalid order detail batch.");
        const fullOrders = distinctBy(details.orders, row => String(row.id));
        if (batch.some(id => !fullOrders.some(order => String(order.id) === id))) throw failure("TikTok returned an incomplete order detail batch. Retry synchronization.");
        const [{ variants, costs }, previous] = await Promise.all([loadMatchingData(shop.shopId, fullOrders), TikTokOrder.find({ shopId: shop.shopId, orderId: { $in: batch } }).lean()]);
        const byId = new Map(previous.map(row => [row.orderId, row])); const operations = []; let existingWrites = 0;
        for (const order of fullOrders) {
          const existing = byId.get(String(order.id));
          const normalized = normalizeTikTokOrder(order, variants, costs, existing); normalized.shopId = shop.shopId;
          totals.unmatchedItems += normalized.lines.filter(line => line.capitalCostMinorSnapshot == null).length;
          if (ownedFieldsChanged(existing, normalized)) {
            // Version check prevents a concurrent manual historical-cost edit being overwritten.
            operations.push({ updateOne: { filter: existing ? { _id: existing._id, __v: existing.__v ?? { $exists: false } } : { shopId: shop.shopId, orderId: normalized.orderId }, update: { $set: normalized, $inc: { __v: 1 }, ...(!existing ? { $setOnInsert: { importedAt: new Date() } } : {}) }, upsert: !existing } });
            if (existing) { existingWrites++; totals.ordersUpdated++; } else totals.ordersCreated++;
          }
          processed.add(String(order.id));
        }
        const written = await syncBulkWrite(TikTokOrder, operations);
        if (written.matchedCount !== existingWrites) throw failure("An order changed during synchronization. Retry to preserve its latest capital costs.", 409);
        await reportSync({ stage: "Importing orders", processed: processed.size, pages: totals.pagesProcessed });
      }
    };
    do {
      const page = await orderRequest(LIST_PATH, { method: "POST", query: { page_size: 100, page_token: token, sort_field: "update_time", sort_order: "ASC", shop_cipher: shop.shopCipher }, body: { ...lowerTimeFilter("update_time_ge", start), update_time_lt: Math.floor(end.getTime() / 1000) } }, "Get Order List access");
      // TikTok omits orders when a completed search has zero matches.
      if (page.orders == null && page.total_count === 0 && !page.next_page_token) page.orders = [];
      if (!Array.isArray(page.orders) || page.orders.some(order => !order.id)) throw failure("TikTok returned an invalid order page.");
      totals.pagesProcessed++; totals.ordersFound += page.orders.length;
      const summaries = distinctBy(page.orders, row => String(row.id));
      if (!forceFull && shop.orderCheckpoint) {
        const existing = await TikTokOrder.find({ shopId: shop.shopId, orderId: { $in: summaries.map(row => String(row.id)) } }).select("orderId status updatedAtTikTok").lean();
        const byId = new Map(existing.map(row => [row.orderId, row]));
        for (const row of summaries) {
          const saved = byId.get(String(row.id));
          if (saved && ["COMPLETED", "CANCELLED"].includes(saved.status) && row.update_time && saved.updatedAtTikTok && Number(row.update_time) * 1000 === new Date(saved.updatedAtTikTok).getTime() && (!row.status || row.status === saved.status)) processed.add(String(row.id));
        }
      }
      await importIds(summaries.map(order => String(order.id)));
      await reportSync({ stage: "Checking updated orders", processed: processed.size, pages: totals.pagesProcessed });
      token = nextSyncToken(page.next_page_token, seen);
    } while (token);
    // Update-time discovery is authoritative, but recheck pending local orders as a safety net.
    const pending = TikTokOrder.find({ shopId: shop.shopId, status: { $nin: ["COMPLETED", "CANCELLED"] } }).select("orderId").lean().cursor();
    let pendingIds = [];
    for await (const order of pending) { pendingIds.push(order.orderId); if (pendingIds.length === 50) { await importIds(pendingIds); pendingIds = []; } }
    await importIds(pendingIds);
    Object.assign(log, totals, { status: "completed", completedAt: new Date() }); await log.save();
    const checkpointUpdate = await TikTokShop.updateOne({ _id: shop._id, orderSyncOwner: owner }, { $max: { lastOrderSyncAt: new Date(), ...(advance ? { orderCheckpoint: end } : {}) } });
    if (checkpointUpdate.matchedCount !== 1) throw failure("Synchronization lease was lost before saving its checkpoint. Retry safely.", 409);
    return { ...totals, synchronizedAt: end, inventoryChanged: false };
  } catch (error) {
    if (log) { Object.assign(log, totals, { status: "failed", completedAt: new Date(), errorMessage: error.statusCode === 403 ? "TikTok denied Orders API access." : error.message }); await log.save(); }
    throw error;
  } finally {
    clearInterval(heartbeat);
    await TikTokShop.updateOne({ _id: shop._id, orderSyncOwner: owner }, { $unset: { orderSyncLeaseUntil: 1, orderSyncOwner: 1 } });
  }
}

let timer;
export function startTikTokOrderScheduler() {
  if (String(process.env.TIKTOK_ORDER_SYNC_ENABLED || "true").toLowerCase() !== "true" || timer) return;
  const minutes = Math.max(5, Number(process.env.TIKTOK_ORDER_SYNC_INTERVAL_MINUTES) || 5);
  const run = () => import("./tiktokSyncJobService.js").then(({ enqueueSync }) => enqueueSync("orders", {}, "scheduled")).catch(error => { if (![401, 403, 409].includes(error.statusCode)) console.error(`TikTok order sync failed: ${error.message}`); });
  timer = setInterval(run, minutes * 60_000);
  timer.unref?.();
  const startup = setTimeout(run, 15_000); startup.unref?.();
}
