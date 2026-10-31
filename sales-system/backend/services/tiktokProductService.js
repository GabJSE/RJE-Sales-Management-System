import crypto from "node:crypto";
import mongoose from "mongoose";
import TikTokShop from "../models/TikTokShop.js";
import Mapping from "../models/TikTokProductMapping.js";
import Product from "../models/Product.js";
import InventoryMovement from "../models/InventoryMovement.js";
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
  await TikTokShop.updateOne({ key: "singleton", status: "connected" }, { $set: { shopId: selected.id, shopName: selected.name, region: selected.region, shopCipher: selected.cipher, shopInfoSyncedAt: new Date() } });
  return { shopId: selected.id, shopName: selected.name, region: selected.region };
}
export async function reconcileMappings(shopId) {
  const [rows, products] = await Promise.all([Mapping.find({ shopId }), Product.find().select("_id sku").lean()]);
  const counts = new Map();
  for (const row of rows) if (row.normalizedSku && !["DELETED", "FREEZE"].includes(row.status)) counts.set(row.normalizedSku, (counts.get(row.normalizedSku) || 0) + 1);
  for (const row of rows) {
    if (row.mappingSource === "manual") {
      row.mappingStatus = products.some(p => String(p._id) === String(row.rjeProductId)) ? "mapped" : "unmatched";
      if (row.mappingStatus !== "mapped") row.rjeProductId = null;
    } else {
      const matches = products.filter(p => normalizeSku(p.sku) === row.normalizedSku && row.normalizedSku);
      const duplicate = counts.get(row.normalizedSku) > 1 || matches.length > 1;
      row.mappingStatus = duplicate ? "duplicate" : matches.length === 1 ? "mapped" : "unmatched";
      row.rjeProductId = row.mappingStatus === "mapped" ? matches[0]._id : null;
    }
    await row.save();
  }
}
export function stockReconciliationCandidates(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.mappingStatus !== "mapped" || !row.rjeProductId) continue;
    const key = String(row.rjeProductId);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const unique = [...groups.entries()].filter(([, matches]) => matches.length === 1);
  return {
    candidates: unique.filter(([, matches]) => Number.isInteger(matches[0].stock) && matches[0].stock >= 0).map(([productId, matches]) => ({ productId, mapping: matches[0], stock: matches[0].stock })),
    ambiguous: [...groups.values()].filter(matches => matches.length > 1).reduce((sum, matches) => sum + matches.length, 0) + unique.filter(([, matches]) => !Number.isInteger(matches[0].stock) || matches[0].stock < 0).length,
  };
}
export async function synchronizeMappedStock(shopId, productIds = null) {
  const filter = { shopId, mappingStatus: "mapped", rjeProductId: { $ne: null } };
  if (productIds?.length) filter.rjeProductId = { $in: productIds };
  const rows = await Mapping.find(filter);
  const { candidates, ambiguous } = stockReconciliationCandidates(rows);
  if (!candidates.length) return { updated: 0, unchanged: 0, skipped: ambiguous };
  const session = await mongoose.startSession();
  const result = { updated: 0, unchanged: 0, skipped: ambiguous };
  try {
    await session.withTransaction(async () => {
      for (const { productId, mapping, stock } of candidates) {
        const product = await Product.findById(productId).session(session);
        if (!product) { result.skipped++; continue; }
        const previousStock = product.stock;
        if (previousStock === stock) { result.unchanged++; continue; }
        product.stock = stock;
        await product.save({ session });
        await InventoryMovement.create([{
          productId: product._id, productName: product.name,
          type: stock > previousStock ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          quantity: Math.abs(stock - previousStock), previousStock, newStock: stock,
          reason: `TikTok Shop stock synchronization (${mapping.sellerSku || mapping.tiktokSkuId})`,
          referenceId: mapping._id,
        }], { session });
        result.updated++;
      }
    });
    return result;
  } finally { await session.endSession(); }
}
export async function syncProducts() {
  const existing = await TikTokShop.findOne({ key: "singleton" });
  if (existing?.status !== "connected") throw failure("Connect TikTok Shop first.", 401);
  const lease = new Date(Date.now() + 120000);
  const owner = crypto.randomUUID();
  const locked = await TikTokShop.findOneAndUpdate({ key: "singleton", $or: [{ syncLeaseUntil: { $lt: new Date() } }, { syncLeaseUntil: null }] }, { $set: { syncLeaseUntil: lease, syncOwner: owner } }, { new: true });
  if (!locked) throw failure("A product synchronization is already running.", 409);
  const heartbeat = setInterval(() => { TikTokShop.updateOne({ key: "singleton", syncOwner: owner }, { $set: { syncLeaseUntil: new Date(Date.now() + 120000) } }).catch(() => {}); }, 30000);
  heartbeat.unref();
  let shopId;
  try {
    ({ shopId } = await refreshShop());
    const shop = await TikTokShop.findOne({ key: "singleton" }).select("+shopCipher");
    const query = { shop_cipher: shop.shopCipher };
    let pageToken; let count = 0; const activeVariantKeys = [];
    const seen = new Set();
    do {
      const page = await tiktokRequest("/product/202502/products/search", { method: "POST", query: { ...query, page_size: 100, page_token: pageToken }, body: {} });
      if (!Array.isArray(page.products)) throw failure("TikTok returned an invalid product page.");
      for (const summary of page.products) {
        if (!summary.id) throw failure("TikTok returned a product without an ID.");
        const detail = ["FREEZE", "DELETED"].includes(summary.status) ? summary : await tiktokRequest(`/product/202309/products/${encodeURIComponent(summary.id)}`, { query });
        for (const row of productRows({ ...summary, ...detail, id: summary.id })) {
          const archivedAt = ["FREEZE", "DELETED"].includes(row.status) ? new Date() : null;
          await Mapping.updateOne({ shopId, tiktokProductId: row.tiktokProductId, tiktokSkuId: row.tiktokSkuId }, { $set: { ...row, archivedAt, lastSyncedAt: new Date() }, $setOnInsert: { mappingSource: "auto" } }, { upsert: true, runValidators: true });
          if (!archivedAt) activeVariantKeys.push({ tiktokProductId: row.tiktokProductId, tiktokSkuId: row.tiktokSkuId });
          count++;
        }
        await TikTokShop.updateOne({ key: "singleton", syncOwner: owner }, { $set: { syncLeaseUntil: new Date(Date.now() + 120000) } });

      }
      pageToken = page.next_page_token;
      if (pageToken && seen.has(pageToken)) throw failure("TikTok repeated a pagination token. Synchronization stopped.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    if (activeVariantKeys.length) await Mapping.updateMany({ shopId, archivedAt: null, $nor: activeVariantKeys }, { $set: { archivedAt: new Date() } });
    const inventory = { updated: 0, unchanged: 0, skipped: 0, readOnly: true };
    const lastSyncedAt = new Date();
    await TikTokShop.updateOne({ key: "singleton" }, { $set: { lastProductSyncAt: lastSyncedAt } });
    return { count, lastSyncedAt, inventory };
  } finally {
    clearInterval(heartbeat);
    await TikTokShop.updateOne({ key: "singleton", syncOwner: owner }, { $unset: { syncLeaseUntil: 1, syncOwner: 1 } });
  }
}
let productTimer;
export function startTikTokProductScheduler() {
  if (String(process.env.TIKTOK_PRODUCT_SYNC_ENABLED || "true").toLowerCase() !== "true" || productTimer) return;
  const minutes = Math.max(15, Number(process.env.TIKTOK_PRODUCT_SYNC_INTERVAL_MINUTES) || 30);
  productTimer = setInterval(() => syncProducts().catch(error => console.error(`TikTok product sync failed: ${error.message}`)), minutes * 60_000);
  productTimer.unref?.();
}
