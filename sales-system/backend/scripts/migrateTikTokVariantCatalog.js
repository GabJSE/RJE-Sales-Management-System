import "dotenv/config";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import Mapping from "../models/TikTokProductMapping.js";
import TikTokVariantCost from "../models/TikTokVariantCost.js";
import { minorString, toMinor } from "../services/money.js";

const apply = process.argv.includes("--apply");
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");
await mongoose.connect(process.env.MONGODB_URI);
try {
  const [products, variants] = await Promise.all([Product.find().lean(), Mapping.find().lean()]);
  const productById = new Map(products.map(row => [String(row._id), row])); const grouped = new Map();
  for (const row of variants.filter(row => row.mappingStatus === "mapped" && row.rjeProductId)) { const key = String(row.rjeProductId); grouped.set(key, [...(grouped.get(key) || []), row]); }
  const transferable = []; const conflicts = []; const missing = [];
  for (const row of variants) {
    if (row.capitalCostMinor != null) continue;
    if (!row.rjeProductId || row.mappingStatus !== "mapped") { missing.push({ variantId: row._id, reason: "no_verified_mapping" }); continue; }
    const product = productById.get(String(row.rjeProductId));
    if (!product || grouped.get(String(row.rjeProductId))?.length !== 1) { conflicts.push({ variantId: row._id, reason: !product ? "local_product_missing" : "mapping_not_one_to_one" }); continue; }
    transferable.push({ row, product });
  }
  const summary = { mode: apply ? "apply" : "dry-run", localProducts: products.length, variants: variants.length, costsAlreadyPresent: variants.filter(row => row.capitalCostMinor != null).length, transferable: transferable.length, conflicts: conflicts.length, missing: missing.length, productsToArchive: products.filter(row => !row.archivedAt).length };
  if (apply) {
    const now = new Date();
    for (const { row, product } of transferable) {
      const costMinor = minorString(toMinor(product.capitalPrice));
      await TikTokVariantCost.updateOne({ shopId: row.shopId, tiktokProductId: row.tiktokProductId, tiktokSkuId: row.tiktokSkuId, source: "migration" }, { $setOnInsert: { costMinor, effectiveFrom: now, effectiveTo: null, reason: `Migrated from archived RJE product ${product._id}` } }, { upsert: true });
      await Mapping.updateOne({ _id: row._id, capitalCostMinor: null }, { $set: { capitalCostMinor: costMinor, capitalCostEffectiveFrom: now } });
    }
    await Product.updateMany({ archivedAt: null }, { $set: { archivedAt: now } });
  }
  console.log(JSON.stringify({ ...summary, conflictSamples: conflicts.slice(0, 20), missingSamples: missing.slice(0, 20) }, null, 2));
} finally { await mongoose.disconnect(); }
