import { getOrder } from "../controllers/tiktokOrderController.js";
import { getDashboard } from "../controllers/dashboardController.js";
import { list as listTikTokProducts } from "../controllers/tiktokProductController.js";
import LegacySale from "../models/Sale.js";
import * as financeController from "../controllers/tiktokSettlementController.js";
import { fileURLToPath } from "node:url";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Shop from "../models/TikTokShop.js";
import Order from "../models/TikTokOrder.js";
import Mapping from "../models/TikTokProductMapping.js";
import Cost from "../models/TikTokVariantCost.js";
import Transaction from "../models/TikTokFinanceTransaction.js";
import Settlement from "../models/TikTokSettlement.js";
import FinanceSyncLog from "../models/TikTokFinanceSyncLog.js";
import Earning from "../models/TikTokEarning.js";
import WebhookEvent from "../models/TikTokWebhookEvent.js";
import { acceptTikTokWebhook } from "../services/tiktokWebhookService.js";
import { queueSync } from "../controllers/tiktokSyncJobController.js";
import Job from "../models/TikTokSyncJob.js";
import { encryptToken } from "../config/tiktok.js";
import { syncTikTokOrders } from "../services/tiktokOrderService.js";
import { syncProducts } from "../services/tiktokProductService.js";
import { syncTikTokSettlements, reconcileTikTokEarnings, importStatement, financeOverview, listFinanceSettlements, listTikTokEarnings } from "../services/tiktokSettlementService.js";
import { enqueueSync, recoverExpiredJobs, runNextSyncJob } from "../services/tiktokSyncJobService.js";
import { summarizeProductSettlements, productSettlementMetrics } from "../services/tiktokProductMetricsService.js";
import { invalidateFinanceCache } from "../services/financeCacheService.js";
import { syncBulkWrite } from "../services/syncDataService.js";
import { measureSync, reportSync } from "../services/syncTelemetry.js";
import { setHistoricalOrderLineCost } from "../services/tiktokVariantCostService.js";
let server;
before(async () => {
  // Never load .env or connect to an existing database.
  Object.assign(process.env, { TIKTOK_APP_KEY: "fixture", TIKTOK_APP_SECRET: "fixture-secret", TIKTOK_SERVICE_ID: "fixture", TIKTOK_REDIRECT_URI: "https://example.test/callback", TIKTOK_TOKEN_ENCRYPTION_KEY: "a".repeat(64), TIKTOK_API_BASE_URL: "https://example.test" });
  server = await MongoMemoryServer.create({ binary: { downloadDir: fileURLToPath(new URL("../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(server.getUri("sync_tests"));
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
});
after(async () => { await mongoose.disconnect(); if (server) await server.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map(model => model.deleteMany({}))); invalidateFinanceCache("shop");
  await Shop.create({ shopId: "shop", shopCipher: "cipher", status: "connected", scopes: ["seller.order.info", "seller.finance.info"], accessToken: encryptToken("fixture-token"), accessTokenExpiresAt: new Date(Date.now() + 3600000) });
});
const reply = data => new Response(JSON.stringify({ code: 0, data }));
const sourceOrder = () => ({ id: "o1", status: "COMPLETED", create_time: 1700000000, update_time: 1790000000, payment: { currency: "PHP", total_amount: "100" }, line_items: [{ id: "l1", sku_id: "s1", product_id: "p1", product_name: "Product", quantity: 2 }] });
const cachedOrder = overrides => ({ shopId: "shop", orderId: "o1", status: "COMPLETED", createdAtTikTok: new Date("2023-11-14"), lines: [{ lineItemId: "l1", skuId: "s1", productId: "p1", quantity: 2, capitalCostMinorSnapshot: "1000", capitalCostSnapshot: 10, capitalCostSource: "historical_override" }], ...overrides });
function orderApi(t, handler) {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.origin, "https://example.test");
    if (url.pathname.endsWith("search")) return reply(handler(url, JSON.parse(options.body)));
    if (url.pathname === "/order/202507/orders") return reply({ orders: [sourceOrder()] });
    throw new Error("Unexpected fixture API path");
  });
}
test("initial import covers history, deduplicates pages, and bulk upserts with historical costs", async t => {
  await Cost.create({ shopId: "shop", tiktokProductId: "p1", tiktokSkuId: "s1", costMinor: "1000", effectiveFrom: new Date("2020-01-01"), source: "manual" });
  let searches = 0;
  orderApi(t, (_url, body) => { assert.equal(body.update_time_ge, undefined); searches++; return { orders: [{ id: "o1" }, { id: "o1" }], next_page_token: searches === 1 ? "next" : "" }; });
  const result = await measureSync(() => syncTikTokOrders());
  assert.equal(result.ordersCreated, 1); assert.equal(searches, 2); assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Order.findOne()).lines[0].capitalCostMinorSnapshot, "1000");
  assert.ok((await Shop.findOne()).orderCheckpoint); assert.equal(result.performance.databaseBatches, 1);
});
test("incremental sync updates an old order and preserves its manual snapshot", async t => {
  const checkpoint = new Date(Date.now() - 3600000); await Shop.updateOne({}, { orderCheckpoint: checkpoint }); await Order.create(cachedOrder());
  orderApi(t, (_url, body) => { assert.equal(body.update_time_ge, Math.floor((checkpoint.getTime() - 300000) / 1000)); return { orders: [{ id: "o1" }] }; });
  const result = await syncTikTokOrders(); assert.equal(result.ordersUpdated, 1);
  assert.equal((await Order.findOne()).lines[0].capitalCostMinorSnapshot, "1000"); assert.ok((await Shop.findOne()).orderCheckpoint >= checkpoint);
});
test("network interruptions and missing details do not advance checkpoints", async t => {
  const checkpoint = new Date(Date.now() - 3600000); await Shop.updateOne({}, { orderCheckpoint: checkpoint });
  t.mock.method(globalThis, "fetch", async url => reply(url.pathname.endsWith("search") ? { orders: [{ id: "o1" }] } : { orders: [] }));
  await assert.rejects(syncTikTokOrders(), /incomplete/); assert.equal((await Shop.findOne()).orderCheckpoint.getTime(), checkpoint.getTime());
  assert.equal((await Shop.findOne()).orderSyncOwner, undefined);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network down"); });
  await assert.rejects(syncTikTokOrders(), /could not be reached/); assert.equal((await Shop.findOne()).orderCheckpoint.getTime(), checkpoint.getTime());
});
test("repeated pagination tokens stop safely", async t => {
  orderApi(t, () => ({ orders: [], next_page_token: "repeat" })); await assert.rejects(syncTikTokOrders(), /repeated a pagination/);
  assert.equal((await Shop.findOne()).orderCheckpoint, undefined);
});
test("incremental catalog preserves capital and untouched variants; full refresh omits filters", async t => {
  const now = new Date(); await Shop.updateOne({}, { productCheckpoint: now, lastFullProductSyncAt: now });
  await Mapping.create([{ shopId: "shop", tiktokProductId: "p1", tiktokSkuId: "s1", capitalCostMinor: "1234" }, { shopId: "shop", tiktokProductId: "p2", tiktokSkuId: "s2", capitalCostMinor: "5678" }]);
  let full = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.pathname.includes("authorization")) return reply({ shops: [{ id: "shop", region: "PH", cipher: "cipher" }] });
    if (url.pathname.endsWith("search")) { const body = JSON.parse(options.body); assert.equal(Boolean(body.update_time_ge), !full); return reply({ products: [{ id: "p1" }] }); }
    return reply({ id: "p1", title: "Changed", skus: [{ id: "s1", price: { currency: "PHP", tax_exclusive_price: "100" }, inventory: [{ quantity: 5 }] }] });
  });
  await syncProducts(); assert.equal((await Mapping.findOne({ tiktokSkuId: "s1" })).capitalCostMinor, "1234"); assert.equal((await Mapping.findOne({ tiktokSkuId: "s2" })).archivedAt, null);
  full = true; await syncProducts({ forceFull: true }); assert.equal((await Mapping.findOne({ tiktokSkuId: "s1" })).capitalCostMinor, "1234"); assert.equal(await Mapping.countDocuments(), 2);
});
function financeApi(t, { transactions = [], statements = [{ id: "st1", statement_time: Math.floor(Date.now() / 1000) - 60 }], onOrderFinance } = {}) {
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url.origin, "https://example.test");
    if (url.pathname.endsWith("withdrawals")) { assert.notEqual(url.searchParams.get("create_time_ge"), "0"); return reply({ withdrawals: [] }); }
    if (url.pathname === "/finance/202309/statements") { assert.notEqual(url.searchParams.get("statement_time_ge"), "0"); return reply({ statements }); }
    if (url.pathname.includes("/statements/")) return reply({ currency: "PHP", create_time: 1790000000, total_settlement_amount: "80", transactions });
    if (url.pathname.includes("/orders/")) { onOrderFinance?.(); return reply({ sku_transactions: [{ sku_id: "s1", statement_id: "st1", quantity: 2 }] }); }
    throw new Error("Unexpected finance fixture path");
  });
}
const financeRow = () => ({ id: "tx1", type: "ORDER", order_id: "o1", revenue_amount: "100", settlement_amount: "80" });

