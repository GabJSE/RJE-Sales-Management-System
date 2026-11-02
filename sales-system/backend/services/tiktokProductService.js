import crypto from "node:crypto";
import { forEachBatch } from "./batchService.js";
import { syncWindow, nextSyncToken, distinctBy, ownedFieldsChanged, syncBulkWrite } from "./syncDataService.js";
import { reportSync } from "./syncTelemetry.js";
import TikTokShop from "../models/TikTokShop.js";
import Mapping from "../models/TikTokProductMapping.js";
import TikTokProductSyncLog from "../models/TikTokProductSyncLog.js";
import { failure, tiktokRequest } from "./tiktokApiService.js";
export const normalizeSku = value => String(value || "").trim().toUpperCase().replace(/[-‐‑‒–—―]/g, "");
const imageUrl = (product, sku) => {
  const candidate = sku?.sku_image || sku?.image || product?.main_images?.[0] || product?.images?.[0];
  if (typeof candidate === "string") return candidate;
  return candidate?.url || candidate?.urls?.[0] || candidate?.thumb_url || "";
};
export function productRows(product) {
  if (product.skus?.some(sku => !sku.id)) throw failure("TikTok returned a SKU without an ID.");
  return (product.skus?.length ? product.skus : [{ id: "__product__" }]).map(sku => ({
    tiktokProductId: String(product.id), tiktokSkuId: String(sku.id), title: product.title || "", imageUrl: imageUrl(product, sku), sellerSku: sku.seller_sku || "",
    normalizedSku: normalizeSku(sku.seller_sku), price: sku.price?.tax_exclusive_price ?? sku.price?.sale_price ?? null,
    currency: sku.price?.currency || null,
    stock: Array.isArray(sku.inventory) && sku.inventory.length > 0 && sku.inventory.every(item => Number.isFinite(item.quantity)) ? sku.inventory.reduce((sum, item) => sum + item.quantity, 0) : null,
    status: product.status || "UNKNOWN", variations: (sku.sales_attributes || []).map(a => ({ name: a.name, value: a.value_name })),
  }));
}
export async function refreshShop() {
  const data = await tiktokRequest("/authorization/202309/shops");
  const existing = await TikTokShop.findOne({ key: "singleton" });
  const shops = (data.shops || []).filter(shop => shop.region === "PH");
  const selected = shops.find(shop => shop.id === existing?.shopId) || (shops.length === 1 ? shops[0] : null);
  if (!selected) throw failure("Expected one authorized Philippines shop. Verify shop authorization in Partner Center.", 409);
  await TikTokShop.updateOne({ key: "singleton", status: "connected" }, { $set: { shopId: selected.id, shopName: selected.name, region: selected.region, shopCipher: selected.cipher, shopInfoSyncedAt: new Date() }, ...(existing?.shopId && existing.shopId !== selected.id ? { $unset: { orderCheckpoint: 1, productCheckpoint: 1, financeCheckpoint: 1, lastFullProductSyncAt: 1, lastFullFinanceSyncAt: 1, lastOrderSyncAt: 1, lastProductSyncAt: 1, lastSettlementSyncAt: 1 } } : {}) });
  return { shopId: selected.id, shopName: selected.name, region: selected.region };
}
export async function syncProducts({ mode = "manual", forceFull = false } = {}) {
  const existing = await TikTokShop.findOne({ key: "singleton" });
  if (existing?.status !== "connected") throw failure("Connect TikTok Shop first.", 401);
  const scanAll = forceFull || !existing.productCheckpoint || !existing.lastFullProductSyncAt || Date.now() - new Date(existing.lastFullProductSyncAt).getTime() > Math.max(1, Number(process.env.TIKTOK_PRODUCT_FULL_REFRESH_HOURS) || 24) * 3600_000;
  const { start, end } = syncWindow({ checkpoint: existing.productCheckpoint, forceFull: scanAll });
  const lease = new Date(Date.now() + 120000);
  const owner = crypto.randomUUID();
  const locked = await TikTokShop.findOneAndUpdate({ key: "singleton", $or: [{ syncLeaseUntil: { $lt: new Date() } }, { syncLeaseUntil: null }] }, { $set: { syncLeaseUntil: lease, syncOwner: owner } }, { new: true });
  if (!locked) throw failure("A product synchronization is already running.", 409);
  const heartbeat = setInterval(() => { TikTokShop.updateOne({ key: "singleton", syncOwner: owner }, { $set: { syncLeaseUntil: new Date(Date.now() + 120000) } }).catch(() => {}); }, 30000);
  heartbeat.unref();
  let shopId; let log;
  try {
    ({ shopId } = await refreshShop());
    log = await TikTokProductSyncLog.create({ shopId, mode, status: "running" });
    const shop = await TikTokShop.findOne({ key: "singleton" }).select("+shopCipher");
    const query = { shop_cipher: shop.shopCipher };
    let pageToken; let count = 0; let pages = 0; const activeKeys = new Set(); const seenProducts = new Set(); const seen = new Set();
    do {
      const page = await tiktokRequest("/product/202502/products/search", { method: "POST", query: { ...query, page_size: 100, page_token: pageToken }, body: scanAll ? {} : { update_time_ge: Math.floor(start.getTime() / 1000), update_time_le: Math.floor(end.getTime() / 1000) } });
      if (!Array.isArray(page.products) || page.products.some(row => !row.id)) throw failure("TikTok returned an invalid product page.");
      const summaries = distinctBy(page.products, row => String(row.id)).filter(row => !seenProducts.has(String(row.id)));
      const previous = await Mapping.find({ shopId, tiktokProductId: { $in: summaries.map(row => String(row.id)) } }).lean();
      const byKey = new Map(previous.map(row => [row.tiktokProductId + ":" + row.tiktokSkuId, row])); const operations = [];
      await forEachBatch(summaries, 3, async summary => {
        seenProducts.add(String(summary.id));
        if (["FREEZE", "DELETED"].includes(summary.status)) {
          operations.push({ updateMany: { filter: { shopId, tiktokProductId: String(summary.id) }, update: { $set: { status: summary.status, archivedAt: new Date(), lastSyncedAt: new Date() } } } });
          return;
        }
        const detail = await tiktokRequest(`/product/202309/products/${encodeURIComponent(summary.id)}`, { query });
        if (!Array.isArray(detail.skus) || !detail.skus.length) throw failure("TikTok returned incomplete product details; catalog was not archived.");
        const rows = distinctBy(productRows({ ...summary, ...detail, id: summary.id }), row => row.tiktokSkuId);
        for (const row of rows) {
          const key = row.tiktokProductId + ":" + row.tiktokSkuId; activeKeys.add(key); count++;
          const values = { ...row, archivedAt: null, lastSyncedAt: new Date() };
          if (ownedFieldsChanged(byKey.get(key), values)) operations.push({ updateOne: { filter: { shopId, tiktokProductId: row.tiktokProductId, tiktokSkuId: row.tiktokSkuId }, update: { $set: values, $setOnInsert: { mappingSource: "auto" } }, upsert: true } });
        }
        // A complete product detail is authoritative only for this product's variants.
        const validSkuIds = rows.map(row => row.tiktokSkuId);
        operations.push({ updateMany: { filter: { shopId, tiktokProductId: String(summary.id), tiktokSkuId: { $nin: validSkuIds }, archivedAt: null }, update: { $set: { archivedAt: new Date() } } } });
      });
      await syncBulkWrite(Mapping, operations);
      pages++; await reportSync({ stage: scanAll ? "Importing full catalog" : "Importing changed products", processed: count, pages });
      pageToken = nextSyncToken(page.next_page_token, seen);
    } while (pageToken);
    if (scanAll) {
      let archived = [];
      const cursor = Mapping.find({ shopId, archivedAt: null }).select("_id tiktokProductId tiktokSkuId").lean().cursor();
      for await (const row of cursor) {
        if (!activeKeys.has(row.tiktokProductId + ":" + row.tiktokSkuId)) archived.push({ updateOne: { filter: { _id: row._id }, update: { $set: { archivedAt: new Date() } } } });
        if (archived.length >= 250) { await syncBulkWrite(Mapping, archived); archived = []; }
      }
      await syncBulkWrite(Mapping, archived);
    }
    const inventory = { updated: 0, unchanged: 0, skipped: 0, readOnly: true };
    const lastSyncedAt = end;
    Object.assign(log, { status: "completed", variantsFound: count, completedAt: new Date() }); await log.save();
    const checkpointUpdate = await TikTokShop.updateOne({ key: "singleton", syncOwner: owner }, { $max: { lastProductSyncAt: new Date(), productCheckpoint: end, ...(scanAll ? { lastFullProductSyncAt: end } : {}) } });
    if (checkpointUpdate.matchedCount !== 1) throw failure("Synchronization lease was lost before saving its checkpoint. Retry safely.", 409);
    return { count, lastSyncedAt, inventory };
  } catch (error) {
    if (log) { log.status = "failed"; log.errorMessage = error.message; log.completedAt = new Date(); await log.save(); }
    throw error;
  } finally {
    clearInterval(heartbeat);
    await TikTokShop.updateOne({ key: "singleton", syncOwner: owner }, { $unset: { syncLeaseUntil: 1, syncOwner: 1 } });
  }
}
let productTimer;
export function startTikTokProductScheduler() {
  if (String(process.env.TIKTOK_PRODUCT_SYNC_ENABLED || "true").toLowerCase() !== "true" || productTimer) return;
  const minutes = Math.max(15, Number(process.env.TIKTOK_PRODUCT_SYNC_INTERVAL_MINUTES) || 15);
  const run = () => import("./tiktokSyncJobService.js").then(({ enqueueSync }) => enqueueSync("products", {}, "scheduled")).catch(error => { if (error.statusCode !== 401 && error.statusCode !== 409) console.error(`TikTok product sync failed: ${error.message}`); });
  productTimer = setInterval(run, minutes * 60_000);
  productTimer.unref?.();
  const startup = setTimeout(run, 30_000); startup.unref?.();
}
