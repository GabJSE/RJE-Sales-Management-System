import mongoose from "mongoose";
import { productPricing } from "../services/tiktokPricingService.js";
import { productSettlementMetrics } from "../services/tiktokProductMetricsService.js";
import Mapping from "../models/TikTokProductMapping.js";
import SystemSettings from "../models/SystemSettings.js";
import TikTokShop from "../models/TikTokShop.js";
import { refreshShop, syncProducts } from "../services/tiktokProductService.js";
import { failure } from "../services/tiktokApiService.js";
import TikTokVariantCost from "../models/TikTokVariantCost.js";
import { publicVariantCost, setVariantCosts } from "../services/tiktokVariantCostService.js";
export const shops = async (_req, res, next) => { try { res.json(await refreshShop()); } catch (error) { if (error.statusCode === 401) error.statusCode = 409; next(error); } };
export const sync = async (_req, res, next) => { try { res.json(await syncProducts({ mode: "manual" })); } catch (error) { if (error.statusCode === 401) error.statusCode = 409; next(error); } };
export const list = async (req, res, next) => {
  try {
    const shop = await TikTokShop.findOne({ key: "singleton" }).lean();
    const pageSize = [10, 25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
    if (!shop?.shopId) return res.json({ products: [], total: 0, page: 1, pages: 1, pageSize });
    const requestedPage = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const search = String(req.query.search || "").slice(0, 120).split("").map(char => ".*+?^$".includes(char) || [40, 41, 91, 92, 93, 123, 124, 125].includes(char.charCodeAt(0)) ? String.fromCharCode(92) + char : char).join("");
    const selectedFilter = String(req.query.filter || "all");
    const active = { archivedAt: null, status: { $in: ["ACTIVE", "ACTIVATE"] } };
    const filter = { shopId: shop.shopId };
    if (selectedFilter === "active") Object.assign(filter, active, { stock: { $ne: 0 } });
    if (selectedFilter === "out_of_stock") Object.assign(filter, active, { stock: 0 });
    if (selectedFilter === "inactive") filter.$and = [{ $or: [{ archivedAt: { $ne: null } }, { status: { $nin: ["ACTIVE", "ACTIVATE"] } }] }];
    if (selectedFilter === "missing_cost" || req.query.missingCost === "true") filter.capitalCostMinor = null;
    if (search) filter.$or = ["title", "sellerSku", "variations.name", "variations.value"].map(field => ({ [field]: { $regex: search, $options: "i" } }));
    const sortOptions = { title_asc: ["title", 1], title_desc: ["title", -1], stock_asc: ["stock", 1], stock_desc: ["stock", -1], price_asc: ["price", 1], price_desc: ["price", -1], capital_asc: ["capitalCostMinor", 1], capital_desc: ["capitalCostMinor", -1], margin_asc: ["settlementProfitMargin", 1], margin_desc: ["settlementProfitMargin", -1], synced_asc: ["lastSyncedAt", 1], synced_desc: ["lastSyncedAt", -1] };
    const [sortField, direction] = Object.hasOwn(sortOptions, req.query.sort) ? sortOptions[req.query.sort] : sortOptions.title_asc;
    const needsAllMetrics = sortField === "settlementProfitMargin" || ["profitable", "unprofitable"].includes(selectedFilter);
    const totalCandidates = await Mapping.countDocuments(filter);
    const pipeline = [{ $match: filter }, { $set: { sortValue: ["price", "capitalCostMinor"].includes(sortField) ? { $convert: { input: "$" + sortField, to: "decimal", onNull: null, onError: null } } : "$" + sortField } }, { $set: { sortMissing: { $cond: [{ $eq: [{ $ifNull: ["$sortValue", null] }, null] }, 1, 0] } } }, { $sort: { sortMissing: 1, sortValue: direction, title: 1, _id: 1 } }];
    if (!needsAllMetrics) { const page = Math.min(requestedPage, Math.max(1, Math.ceil(totalCandidates / pageSize))); pipeline.push({ $skip: (page - 1) * pageSize }, { $limit: pageSize }); }
    pipeline.push({ $project: { sortValue: 0, sortMissing: 0 } });
    const rows = await Mapping.aggregate(pipeline);
    const metrics = await productSettlementMetrics(shop.shopId, rows, { ...(/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? { from: `${req.query.from}T00:00:00+08:00` } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? { to: `${req.query.to}T23:59:59.999+08:00` } : {}) });
    let products = rows.map(row => ({ ...row, capitalCost: publicVariantCost(row), ...metrics.get(row.tiktokSkuId) }));
    if (["profitable", "unprofitable"].includes(selectedFilter)) products = products.filter(row => row.settledUnits > 0 && (selectedFilter === "profitable" ? row.settledProfit > 0 : row.settledProfit < 0));
    if (sortField === "settlementProfitMargin") products.sort((a, b) => a[sortField] == null ? (b[sortField] == null ? String(a._id).localeCompare(String(b._id)) : 1) : b[sortField] == null ? -1 : direction * (a[sortField] - b[sortField]) || String(a._id).localeCompare(String(b._id)));
    const total = needsAllMetrics ? products.length : totalCandidates; const pages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(requestedPage, pages);
    if (needsAllMetrics) products = products.slice((page - 1) * pageSize, page * pageSize);
    const settings = await SystemSettings.findOne({ key: "singleton" }).lean();
    const recommendations = await productPricing(shop.shopId, products, settings || {});
    products = products.map(product => ({ ...product, pricing: recommendations.get(String(product._id)) }));
    res.json({ products, total, page, pages, pageSize, lastSyncedAt: shop.lastProductSyncAt, lowStockThreshold: settings?.lowStockThreshold ?? 5, enableLowStockAlerts: settings?.enableLowStockAlerts !== false });
  } catch (error) { if (error.statusCode === 401) error.statusCode = 409; next(error); }
};
export const updateCosts = async (req, res, next) => { try { const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); if (!shop?.shopId) throw failure("Connect TikTok Shop first.", 409); res.json(await setVariantCosts({ shopId: shop.shopId, edits: req.body?.edits, userId: req.user._id, reason: req.body?.reason })); } catch (error) { next(error); } };
export const pricing = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw failure("Invalid variant ID.", 400);
    const shop = await TikTokShop.findOne({ key: "singleton" }).lean();
    const product = await Mapping.findOne({ _id: req.params.id, shopId: shop?.shopId }).lean();
    if (!product) throw failure("TikTok variant not found.", 404);
    const allowed = ["targetMargin", "useManual", "deductionRate", "fixedCharge", "discountPercent", "discountFixed"];
    if (Object.keys(req.query).some(key => !allowed.includes(key)) || Object.values(req.query).some(value => typeof value !== "string")) throw failure("Invalid pricing parameters.", 400);
    if (req.query.useManual !== undefined && !["true", "false"].includes(req.query.useManual)) throw failure("Choose a valid pricing model.", 400);
    const settings = await SystemSettings.findOne({ key: "singleton" }).lean();
    const result = await productPricing(shop.shopId, [product], settings || {}, { ...req.query, useManual: req.query.useManual === "true" });
    res.json(result.get(String(product._id)));
  } catch (error) { next(error); }
};
export const costHistory = async (req, res, next) => { try { if (!mongoose.isValidObjectId(req.params.id)) throw failure("Invalid variant ID.", 400); const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); const variant = await Mapping.findOne({ _id: req.params.id, shopId: shop?.shopId }).lean(); if (!variant) throw failure("TikTok variant not found.", 404); const history = await TikTokVariantCost.find({ shopId: shop.shopId, tiktokProductId: variant.tiktokProductId, tiktokSkuId: variant.tiktokSkuId }).populate("changedBy", "name").sort({ effectiveFrom: -1 }).lean(); res.json({ history: history.map(row => ({ ...row, cost: Number(BigInt(row.costMinor || 0)) / 100 })) }); } catch (error) { next(error); } };