test("unmatched earnings recover undiscovered statements behind the finance checkpoint", async t => {
  const day = 86400_000;
  const earningDate = new Date(Date.now() - 10 * day);
  const statementDate = new Date(earningDate.getTime() - 29 * day);
  await Shop.updateOne({}, { financeCheckpoint: new Date(Date.now() - 3600000), lastFullFinanceSyncAt: new Date() });
  await Order.create(cachedOrder());
  await Earning.create({ shopId: "shop", transactionId: "missed-earning", type: "SETTLE", status: "SUCCESS", amountMinor: "8000", originalAmount: "80", currency: "PHP", transactionDate: earningDate, reconciliationStatus: "awaiting_transactions" });
  financeApi(t, { statements: [{ id: "st1", statement_time: Math.floor(statementDate.getTime() / 1000) }], transactions: [financeRow()] });
  const result = await syncTikTokSettlements();
  assert.equal(result.statements, 1);
  const earning = await Earning.findOne();
  assert.equal(earning.reconciliationStatus, "reconciled");
  assert.equal(earning.profitMinor, "6000");
  assert.equal(earning.linkedSettlementIds.length, 1);
});
test("new statements bypass a fresh pre-settlement cache and deduplicate totals", async t => {
  await Order.create(cachedOrder({ finance: { sku_transactions: [] }, financeSyncedAt: new Date() }));
  let requests = 0; financeApi(t, { transactions: [financeRow(), financeRow()], onOrderFinance: () => requests++ }); await syncTikTokSettlements();
  assert.equal(requests, 1); assert.equal(await Transaction.countDocuments(), 1);
  const statement = await Settlement.findOne(); assert.equal(statement.netSettlementMinor, "8000"); assert.equal(statement.totalCapitalCostMinor, "2000"); assert.equal(statement.calculatedProfitMinor, "6000"); assert.ok((await Shop.findOne()).financeCheckpoint);
});
test("older unresolved statements bypass cache outside the incremental window", async t => {
  await Shop.updateOne({}, { financeCheckpoint: new Date(Date.now() - 3600000), lastFullFinanceSyncAt: new Date() });
  await Order.create(cachedOrder({ finance: { sku_transactions: [{ sku_id: "s1", statement_id: "st1", quantity: 2 }] }, financeSyncedAt: new Date() }));
  await Settlement.create({ shopId: "shop", statementId: "st1", settlementDate: new Date("2020-01-01"), reconciliationStatus: "awaiting_reconciliation" });
  let requests = 0; financeApi(t, { statements: [], transactions: [financeRow()], onOrderFinance: () => requests++ }); await syncTikTokSettlements();
  assert.equal(requests, 1); assert.equal((await Settlement.findOne()).reconciliationStatus, "reconciled");
});
test("recent matching finance is reused briefly; full refresh bypasses it", async t => {
  await Order.create(cachedOrder({ finance: { sku_transactions: [{ sku_id: "s1", statement_id: "st1", quantity: 2 }] }, financeSyncedAt: new Date() }));
  let requests = 0; financeApi(t, { transactions: [financeRow()], onOrderFinance: () => requests++ }); await syncTikTokSettlements(); assert.equal(requests, 0);
  await syncTikTokSettlements({ forceFull: true }); assert.equal(requests, 1); assert.equal((await Order.findOne()).lines[0].capitalCostMinorSnapshot, "1000");
});
test("partial unordered write failures preserve successes and expose failed record IDs", async () => {
  const good = { shopId: "shop", tiktokProductId: "p1", tiktokSkuId: "s1" };
  // Duplicate unique identity on one upsert; the other operation still succeeds.
  await Mapping.create({ shopId: "shop", tiktokProductId: "p2", tiktokSkuId: "s2" });
  const operations = [{ updateOne: { filter: good, update: { $set: { title: "Good" } }, upsert: true } }, { updateOne: { filter: { shopId: "shop", tiktokProductId: "other", tiktokSkuId: "other" }, update: { $set: { shopId: "shop", tiktokProductId: "p2", tiktokSkuId: "s2" } }, upsert: true } }];
  await assert.rejects(syncBulkWrite(Mapping, operations), error => error.statusCode === 503 && error.failedRecords.length === 1);
  assert.ok(await Mapping.findOne({ tiktokSkuId: "s1" }));
});
test("job uniqueness coalesces concurrent requests; expired jobs recover idempotently", async () => {
  const jobs = await Promise.all(Array.from({ length: 5 }, () => enqueueSync("orders"))); assert.equal(new Set(jobs.map(job => String(job._id))).size, 1);
  await assert.rejects(enqueueSync("orders", { forceFull: true }), error => error.statusCode === 409);
  await Job.updateOne({}, { status: "running", attempts: 1, owner: "old-process", leaseUntil: new Date(Date.now() - 1000) }); await recoverExpiredJobs(); assert.equal((await Job.findOne()).status, "pending");
  await runNextSyncJob({ run: async () => { await reportSync({ stage: "Fixture", processed: 5, total: 5, pages: 1 }); return { fixture: true }; } });
  const job = await Job.findOne(); assert.equal(job.status, "completed"); assert.equal(job.processed, 5); assert.equal(job.activeKey, undefined); assert.ok(job.result.fixture); assert.ok(await enqueueSync("orders"));
});
test("transient job failures back off; authorization errors stop retries", async () => {
  await enqueueSync("settlements"); await runNextSyncJob({ run: async () => { throw Object.assign(new Error("Rate limited"), { statusCode: 503 }); } });
  let job = await Job.findOne(); assert.equal(job.status, "pending"); assert.equal(job.attempts, 1); assert.ok(job.nextAttemptAt > new Date());
  await Job.updateOne({}, { nextAttemptAt: new Date(0) }); await runNextSyncJob({ run: async () => { throw Object.assign(new Error("Reauthorize shop"), { statusCode: 403 }); } });
  job = await Job.findOne(); assert.equal(job.status, "failed"); assert.equal(job.activeKey, undefined);
});
test("restart recovery waits for the previous service lease without exhausting attempts", async () => {
  await enqueueSync("orders"); const until = new Date(Date.now() + 60000); await Shop.updateOne({}, { orderSyncOwner: "previous", orderSyncLeaseUntil: until });
  await runNextSyncJob({ run: async () => assert.fail("Must not overlap") }); const job = await Job.findOne(); assert.equal(job.status, "pending"); assert.equal(job.attempts, 0); assert.ok(job.nextAttemptAt < until); assert.ok(job.nextAttemptAt > new Date());
  await Shop.updateOne({}, { $unset: { orderSyncOwner: 1, orderSyncLeaseUntil: 1 } });
  await Job.updateOne({}, { nextAttemptAt: new Date(0) });
  await runNextSyncJob({ run: async () => ({ recovered: true }) });
  assert.equal((await Job.findOne()).status, "completed");
});
test("Mongo aggregation matches reference margins, exclusions and minor-unit precision", async () => {
  const product = { tiktokSkuId: "s1", tiktokProductId: "p1", currency: "PHP" };
  const orders = [cachedOrder(), cachedOrder({ orderId: "mixed", lines: [{ skuId: "s1", productId: "p1", quantity: 1 }, { skuId: "s2", productId: "p2", quantity: 1 }] })]; await Order.create(orders);
  const tx = [{ transactionId: "good", tiktokOrderId: "o1", revenueMinor: "10000", settlementMinor: "8000", profitMinor: "6000" }, { transactionId: "loss", tiktokOrderId: "o1", revenueMinor: "10000", settlementMinor: "2000", profitMinor: "-1000" }, { transactionId: "refund", tiktokOrderId: "o1", revenueMinor: "-10000", settlementMinor: "-8000", profitMinor: "-6000" }, { transactionId: "mixed", tiktokOrderId: "mixed", revenueMinor: "10000", settlementMinor: "8000", profitMinor: "6000" }, { transactionId: "missing", tiktokOrderId: "o1", revenueMinor: "10000", settlementMinor: "8000", reconciliationStatus: "awaiting_cost" }].map(row => ({ shopId: "shop", statementId: "st1", transactionType: "ORDER", currency: "PHP", reconciliationStatus: "reconciled", statementDate: new Date("2026-10-01"), ...row })); await Transaction.create(tx);
  await Settlement.create({ shopId: "shop", statementId: "st1", settlementDate: new Date("2026-10-01"), reconciliationStatus: "reconciled" });
  const reference = summarizeProductSettlements([product], orders, tx).get("s1"); const actual = (await productSettlementMetrics("shop", [product])).get("s1");
  for (const key of Object.keys(reference)) assert.equal(actual[key], reference[key], key);
  await Settlement.updateOne({}, { reconciliationStatus: "amount_mismatch" });
  assert.equal((await productSettlementMetrics("shop", [product])).get("s1").settlementProfitMargin, null);
  assert.equal((await productSettlementMetrics("shop", [product], { from: "2026-10-02" })).get("s1").settlementProfitMargin, null);
});
test("manual historical cost corrections invalidate affected financial results", async () => {
  await Order.create(cachedOrder()); const statement = await Settlement.create({ shopId: "shop", statementId: "st1", settlementDate: new Date(), reconciliationStatus: "reconciled", calculatedProfitMinor: "6000" });
  await Transaction.create({ shopId: "shop", transactionId: "tx1", statementId: "st1", tiktokOrderId: "o1", reconciliationStatus: "reconciled", profitMinor: "6000", capitalCostKnown: true });
  await Earning.create({ shopId: "shop", transactionId: "earn1", type: "SETTLE", amountMinor: "8000", originalAmount: "80", currency: "PHP", transactionDate: new Date(), reconciliationStatus: "reconciled", linkedSettlementIds: [statement._id], profitMinor: "6000" });
  await setHistoricalOrderLineCost({ shopId: "shop", orderId: "o1", lineItemId: "l1", cost: "15", reason: "Fixture correction" });
  assert.equal((await Transaction.findOne()).profitMinor, undefined); assert.equal((await Settlement.findOne()).reconciliationStatus, "awaiting_reconciliation"); assert.equal((await Earning.findOne()).profitMinor, undefined);
});

