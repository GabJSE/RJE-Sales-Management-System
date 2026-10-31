import mongoose from "mongoose";
import Mapping from "../models/TikTokProductMapping.js";
import TikTokShop from "../models/TikTokShop.js";
import Product from "../models/Product.js";
import { refreshShop, syncProducts } from "../services/tiktokProductService.js";
import { failure } from "../services/tiktokApiService.js";
import TikTokVariantCost from "../models/TikTokVariantCost.js";
import { publicVariantCost, setVariantCosts } from "../services/tiktokVariantCostService.js";
export const shops = async (_req, res, next) => { try { res.json(await refreshShop()); } catch (error) { if (error.statusCode === 401) error.statusCode = 409; next(error); } };
export const sync = async (_req, res, next) => { try { res.json(await syncProducts()); } catch (error) { if (error.statusCode === 401) error.statusCode = 409; next(error); } };
export const list = async (req, res, next) => {
  try {
    const shop = await TikTokShop.findOne({ key: "singleton" }).lean();
    if (!shop?.shopId) return res.json({ products: [], total: 0, page: 1, pages: 1 });
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const search = String(req.query.search || "").slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = { shopId: shop.shopId, ...(req.query.missingCost === "true" ? { capitalCostMinor: null } : {}), ...(req.query.includeArchived === "true" ? {} : { archivedAt: null }), ...(search ? { $or: [{ title: { $regex: search, $options: "i" } }, { sellerSku: { $regex: search, $options: "i" } }] } : {}) };
    const [rows, total] = await Promise.all([Mapping.find(filter).sort({ title: 1, _id: 1 }).skip((page - 1) * 25).limit(25).populate("rjeProductId", "name sku").lean(), Mapping.countDocuments(filter)]);
    const products = rows.map(row => ({ ...row, capitalCost: publicVariantCost(row) }));
    res.json({ products, total, page, pages: Math.max(1, Math.ceil(total / 25)), lastSyncedAt: shop.lastProductSyncAt });
  } catch (error) { if (error.statusCode === 401) error.statusCode = 409; next(error); }
};
export const updateCosts = async (req, res, next) => { try { const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); if (!shop?.shopId) throw failure("Connect TikTok Shop first.", 409); res.json(await setVariantCosts({ shopId: shop.shopId, edits: req.body?.edits, userId: req.user._id, reason: req.body?.reason })); } catch (error) { next(error); } };
export const costHistory = async (req, res, next) => { try { if (!mongoose.isValidObjectId(req.params.id)) throw failure("Invalid variant ID.", 400); const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); const variant = await Mapping.findOne({ _id: req.params.id, shopId: shop?.shopId }).lean(); if (!variant) throw failure("TikTok variant not found.", 404); const history = await TikTokVariantCost.find({ shopId: shop.shopId, tiktokProductId: variant.tiktokProductId, tiktokSkuId: variant.tiktokSkuId }).populate("changedBy", "name").sort({ effectiveFrom: -1 }).lean(); res.json({ history: history.map(row => ({ ...row, cost: Number(BigInt(row.costMinor || 0)) / 100 })) }); } catch (error) { next(error); } };
export const map = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw failure("Invalid mapping ID.", 400);
    const shop = await TikTokShop.findOne({ key: "singleton" });
    if (shop?.status !== "connected") throw failure("Connect TikTok Shop first.", 401);
    if (shop.syncLeaseUntil > new Date()) throw failure("Wait for synchronization to finish before mapping.", 409);
    const row = await Mapping.findOne({ _id: req.params.id, shopId: shop.shopId });
    if (!row) throw failure("Mapping not found.", 404);
    const id = req.body.rjeProductId;
    if (id !== null && (!mongoose.isValidObjectId(id) || !await Product.exists({ _id: id }))) throw failure("Select an existing RJE product.", 400);
    row.rjeProductId = id; row.mappingSource = "manual"; row.mappingStatus = id ? "mapped" : "unmatched";
    await row.save();
    res.json({ message: id ? "Legacy mapping saved for migration compatibility. TikTok stock remains informational." : "Legacy mapping removed.", inventory: { updated: 0, readOnly: true } });
  } catch (error) { if (error.statusCode === 401) error.statusCode = 409; next(error); }
};

