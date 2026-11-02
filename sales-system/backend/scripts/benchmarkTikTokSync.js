import { fileURLToPath } from "node:url";
// Controlled local benchmark; never reads .env or uses a production database/API.
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Shop from "../models/TikTokShop.js";
import Order from "../models/TikTokOrder.js";
import Mapping from "../models/TikTokProductMapping.js";
import Cost from "../models/TikTokVariantCost.js";
import Transaction from "../models/TikTokFinanceTransaction.js";
import Settlement from "../models/TikTokSettlement.js";
import Earning from "../models/TikTokEarning.js";
import { encryptToken } from "../config/tiktok.js";
import { tiktokRequest } from "../services/tiktokApiService.js";
import { syncTikTokOrders, normalizeTikTokOrder } from "../services/tiktokOrderService.js";
import { syncTikTokSettlements, importStatement } from "../services/tiktokSettlementService.js";
import { summarizeProductSettlements, productSettlementMetrics } from "../services/tiktokProductMetricsService.js";
import { forEachBatch } from "../services/batchService.js";
const count = Math.max(100, Math.min(10000, Number(process.env.BENCHMARK_RECORDS) || 500));
Object.assign(process.env, { TIKTOK_APP_KEY: "benchmark", TIKTOK_APP_SECRET: "benchmark-secret", TIKTOK_SERVICE_ID: "benchmark", TIKTOK_REDIRECT_URI: "https://example.test/callback", TIKTOK_TOKEN_ENCRYPTION_KEY: "a".repeat(64), TIKTOK_API_BASE_URL: "https://example.test" });
const server = await MongoMemoryServer.create({ binary: { downloadDir: fileURLToPath(new URL("../node_modules/.cache/mongodb-memory-server", import.meta.url)) } });
const originalFetch = globalThis.fetch;
let apiRequests = 0; let databaseOperations = 0; let activeScenario = false;
mongoose.set("debug", () => { if (activeScenario) databaseOperations++; });
const rows = Array.from({ length: count }, (_, i) => ({ id: `order-${i}`, status: "COMPLETED", create_time: Math.floor(Date.now() / 1000) - 86400 * 30, update_time: Math.floor(Date.now() / 1000) - 3600, payment: { currency: "PHP", total_amount: "100" }, line_items: [{ id: `line-${i}`, product_id: "product", sku_id: "sku", quantity: 1, currency: "PHP" }] }));
const settledCount = Math.min(10, count);
const transactions = rows.slice(0, settledCount).map((row, i) => ({ id: `tx-${i}`, type: "ORDER", order_id: row.id, revenue_amount: "100", settlement_amount: "80" }));
globalThis.fetch = async (url, options) => {
  if (url.origin !== "https://example.test") throw new Error("Benchmark attempted a non-fixture API request");
  apiRequests++; await new Promise(resolve => setTimeout(resolve, 2));
  let data;
  if (url.pathname === "/order/202309/orders/search") {
    const body = JSON.parse(options.body); const filtered = rows.filter(row => row.update_time >= (body.update_time_ge || 0) && row.update_time < body.update_time_lt);
    const offset = Number(url.searchParams.get("page_token") || 0);
    data = { orders: filtered.slice(offset, offset + 100).map(({ id, status, update_time }) => ({ id, status, update_time })), next_page_token: offset + 100 < filtered.length ? String(offset + 100) : "" };
  } else if (url.pathname === "/order/202507/orders") data = { orders: url.searchParams.get("ids").split(",").map(id => rows.find(row => row.id === id)) };
  else if (url.pathname.endsWith("withdrawals")) data = { withdrawals: [] };
  else if (url.pathname === "/finance/202309/statements") data = { statements: [{ id: "statement", statement_time: Math.floor(Date.now() / 1000) - 60 }] };
  else if (url.pathname.includes("/statements/")) data = { currency: "PHP", create_time: Math.floor(Date.now() / 1000) - 60, total_settlement_amount: String(settledCount * 80), transactions };
  else if (url.pathname.includes("/finance/202501/orders/")) {
    const id = decodeURIComponent(url.pathname.split("/")[4]);
    data = { sku_transactions: rows.slice(0, settledCount).some(row => row.id === id) ? [{ sku_id: "sku", statement_id: "statement", quantity: 1 }] : [] };
  } else throw new Error(`Unexpected benchmark path: ${url.pathname}`);
  return new Response(JSON.stringify({ code: 0, data }));
};
async function measure(name, task) {
  globalThis.gc?.(); apiRequests = 0; databaseOperations = 0;
  const before = process.memoryUsage().heapUsed; let peak = before;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
  const start = performance.now(); activeScenario = true;
  try { const result = await task(); peak = Math.max(peak, process.memoryUsage().heapUsed); return { name, apiRequests, databaseOperations, durationMs: Math.round(performance.now() - start), peakHeapIncreaseBytes: Math.max(0, peak - before), result }; }
  finally { activeScenario = false; clearInterval(sampler); }
}
try {
  await mongoose.connect(server.getUri("benchmark")); await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const shop = await Shop.create({ shopId: "shop", shopCipher: "cipher", status: "connected", scopes: ["seller.order.info", "seller.finance.info"], accessToken: encryptToken("fixture-token"), accessTokenExpiresAt: new Date(Date.now() + 3600000) });
  await Cost.create({ shopId: "shop", tiktokProductId: "product", tiktokSkuId: "sku", costMinor: "1000", effectiveFrom: new Date(0), source: "manual" });
  const report = { fixture: { orders: count, settledOrders: settledCount, simulatedApiLatencyMs: 2, note: "Local temporary MongoDB and mocked TikTok responses. Not an Atlas or live TikTok speed guarantee. Database operations include token reads, logs and lease writes." }, measurements: [] };
  report.measurements.push(await measure("orders: previous per-record write pattern", async () => {
    let token; let imported = 0;
    do {
      const page = await tiktokRequest("/order/202309/orders/search", { method: "POST", query: { shop_cipher: "cipher", page_size: 100, page_token: token }, body: { update_time_ge: 0, update_time_lt: Math.floor(Date.now() / 1000) } });
      for (let offset = 0; offset < page.orders.length; offset += 50) {
        const details = await tiktokRequest("/order/202507/orders", { query: { shop_cipher: "cipher", ids: page.orders.slice(offset, offset + 50).map(row => row.id) } });
        const [variants, costs] = await Promise.all([Mapping.find({ shopId: "shop" }).lean(), Cost.find({ shopId: "shop" }).lean()]);
        for (const row of details.orders) { const existing = await Order.findOne({ shopId: "shop", orderId: row.id }).lean(); const normalized = normalizeTikTokOrder(row, variants, costs, existing); normalized.shopId = "shop"; await Order.updateOne({ shopId: "shop", orderId: row.id }, { $set: normalized }, { upsert: true }); imported++; }
      }
      token = page.next_page_token;
    } while (token);
    return { imported };
  }));
  await Order.deleteMany({});
  report.measurements.push(await measure("orders: optimized full import", () => syncTikTokOrders()));
  rows.slice(0, 10).forEach(row => { row.update_time = Math.floor(Date.now() / 1000) - 1; row.status = "CANCELLED"; });
  // Include the ten changes inside the overlap and exclude older records.
  report.measurements.push(await measure("orders: optimized incremental (10 updated records)", () => syncTikTokOrders()));
  report.measurements.push(await measure("finance: previous broad order discovery (three concurrent)", async () => {
    await tiktokRequest("/finance/202309/withdrawals", { query: { shop_cipher: "cipher" } });
    const orders = await Order.find({ shopId: "shop" }).lean(); const finance = new Map(); const statements = new Set();
    await forEachBatch(orders, 3, async order => { const data = await tiktokRequest(`/finance/202501/orders/${encodeURIComponent(order.orderId)}/statement_transactions`, { query: { shop_cipher: "cipher" } }); finance.set(order.orderId, data); for (const row of data.sku_transactions) if (row.statement_id) statements.add(row.statement_id); await Order.updateOne({ _id: order._id }, { $set: { finance: data, financeSyncedAt: new Date() } }); });
    for (const id of statements) await importStatement(shop, id, finance);
    return { ordersChecked: orders.length };
  }));
  await Order.updateMany({}, { $set: { finance: null }, $unset: { financeSyncedAt: 1 } }); await Transaction.deleteMany({}); await Settlement.deleteMany({});
  report.measurements.push(await measure("finance: optimized statement discovery (cold cache)", () => syncTikTokSettlements()));
  report.measurements.push(await measure("finance: optimized immediate repeat (short cache)", () => syncTikTokSettlements()));
  const products = [{ tiktokProductId: "product", tiktokSkuId: "sku", currency: "PHP" }];
  report.measurements.push(await measure("metrics: previous history loaded into Node", async () => { const orders = await Order.find({ shopId: "shop", "lines.skuId": "sku" }).lean(); const tx = await Transaction.find({ shopId: "shop", tiktokOrderId: { $in: orders.map(row => row.orderId) } }).lean(); return [...summarizeProductSettlements(products, orders, tx).values()]; }));
  report.measurements.push(await measure("metrics: optimized Mongo aggregation", async () => [...(await productSettlementMetrics("shop", products)).values()]));
  const reference = report.measurements.at(-2).result[0]; const actual = report.measurements.at(-1).result[0];
  for (const key of Object.keys(reference)) if (actual[key] !== reference[key]) throw new Error(`Metric mismatch: ${key}`);
  await fs.writeFile(new URL("../../docs/tiktok-sync-benchmark.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally { globalThis.fetch = originalFetch; await mongoose.disconnect(); await server.stop(); }