test("a newly discovered second statement refreshes an order cached for an earlier statement", async t => {
  await Order.create(cachedOrder({ finance: { sku_transactions: [{ sku_id: "s1", statement_id: "st1", quantity: 1 }] }, financeSyncedAt: new Date() }));
  let fetched = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url.pathname.endsWith("withdrawals")) return reply({ withdrawals: [] });
    if (url.pathname === "/finance/202309/statements") return reply({ statements: [{ id: "st1", statement_time: 1790000000 }, { id: "st2", statement_time: 1790000000 }] });
    if (url.pathname.includes("/statements/")) return reply({ currency: "PHP", create_time: 1790000000, total_settlement_amount: "80", transactions: [{ ...financeRow(), id: url.pathname.includes("st2") ? "tx2" : "tx1" }] });
    if (url.pathname.includes("/orders/")) { fetched++; return reply({ sku_transactions: [{ sku_id: "s1", statement_id: "st1", quantity: 1 }, { sku_id: "s1", statement_id: "st2", quantity: 1 }] }); }
    throw new Error("Unexpected path");
  });
  await syncTikTokSettlements(); assert.equal(fetched, 1);
  assert.equal((await Settlement.findOne({ statementId: "st2" })).totalCapitalCostMinor, "1000");
  assert.equal((await Settlement.findOne({ statementId: "st2" })).reconciliationStatus, "reconciled");
});

