import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Mapping from "../models/TikTokProductMapping.js";
import Cost from "../models/TikTokVariantCost.js";
import Order from "../models/TikTokOrder.js";
import Settlement from "../models/TikTokSettlement.js";
import { setVariantCosts, costAt } from "../services/tiktokVariantCostService.js";
let server;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { downloadDir: fileURLToPath(new URL("../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
  await mongoose.connect(server.getUri("catalog_cost_tests"));
  await Promise.all([Mapping.init(), Cost.init(), Order.init(), Settlement.init()]);
});
after(async () => { await mongoose.disconnect(); if (server) await server.stop(); });

test("catalog edits persist auditable costs without changing historical order or statement profit", async () => {
  const variant = await Mapping.create({ shopId: "shop", tiktokProductId: "p", tiktokSkuId: "s", capitalCostMinor: "1000" });
  const prior = new Date("2020-01-01");
  await Cost.create({ shopId: "shop", tiktokProductId: "p", tiktokSkuId: "s", costMinor: "1000", effectiveFrom: prior, source: "manual" });
  await Order.create({ shopId: "shop", orderId: "old", createdAtTikTok: prior, lines: [{ skuId: "s", capitalCostMinorSnapshot: "1000" }] });
  await Settlement.create({ shopId: "shop", statementId: "old", settlementDate: prior, reconciliationStatus: "reconciled", calculatedProfitMinor: "5000" });
  await setVariantCosts({ shopId: "shop", edits: [{ variantId: String(variant._id), cost: "12.55" }], reason: "Catalog test", userId: new mongoose.Types.ObjectId() });
  assert.equal((await Mapping.findById(variant._id)).capitalCostMinor, "1255");
  assert.equal((await costAt("shop", "p", "s", prior)).costMinor, "1000");
  assert.equal((await costAt("shop", "p", "s", new Date())).costMinor, "1255");
  assert.equal((await Order.findOne()).lines[0].capitalCostMinorSnapshot, "1000");
  assert.equal((await Settlement.findOne()).calculatedProfitMinor, "5000");
  assert.equal(await Cost.countDocuments(), 2);
  await setVariantCosts({ shopId: "shop", edits: [{ variantId: String(variant._id), cost: "12.55" }] });
  assert.equal(await Cost.countDocuments(), 2);
  for (const cost of ["", "-1", "1.234", 1.234, Infinity]) await assert.rejects(setVariantCosts({ shopId: "shop", edits: [{ variantId: String(variant._id), cost }] }), error => error.statusCode === 400);
});
