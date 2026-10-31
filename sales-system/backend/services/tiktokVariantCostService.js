import mongoose from "mongoose";
import Mapping from "../models/TikTokProductMapping.js";
import TikTokVariantCost from "../models/TikTokVariantCost.js";
import TikTokOrder from "../models/TikTokOrder.js";
import { failure } from "./tiktokApiService.js";
import { fromMinor, minorString, toMinor } from "./money.js";

const validMoney = value => typeof value === "number" ? Number.isFinite(value) && value >= 0 : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim());
export const publicVariantCost = row => row.capitalCostMinor == null ? null : fromMinor(row.capitalCostMinor);

export async function setVariantCosts({ shopId, edits, userId, source = "manual", reason = "" }) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 200) throw failure("Provide between 1 and 200 variant cost edits.", 400);
  if (edits.some(edit => !mongoose.isValidObjectId(edit.variantId) || !validMoney(edit.cost))) throw failure("Each capital cost must be a non-negative amount with at most two decimals.", 400);
  const ids = edits.map(edit => edit.variantId); const variants = await Mapping.find({ _id: { $in: ids }, shopId });
  if (variants.length !== new Set(ids).size) throw failure("One or more TikTok variants were not found.", 404);
  const byId = new Map(variants.map(row => [String(row._id), row])); const now = new Date(); const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const edit of edits) {
        const variant = byId.get(String(edit.variantId)); const costMinor = minorString(toMinor(edit.cost));
        if (variant.capitalCostMinor === costMinor) continue;
        await TikTokVariantCost.updateMany({ shopId, tiktokProductId: variant.tiktokProductId, tiktokSkuId: variant.tiktokSkuId, effectiveTo: null }, { $set: { effectiveTo: now } }, { session });
        await TikTokVariantCost.create([{ shopId, tiktokProductId: variant.tiktokProductId, tiktokSkuId: variant.tiktokSkuId, costMinor, effectiveFrom: now, source, reason: String(edit.reason || reason || "").slice(0, 300), changedBy: userId }], { session });
        variant.capitalCostMinor = costMinor; variant.capitalCostEffectiveFrom = now; await variant.save({ session });
      }
    });
  } finally { await session.endSession(); }
  return { updated: edits.filter(edit => byId.get(String(edit.variantId)).capitalCostMinor === minorString(toMinor(edit.cost))).length };
}

export async function costAt(shopId, tiktokProductId, tiktokSkuId, at) {
  return TikTokVariantCost.findOne({ shopId, tiktokProductId, tiktokSkuId, effectiveFrom: { $lte: at }, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] }).sort({ effectiveFrom: -1 }).lean();
}

export async function setHistoricalOrderLineCost({ shopId, orderId, lineItemId, cost, userId, reason }) {
  if (!validMoney(cost) || !String(reason || "").trim()) throw failure("Enter a valid cost and an audit reason.", 400);
  const order = await TikTokOrder.findOne({ shopId, orderId }); if (!order) throw failure("TikTok order not found.", 404);
  const line = order.lines.find(item => String(item.lineItemId || item.skuId) === String(lineItemId)); if (!line) throw failure("Order line not found.", 404);
  const costMinor = minorString(toMinor(cost)); const effectiveFrom = order.createdAtTikTok || order.importedAt || new Date();
  await TikTokVariantCost.create({ shopId, tiktokProductId: line.productId, tiktokSkuId: line.skuId, costMinor, effectiveFrom, effectiveTo: effectiveFrom, source: "historical_override", reason: String(reason).slice(0, 300), orderId, lineItemId: String(line.lineItemId || line.skuId), changedBy: userId });
  line.capitalCostMinorSnapshot = costMinor; line.capitalCostSnapshot = fromMinor(costMinor); line.capitalCostEffectiveAt = effectiveFrom; line.capitalCostSource = "historical_override"; await order.save();
  return order;
}

export async function backfillMissingOrderCosts({ shopId, userId, reason = "Applied current TikTok catalog cost to missing historical order snapshot" }) {
  const [orders, variants] = await Promise.all([TikTokOrder.find({ shopId }), Mapping.find({ shopId, capitalCostMinor: { $ne: null } }).lean()]);
  const byVariant = new Map(variants.map(row => [`${row.tiktokProductId}:${row.tiktokSkuId}`, row]));
  const audits = []; let updatedLines = 0; let updatedOrders = 0; let missingCatalogCost = 0;
  for (const order of orders) {
    let changed = false;
    for (const line of order.lines) {
      if (line.capitalCostMinorSnapshot != null || line.capitalCostSnapshot != null) continue;
      const variant = byVariant.get(`${line.productId}:${line.skuId}`);
      if (!variant) { missingCatalogCost++; continue; }
      line.capitalCostMinorSnapshot = variant.capitalCostMinor; line.capitalCostSnapshot = fromMinor(variant.capitalCostMinor);
      line.capitalCostEffectiveAt = order.createdAtTikTok || order.importedAt || new Date(); line.capitalCostSource = "historical_override";
      audits.push({ shopId, tiktokProductId: line.productId, tiktokSkuId: line.skuId, costMinor: variant.capitalCostMinor, effectiveFrom: line.capitalCostEffectiveAt, effectiveTo: line.capitalCostEffectiveAt, source: "historical_override", reason, orderId: order.orderId, lineItemId: String(line.lineItemId || line.skuId), changedBy: userId });
      updatedLines++; changed = true;
    }
    if (changed) { await order.save(); updatedOrders++; }
  }
  if (audits.length) await TikTokVariantCost.insertMany(audits, { ordered: false });
  return { updatedLines, updatedOrders, missingCatalogCost };
}