test("unchanged completed orders skip redundant detail requests during overlap", async t => {
  orderApi(t, () => ({ orders: [{ id: "o1", status: "COMPLETED", update_time: sourceOrder().update_time }] }));
  await syncTikTokOrders();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async url => { requests++; assert.ok(url.pathname.endsWith("search")); return reply({ orders: [{ id: "o1", status: "COMPLETED", update_time: sourceOrder().update_time }] }); });
  const result = await measureSync(() => syncTikTokOrders()); assert.equal(requests, 1); assert.equal(result.ordersUpdated, 0); assert.equal(result.performance.databaseRecords, 0);
});

test("concurrent manual cost changes are preserved by the order bulk-write version guard", async t => {
  await Order.create(cachedOrder()); const checkpoint = new Date(Date.now() - 3600000); await Shop.updateOne({}, { orderCheckpoint: checkpoint });
  orderApi(t, () => ({ orders: [{ id: "o1" }] }));
  const original = Order.bulkWrite.bind(Order);
  t.mock.method(Order, "bulkWrite", async (...args) => {
    await Order.updateOne({ orderId: "o1" }, { $set: { "lines.0.capitalCostMinorSnapshot": "7777", "lines.0.capitalCostSnapshot": 77.77 }, $inc: { __v: 1 } });
    return original(...args);
  });
  await assert.rejects(syncTikTokOrders(), error => error.statusCode === 409);
  assert.equal((await Order.findOne()).lines[0].capitalCostMinorSnapshot, "7777"); assert.equal((await Shop.findOne()).orderCheckpoint.getTime(), checkpoint.getTime());
});

test("queue respects a long platform retry interval", async () => {
  await enqueueSync("settlements"); const before = Date.now();
  await runNextSyncJob({ run: async () => { throw Object.assign(new Error("Rate limit pause"), { statusCode: 503, retryAfterMs: 30000 }); } });
  const job = await Job.findOne(); assert.ok(job.nextAttemptAt.getTime() >= before + 30000); assert.equal(job.status, "pending");
});

test("webhooks persist a job before acknowledgement and deduplicate notifications", async () => {
  const payload = { tts_notification_id: "fixture-notification", type: 1, shop_id: "shop", data: { order_id: "o1" } };
  assert.equal((await acceptTikTokWebhook(payload)).accepted, true);
  assert.equal(await Job.countDocuments(), 1); const event = await WebhookEvent.findOne(); assert.equal(event.status, "completed"); assert.ok(event.syncJobId);
  assert.equal((await acceptTikTokWebhook(payload)).duplicate, true); assert.equal(await Job.countDocuments(), 1);
});

test("a failed webhook enqueue can safely retry the same notification", async t => {
  const payload = { tts_notification_id: "retry-notification", type: 1, shop_id: "shop", data: { order_id: "o1" } };
  const original = Job.create.bind(Job); let fail = true;
  t.mock.method(Job, "create", async (...args) => { if (fail) { fail = false; throw Object.assign(new Error("temporary database failure"), { statusCode: 503 }); } return original(...args); });
  await assert.rejects(acceptTikTokWebhook(payload)); assert.equal((await WebhookEvent.findOne()).status, "failed");
  assert.equal((await acceptTikTokWebhook(payload)).accepted, true); assert.equal(await Job.countDocuments(), 1); assert.equal((await WebhookEvent.findOne()).status, "completed");
});

test("manual sync controller returns 202 and a persistent job ID before doing API work", async () => {
  let status; let body;
  const res = { status: code => { status = code; return res; }, json: value => { body = value; } };
  await queueSync("settlements")({ body: {} }, res, error => { throw error; });
  assert.equal(status, 202); assert.ok(body.jobId); assert.equal((await Job.findById(body.jobId)).status, "pending");
});

test("finance partial write failure preserves its checkpoint and succeeds idempotently on retry", async t => {
  const checkpoint = new Date(Date.now() - 3600000); await Shop.updateOne({}, { financeCheckpoint: checkpoint, lastFullFinanceSyncAt: new Date() }); await Order.create(cachedOrder());
  financeApi(t, { transactions: [financeRow(), { ...financeRow(), id: "tx2", revenue_amount: "0", settlement_amount: "0" }] });
  const original = Transaction.bulkWrite.bind(Transaction); let fail = true;
  t.mock.method(Transaction, "bulkWrite", async operations => {
    if (fail) { fail = false; await original([operations[0]]); throw { writeErrors: [{ index: 1, code: 91 }] }; }
    return original(operations);
  });
  await assert.rejects(syncTikTokSettlements(), error => error.statusCode === 503 && error.failedRecords.length === 1);
  assert.equal((await Shop.findOne()).financeCheckpoint.getTime(), checkpoint.getTime()); assert.equal(await Transaction.countDocuments(), 1);
  await syncTikTokSettlements(); assert.equal(await Transaction.countDocuments(), 2); assert.ok((await Shop.findOne()).financeCheckpoint > checkpoint);
});

test("zero-match order search may omit the orders array without failing", async t => {
  await Shop.updateOne({}, { orderCheckpoint: new Date(Date.now() - 3600000) });
  orderApi(t, () => ({ total_count: 0, next_page_token: "" }));
  const result = await syncTikTokOrders(); assert.equal(result.ordersFound, 0); assert.equal(result.pagesProcessed, 1); assert.ok((await Shop.findOne()).orderCheckpoint);
});

test("missing orders on a nonempty or unfinished page still fails without advancing coverage", async t => {
  orderApi(t, () => ({ total_count: 1 }));
  await assert.rejects(syncTikTokOrders(), /invalid order page/); assert.equal((await Shop.findOne()).orderCheckpoint, undefined);
  orderApi(t, () => ({ total_count: 0, next_page_token: "more" }));
  await assert.rejects(syncTikTokOrders(), /invalid order page/); assert.equal((await Shop.findOne()).orderCheckpoint, undefined);
});

test("statement discovery includes today's settlement without the API upper-day cutoff", async t => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  await Shop.updateOne({}, { financeCheckpoint: new Date(Date.now() - 3600000), lastFullFinanceSyncAt: new Date() });
  t.mock.method(globalThis, "fetch", async url => {
    if (url.pathname.endsWith("withdrawals")) return reply({ withdrawals: [] });
    if (url.pathname === "/finance/202309/statements") {
      assert.equal(url.searchParams.has("statement_time_lt"), false);
      return reply({ statements: [{ id: "today", statement_time: today.getTime() / 1000 }, { id: "future", statement_time: today.getTime() / 1000 + 86400 }] });
    }
    assert.ok(url.pathname.includes("/statements/today/"));
    return reply({ currency: "PHP", create_time: today.getTime() / 1000, total_settlement_amount: "11691.32", transactions: [{ id: "adjustment", type: "ADJUSTMENT", revenue_amount: "0", settlement_amount: "11691.32" }] });
  });
  const result = await syncTikTokSettlements(); assert.equal(result.statements, 1);
  assert.ok(await Settlement.findOne({ statementId: "today" })); assert.equal(await Settlement.countDocuments({ statementId: "future" }), 0);
});

test("refreshing a settlement updates already-reconciled linked earnings outside the sync range", async () => {
  const statement = await Settlement.create({ shopId: "shop", statementId: "old", settlementDate: new Date("2020-01-01"), netSettlementMinor: "8000", totalCapitalCostMinor: "3000", calculatedProfitMinor: "5000", reconciliationStatus: "reconciled", orderCount: 2 });
  await Earning.create({ shopId: "shop", transactionId: "old-earning", type: "SETTLE", amountMinor: "8000", originalAmount: "80", currency: "PHP", transactionDate: new Date("2020-01-01"), linkedSettlementIds: [statement._id], reconciliationStatus: "reconciled", capitalCostMinor: "1000", profitMinor: "7000" });
  await reconcileTikTokEarnings({ shopId: "shop" }, new Date("2026-10-01"), new Date("2026-10-31"), [statement._id]);
  const earning = await Earning.findOne(); assert.equal(earning.capitalCostMinor, "3000"); assert.equal(earning.profitMinor, "5000"); assert.equal(earning.orderCount, 2);
});

for (const source of ["summary", "root", "settlement", "transaction"]) {
  test(`statement dates resolve from ${source} and remain identical on transactions`, async t => {
    const date = new Date("2020-02-03T00:00:00Z");
    if (source !== "transaction") await Settlement.create({ shopId: "shop", statementId: "st1", settlementDate: source === "settlement" ? date : new Date("2019-01-01") });
    if (source === "transaction") await Transaction.create({ shopId: "shop", statementId: "st1", transactionId: "prior", statementDate: date });
    t.mock.method(globalThis, "fetch", async () => reply({ ...(source === "root" ? { create_time: date.getTime() / 1000 } : {}), transactions: [{ id: "adjustment", type: "ADJUSTMENT", settlement_amount: "1" }] }));
    await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map(), { summary: source === "summary" ? { statement_time: date.getTime() / 1000 } : undefined });
    assert.equal((await Settlement.findOne()).settlementDate.getTime(), date.getTime());
    assert.equal((await Transaction.findOne({ transactionId: "adjustment" })).statementDate.getTime(), date.getTime());
  });
}

test("new undated statement warns once and reuses its date across pages", async t => {
  let page = 0; const warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));
  t.mock.method(globalThis, "fetch", async () => reply({ transactions: [{ id: `a${page}`, type: "ADJUSTMENT", settlement_amount: "1" }], next_page_token: page++ ? undefined : "next" }));
  await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map());
  const statement = await Settlement.findOne(); const rows = await Transaction.find();
  assert.equal(warnings.length, 1);
  assert.ok(rows.every(row => row.statementDate.getTime() === statement.settlementDate.getTime()));
});

test("earnings pagination reconciles every record as the matching set shrinks", async () => {
  await Settlement.create({ shopId: "shop", statementId: "st1", settlementDate: new Date(), netSettlementMinor: "8000", calculatedProfitMinor: "6000", totalCapitalCostMinor: "2000", reconciliationStatus: "reconciled" });
  await Earning.insertMany(Array.from({ length: 205 }, (_, index) => ({ shopId: "shop", transactionId: `earn-${index}`, type: "SETTLE", amountMinor: "8000", originalAmount: "80", currency: "PHP", transactionDate: new Date() })));
  const start = new Date(Date.now() + 86400_000);
  assert.equal(await reconcileTikTokEarnings({ shopId: "shop" }, start, new Date(start.getTime() + 86400_000)), 205);
  assert.equal(await Earning.countDocuments({ reconciliationStatus: "reconciled" }), 205);
});

test("overview uses only reconciled statements for profit and its denominator", async () => {
  await Settlement.create({ shopId: "shop", statementId: "confirmed", settlementDate: new Date("2026-10-10"), netSettlementMinor: "8000", calculatedProfitMinor: "6000", reconciliationStatus: "reconciled" });
  await Settlement.create({ shopId: "shop", statementId: "pending", settlementDate: new Date("2026-10-11"), netSettlementMinor: "12000", calculatedProfitMinor: "9999", reconciliationStatus: "awaiting_reconciliation" });
  const result = await financeOverview("2026-10-01", "2026-10-31");
  assert.equal(result.netSettlement, 200); assert.equal(result.netProfit, 60); assert.equal(result.profitMargin, 75);
  assert.equal(result.reconciledNetSettlement, 80); assert.equal(result.reconciledStatementCount, 1); assert.equal(result.statementCount, 2);
  await Settlement.updateMany({}, { reconciliationStatus: "awaiting_reconciliation" });
  assert.equal((await financeOverview("2026-10-01", "2026-10-31")).profitMargin, null);
});

for (const api of [financeOverview, listFinanceSettlements, listTikTokEarnings]) {
  test(`${api.name} rejects malformed, impossible and reversed date ranges`, async () => {
    for (const [from, to] of [["2026-02-29", "2026-03-01"], ["2026-04-31", "2026-05-01"], ["2026-1-01", "2026-01-31"], ["2026-10-02", "2026-10-01"], [undefined, "2026-10-01"]]) await assert.rejects(api(from, to), error => error.statusCode === 400);
    await api("2024-02-29", "2024-02-29");
  });
}

test("missing-order retries back off, stop at cap and recover when the order arrives", async t => {
  setRetryCap(t, "2");
  let imports = 0;
  financeApi(t, { transactions: [financeRow()] });
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (...args) => { if (args[0].pathname.includes("/statements/")) imports++; return fetch(...args); });
  await syncTikTokSettlements(); assert.equal(imports, 1); assert.equal((await Settlement.findOne()).retryCount, 1);
  await syncTikTokSettlements(); assert.equal(imports, 1);
  await Settlement.updateOne({}, { lastRetriedAt: new Date(0) });
  await syncTikTokSettlements(); assert.equal(imports, 2); assert.equal((await Settlement.findOne()).reconciliationStatus, "unmatchable");
  assert.equal((await Transaction.findOne()).reconciliationStatus, "unmatchable");
  await syncTikTokSettlements(); assert.equal(imports, 2);
  await Order.create(cachedOrder());
  await syncTikTokSettlements(); assert.equal(imports, 3);
  assert.equal((await Settlement.findOne()).reconciliationStatus, "reconciled"); assert.equal((await Settlement.findOne()).retryCount, 0);
  assert.equal((await Transaction.findOne()).retryCount, 0);
});

test("forced full sync resets capped missing-order retries", async t => {
  setRetryCap(t, "1"); financeApi(t, { transactions: [financeRow()] });
  await syncTikTokSettlements(); assert.equal((await Settlement.findOne()).reconciliationStatus, "unmatchable");
  process.env.TIKTOK_FINANCE_MAX_RETRIES = "10";
  await syncTikTokSettlements({ forceFull: true });
  assert.equal((await Settlement.findOne()).retryCount, 1);
  assert.equal((await Transaction.findOne()).reconciliationStatus, "awaiting_order");
});

test("failure to save an error log preserves the original sync error", async t => {
  financeApi(t);
  t.mock.method(FinanceSyncLog.prototype, "save", async () => { throw new Error("log save failed"); });
  t.mock.method(console, "warn", () => {});
  // create uses save too, so inject the already-created log explicitly.
  t.mock.method(FinanceSyncLog, "create", async () => new FinanceSyncLog({ shopId: "shop" }));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network failed"); });
  await assert.rejects(syncTikTokSettlements(), error => !error.message.includes("log save failed"));
});

test("lease heartbeat loss aborts before statement imports and checkpoint writes", async t => {
  let heartbeat; let imports = 0;
  t.mock.method(globalThis, "setInterval", callback => { heartbeat = callback; return { unref() {} }; });
  t.mock.method(globalThis, "clearInterval", () => {});
  const updateOne = Shop.updateOne.bind(Shop);
  t.mock.method(Shop, "updateOne", (filter, update) => update.$set?.settlementSyncLeaseUntil ? Promise.resolve({ matchedCount: 0 }) : updateOne(filter, update));
  t.mock.method(globalThis, "fetch", async url => {
    if (url.pathname.endsWith("withdrawals")) { await heartbeat(); return reply({ withdrawals: [] }); }
    if (url.pathname.endsWith("statements")) return reply({ statements: [{ id: "st1", statement_time: Math.floor(Date.now() / 1000) - 60 }] });
    imports++; throw new Error("unexpected import");
  });
  await assert.rejects(syncTikTokSettlements(), error => error.statusCode === 409 && error.message === "Synchronization lease was lost.");
  assert.equal(imports, 0); assert.equal((await Shop.findOne()).financeCheckpoint, undefined);
});

function setRetryCap(t, value) { const previous = process.env.TIKTOK_FINANCE_MAX_RETRIES; process.env.TIKTOK_FINANCE_MAX_RETRIES = value; t.after(() => { if (previous === undefined) delete process.env.TIKTOK_FINANCE_MAX_RETRIES; else process.env.TIKTOK_FINANCE_MAX_RETRIES = previous; }); }

test("existing undated finance data never receives a fabricated current date", async t => {
  await Transaction.create({ shopId: "shop", statementId: "st1", transactionId: "old" });
  t.mock.method(globalThis, "fetch", async () => reply({ transactions: [] }));
  await assert.rejects(importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map()), /no valid historical date/);
  assert.equal(await Settlement.countDocuments(), 0);
});

test("nullable updates omit empty MongoDB operators", async t => {
  const date = Math.floor(Date.now() / 1000);
  t.mock.method(globalThis, "fetch", async () => reply({ create_time: date, transactions: [{ id: "a", type: "ADJUSTMENT", settlement_amount: "1" }] }));
  const bulkWrite = Transaction.bulkWrite.bind(Transaction);
  t.mock.method(Transaction, "bulkWrite", (operations, options) => {
    for (const { updateOne: { update } } of operations) for (const operator of ["$set", "$unset"]) if (update[operator]) assert.ok(Object.keys(update[operator]).length);
    return bulkWrite(operations, options);
  });
  const findOneAndUpdate = Settlement.findOneAndUpdate.bind(Settlement);
  t.mock.method(Settlement, "findOneAndUpdate", (filter, update, options) => {
    assert.ok(Object.keys(update.$set).length);
    assert.equal(update.$unset, undefined);
    return findOneAndUpdate(filter, update, options);
  });
  await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map());
});

async function callFinance(handler, query = {}, params = {}) {
  let result; let error;
  await handler({ query, params }, { json: value => { result = value; } }, value => { error = value; });
  if (error) throw error;
  return result;
}

test("earnings total includes successful PHP settlements once, excluding withdrawals and failures", async () => {
  const date = new Date("2026-10-10");
  for (const [id, type, status, amount, currency] of [["s1", "SETTLE", "SUCCESS", "10", "PHP"], ["s2", "SETTLE", "SUCCESS", "20", "PHP"], ["w", "WITHDRAW", "SUCCESS", "30", "PHP"], ["r", "REVERSE", "SUCCESS", "30", "PHP"], ["p", "SETTLE", "PROCESSING", "40", "PHP"], ["f", "SETTLE", "FAILED", "50", "PHP"], ["usd", "SETTLE", "SUCCESS", "100", "USD"]]) {
    await Earning.create({ shopId: "shop", transactionId: id, type, status, amountMinor: amount, originalAmount: amount, currency, transactionDate: date });
  }
  const result = await callFinance(financeController.earnings, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(result.total, 0.3); assert.equal(result.earnings.length, 6);
});

test("detail and transaction queries isolate shops with identical statement IDs", async () => {
  const one = await Settlement.create({ shopId: "shop", statementId: "shared", settlementDate: new Date() });
  const other = await Settlement.create({ shopId: "other", statementId: "shared", settlementDate: new Date() });
  await Transaction.create({ shopId: "shop", statementId: "shared", transactionId: "one" });
  await Transaction.create({ shopId: "other", statementId: "shared", transactionId: "two" });
  const detail = await callFinance(financeController.settlementDetail, {}, { id: String(one._id) });
  assert.equal(detail.transactions.length, 1); assert.equal(detail.transactions[0].transactionId, "one");
  await assert.rejects(callFinance(financeController.settlementDetail, {}, { id: String(other._id) }), error => error.statusCode === 404);
  await assert.rejects(callFinance(financeController.settlementDetail, {}, { id: "invalid" }), error => error.statusCode === 404);
  assert.equal((await callFinance(financeController.transactions)).total, 1);
  await assert.rejects(callFinance(financeController.transactions, { page: "1.5" }), error => error.statusCode === 400);
});

test("daily profit uses Manila midnight and integer sums", async () => {
  for (const [id, date] of [["a", "2026-10-10T15:59:59Z"], ["b", "2026-10-10T16:00:00Z"]]) await Settlement.create({ shopId: "shop", statementId: id, settlementDate: new Date(date), netSettlementMinor: "10", calculatedProfitMinor: "3", reconciliationStatus: "reconciled" });
  const result = await callFinance(financeController.dailyProfit, { from: "2026-10-10", to: "2026-10-11" });
  assert.deepEqual(result.days.map(row => row.date), ["2026-10-10", "2026-10-11"]);
  assert.equal(result.days[0].profit, 0.03);
});

test("invalid controller and queued sync dates are rejected rather than normalized", async () => {
  for (const from of ["bad", "2026-02-29", "2026-04-31", ""]) {
    await assert.rejects(callFinance(financeController.overview, { from, to: "2026-10-31" }), error => error.statusCode === 400);
    let failure;
    await queueSync("settlements")({ body: { from, to: "2026-10-31" } }, { status: () => { throw new Error("invalid input accepted"); } }, error => { failure = error; });
    assert.equal(failure.statusCode, 400);
  }
  assert.equal(await Job.countDocuments(), 0);
});

test("currency matching never links a PHP earning to a USD statement", async () => {
  await Earning.create({ shopId: "shop", transactionId: "php", type: "SETTLE", amountMinor: "8000", originalAmount: "80", currency: "PHP", transactionDate: new Date() });
  await Settlement.create({ shopId: "shop", statementId: "usd", settlementDate: new Date(), currency: "USD", netSettlementMinor: "8000", calculatedProfitMinor: "6000", reconciliationStatus: "reconciled" });
  await reconcileTikTokEarnings({ shopId: "shop" }, new Date(0), new Date());
  assert.equal((await Earning.findOne()).linkedSettlementIds.length, 0);
  assert.equal((await financeOverview("2020-01-01", "2099-12-31")).netSettlement, 0);
});

test("statement pagination imports all pages and later adjustments without duplicates", async t => {
  let corrected = false;
  t.mock.method(globalThis, "fetch", async url => {
    const second = url.searchParams.get("page_token");
    return reply({ create_time: 1790000000, total_count: corrected ? 3 : 2, total_settlement_amount: corrected ? "7" : "10", transactions: second ? [{ id: "b", type: "ADJUSTMENT", settlement_amount: "4" }, ...(corrected ? [{ id: "c", type: "ADJUSTMENT", settlement_amount: "-3" }] : [])] : [{ id: "a", type: "ADJUSTMENT", settlement_amount: "6" }], next_page_token: second ? undefined : "second" });
  });
  await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map());
  assert.equal((await Settlement.findOne()).calculatedProfitMinor, "1000");
  corrected = true;
  await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map());
  await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map());
  assert.equal(await Settlement.countDocuments(), 1); assert.equal(await Transaction.countDocuments(), 3);
  assert.equal((await Settlement.findOne()).calculatedProfitMinor, "700");
});

test("interrupted correction clears stale confirmed statement and earning profit", async t => {
  const statement = await Settlement.create({ shopId: "shop", statementId: "st1", settlementDate: new Date(), netSettlementMinor: "1000", calculatedProfitMinor: "1000", reconciliationStatus: "reconciled" });
  await Earning.create({ shopId: "shop", transactionId: "e1", type: "SETTLE", amountMinor: "1000", originalAmount: "10", currency: "PHP", transactionDate: new Date(), reconciliationStatus: "reconciled", linkedSettlementIds: [statement._id], profitMinor: "1000" });
  t.mock.method(globalThis, "fetch", async url => {
    if (url.searchParams.get("page_token")) throw new Error("timeout");
    return reply({ transactions: [{ id: "a", type: "ADJUSTMENT", settlement_amount: "9" }], next_page_token: "next" });
  });
  await assert.rejects(importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map()), /could not be reached/);
  assert.equal((await Settlement.findOne()).calculatedProfitMinor, undefined);
  assert.equal((await Earning.findOne()).profitMinor, undefined);
  assert.equal((await Settlement.findOne()).reconciliationStatus, "awaiting_reconciliation");
});

test("missing advertised statement rows cannot be marked reconciled", async t => {
  t.mock.method(globalThis, "fetch", async () => reply({ create_time: 1790000000, total_count: 2, transactions: [{ id: "a", type: "ADJUSTMENT", settlement_amount: "1" }] }));
  await assert.rejects(importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map()), /incomplete statement/);
  assert.equal(await Settlement.countDocuments(), 0);
});

test("multiple order transactions cannot reuse the same SKU capital allocation", async t => {
  await Order.create(cachedOrder());
  financeApi(t, { transactions: [financeRow(), { ...financeRow(), id: "tx2", revenue_amount: "-10", settlement_amount: "0" }] });
  await syncTikTokSettlements();
  const rows = await Transaction.find().lean();
  assert.ok(rows.every(row => !row.capitalCostKnown && row.profitMinor == null));
  assert.equal((await Settlement.findOne()).reconciliationStatus, "awaiting_reconciliation");
  assert.equal((await Settlement.findOne()).calculatedProfitMinor, undefined);
});

test("corrected-away transactions stay stored but leave current details and totals", async t => {
  let corrected = false;
  t.mock.method(globalThis, "fetch", async () => reply({ create_time: 1790000000, total_count: corrected ? 1 : 2, total_settlement_amount: corrected ? "6" : "10", transactions: [{ id: "a", type: "ADJUSTMENT", settlement_amount: "6" }, ...(corrected ? [] : [{ id: "b", type: "ADJUSTMENT", settlement_amount: "4" }])] }));
  await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map());
  corrected = true;
  await importStatement({ shopId: "shop", shopCipher: "cipher" }, "st1", new Map());
  const statement = await Settlement.findOne();
  const detail = await callFinance(financeController.settlementDetail, {}, { id: String(statement._id) });
  assert.equal(statement.netSettlementMinor, "600"); assert.equal(detail.transactions.length, 1);
  assert.equal(await Transaction.countDocuments(), 2); assert.equal((await Transaction.findOne({ transactionId: "b" })).isCurrent, false);
});

test("TikTok dashboard ignores historical manual sales and matches finance overview", async t => {
  const historical = await LegacySale.collection.insertOne({ date: new Date("2026-10-10"), totalSales: 999999, profit: 999999, netSales: 999999 });
  t.mock.method(LegacySale, "aggregate", () => { throw new Error("Legacy sales must never be read by the dashboard"); });
  await Settlement.create({ shopId: "shop", statementId: "confirmed", settlementDate: new Date("2026-10-10"), netSettlementMinor: "8000", calculatedProfitMinor: "6000", reconciliationStatus: "reconciled" });
  await Settlement.create({ shopId: "shop", statementId: "pending", settlementDate: new Date("2026-10-11"), netSettlementMinor: "12000", calculatedProfitMinor: "9999", reconciliationStatus: "awaiting_reconciliation" });
  await Settlement.create({ shopId: "other", statementId: "foreign", settlementDate: new Date("2026-10-10"), netSettlementMinor: "999999", calculatedProfitMinor: "999999", reconciliationStatus: "reconciled" });
  await Order.create(cachedOrder({ createdAtTikTok: new Date("2026-10-10"), status: "AWAITING_SHIPMENT" }));
  await Order.create(cachedOrder({ shopId: "other", createdAtTikTok: new Date("2026-10-10") }));
  const dashboard = await callFinance(getDashboard, { startDate: "2026-10-01", endDate: "2026-10-31" });
  const report = await financeOverview("2026-10-01", "2026-10-31");
  assert.equal(dashboard.kpis.revenue.value, report.netSettlement);
  assert.equal(dashboard.kpis.profit.value, report.netProfit);
  assert.equal(dashboard.kpis.margin.value, report.profitMargin);
  assert.equal(dashboard.kpis.profit.value, 60); assert.equal(dashboard.kpis.orders.value, 1);
  assert.equal(dashboard.channels, undefined); assert.equal(dashboard.summary, undefined);
  assert.ok(dashboard.recentTransactions.every(row => row.channel === "TikTok"));
  assert.ok(dashboard.trend.every(row => !Object.hasOwn(row, "manualRevenue")));
  assert.equal((await LegacySale.collection.findOne({ _id: historical.insertedId })).profit, 999999);
});

test("unsettled TikTok orders never become dashboard profit", async () => {
  await Order.create(cachedOrder({ createdAtTikTok: new Date("2026-10-10"), totalAmount: "10000", status: "AWAITING_SHIPMENT" }));
  const result = await callFinance(getDashboard, { startDate: "2026-10-01", endDate: "2026-10-31" });
  assert.equal(result.kpis.orders.value, 1); assert.equal(result.kpis.profit.value, 0);
  assert.equal(result.kpis.revenue.value, 0); assert.equal(result.kpis.margin.value, null);
});

test("TikTok listing costs work without a legacy product mapping", async () => {
  await Mapping.create({ shopId: "shop", tiktokProductId: "p1", tiktokSkuId: "s1", title: "Fixture", capitalCostMinor: "1255", currency: "PHP", rjeProductId: new mongoose.Types.ObjectId() });
  const result = await callFinance(listTikTokProducts);
  assert.equal(result.products.length, 1); assert.equal(result.products[0].capitalCost, 12.55);
});

test("TikTok order details preserve snapshots without querying the retired catalog", async () => {
  const line = cachedOrder().lines[0];
  await Order.create(cachedOrder({ lines: [{ ...line, rjeProductId: new mongoose.Types.ObjectId() }] }));
  const result = await callFinance(getOrder, {}, { orderId: "o1" });
  assert.equal(result.orderId, "o1"); assert.equal(result.lines[0].capitalCostMinorSnapshot, "1000");
});

test("catalog variant search, status filters and numeric sorts apply before pagination", async () => {
  await Mapping.insertMany(Array.from({ length: 12 }, (_, i) => ({ shopId: "shop", tiktokProductId: `p${i}`, tiktokSkuId: `s${i}`, title: `Listing ${String(i).padStart(2, "0")}`, sellerSku: `SKU-${i}`, currency: "PHP", price: String(i + 1), stock: i, status: i === 10 ? "DEACTIVATE" : "ACTIVATE", capitalCostMinor: i === 11 ? null : String(i * 100), variations: [{ name: "Color", value: i === 9 ? "Unique red" : "Blue" }] })));
  assert.equal((await callFinance(listTikTokProducts, { search: "unique RED" })).products[0].tiktokSkuId, "s9");
  assert.equal((await callFinance(listTikTokProducts, { search: "SKU-10" })).total, 1);
  assert.equal((await callFinance(listTikTokProducts, { search: ".*" })).total, 0);
  assert.equal((await callFinance(listTikTokProducts, { filter: "inactive" })).total, 1);
  assert.equal((await callFinance(listTikTokProducts, { filter: "out_of_stock" })).products[0].stock, 0);
  assert.equal((await callFinance(listTikTokProducts, { filter: "active" })).total, 10);
  assert.equal((await callFinance(listTikTokProducts, { filter: "missing_cost" })).total, 1);
  const first = await callFinance(listTikTokProducts, { sort: "price_desc", pageSize: "10", page: "1" });
  const second = await callFinance(listTikTokProducts, { sort: "price_desc", pageSize: "10", page: "2" });
  assert.equal(first.products[0].price, "12"); assert.equal(second.products[0].price, "2");
  assert.equal(first.total, 12); assert.equal(first.pages, 2);
  assert.equal((await callFinance(listTikTokProducts, { sort: "capital_desc" })).products.at(-1).capitalCost, null);
  assert.equal((await callFinance(listTikTokProducts, { page: "99", pageSize: "10" })).page, 2);
});

test("catalog profitable and margin sorting use confirmed historical data across pages", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ shopId: "shop", tiktokProductId: `p${i}`, tiktokSkuId: `s${i}`, title: `Variant ${i}`, status: "ACTIVATE", currency: "PHP", price: "9999", stock: 10, capitalCostMinor: "999999" }));
  await Mapping.insertMany(rows);
  await Settlement.create({ shopId: "shop", statementId: "confirmed", settlementDate: new Date(), reconciliationStatus: "reconciled" });
  for (let i = 0; i < 11; i++) {
    await Order.create(cachedOrder({ orderId: `o${i}`, lines: [{ productId: `p${i}`, skuId: `s${i}`, quantity: 2, capitalCostMinorSnapshot: "100" }] }));
    await Transaction.create({ shopId: "shop", statementId: "confirmed", transactionId: `t${i}`, tiktokOrderId: `o${i}`, transactionType: "ORDER", currency: "PHP", revenueMinor: "10000", settlementMinor: "1000", profitMinor: i === 0 ? "-100" : String(i * 50), reconciliationStatus: "reconciled" });
  }
  const profitable = await callFinance(listTikTokProducts, { filter: "profitable", sort: "margin_desc", pageSize: "10" });
  assert.equal(profitable.total, 10); assert.equal(profitable.products[0].tiktokSkuId, "s10");
  assert.equal(profitable.products[0].averageSettlementProfit, 2.5);
  assert.equal(profitable.products[0].capitalCost, 9999.99);
  const loss = await callFinance(listTikTokProducts, { filter: "unprofitable" });
  assert.equal(loss.total, 1); assert.equal(loss.products[0].tiktokSkuId, "s0");
  const sorted = await callFinance(listTikTokProducts, { sort: "margin_desc", pageSize: "10", page: "2" });
  assert.equal(sorted.total, 12); assert.equal(sorted.products.at(-1).settlementProfitMargin, null);
});

test("a lease-waiting job scheduled far ahead rechecks an early-released lease", async () => {
  await enqueueSync("settlements");
  await Job.collection.updateOne({}, { $set: { stage: "Waiting for previous sync lease", nextAttemptAt: new Date(Date.now() + 30 * 60000), updatedAt: new Date(Date.now() - 60000) } });
  await runNextSyncJob({ run: async () => ({ resumed: true }) });
  assert.equal((await Job.findOne()).status, "completed");
});

test("job heartbeat ownership loss cannot publish a completed synchronization", async t => {
  await enqueueSync("settlements"); let heartbeat;
  t.mock.method(globalThis, "setInterval", callback => { heartbeat = callback; return { unref() {} }; });
  t.mock.method(globalThis, "clearInterval", () => {});
  const updateOne = Job.updateOne.bind(Job);
  t.mock.method(Job, "updateOne", (filter, update) => update.$set?.leaseUntil && !update.$set?.stage ? Promise.resolve({ matchedCount: 0 }) : updateOne(filter, update));
  await runNextSyncJob({ run: async () => { await heartbeat(); return { fixture: true }; } });
  const job = await Job.findOne(); assert.equal(job.status, "pending"); assert.match(job.errorMessage, /lease was lost/);
});
