import crypto from "node:crypto";
import { syncWindow, lowerTimeFilter, nextSyncToken, distinctBy, ownedFieldsChanged, syncBulkWrite } from "./syncDataService.js";
import { cachedFinance, financeCacheTtl, invalidateFinanceCache } from "./financeCacheService.js";
import { reportSync, countSync } from "./syncTelemetry.js";
import { forEachBatch } from "./batchService.js";
import TikTokShop from "../models/TikTokShop.js";
import TikTokOrder from "../models/TikTokOrder.js";
import TikTokSettlement from "../models/TikTokSettlement.js";
import FinanceTransaction from "../models/TikTokFinanceTransaction.js";
import FinanceSyncLog from "../models/TikTokFinanceSyncLog.js";
import TikTokEarning from "../models/TikTokEarning.js";
import { failure, tiktokRequest } from "./tiktokApiService.js";
import { fromMinor, minorString, toMinor } from "./money.js";

const nullableUpdate = row => {
  const set = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  const unset = Object.fromEntries(Object.entries(row).filter(([, value]) => value === undefined).map(([key]) => [key, 1]));
  return { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) };
};

const FINANCE_SCOPE = "seller.finance.info";
const financeMinor = (value, field, required = false) => {
  if (value == null && !required) return 0n;
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(value ?? ""))) throw failure(`TikTok returned an invalid ${field} amount.`, 502);
  return toMinor(value);
};
const taxTotal = value => value && typeof value === "object" ? Object.values(value).reduce((sum, child) => sum + taxTotal(child), 0n) : financeMinor(value, "tax");
const at = value => value ? new Date(Number(value) * 1000) : null;
const directFeeTotal = fee => Object.entries(fee || {}).reduce((sum, [key, value]) => {
  if (key.includes("before_pit") || value == null || typeof value === "object") return sum;
  return sum + financeMinor(value, key);
}, 0n);
const signedCost = (order, finance, statementId, revenue) => {
  if (revenue === 0n) return { known: true, minor: 0n };
  if (!order) return { known: false, minor: 0n };
  const skuRows = (finance?.sku_transactions || []).filter(row => String(row.statement_id || "") === statementId);
  if (!skuRows.length) return { known: false, minor: 0n };
  let total = 0n;
  for (const sku of skuRows) {
    const skuRevenue = sku.revenue_amount == null ? revenue : financeMinor(sku.revenue_amount, "SKU revenue");
    if (skuRevenue === 0n) continue;
    const lines = order.lines.filter(item => String(item.skuId) === String(sku.sku_id));
    const line = lines[0];
    const returnedQuantity = Number(sku.return_quantity || sku.returned_quantity || 0);
    const explicitlyReturned = returnedQuantity > 0 || sku.goods_returned === true || ["RETURNED", "RETURN_COMPLETED"].includes(String(sku.return_status || "").toUpperCase());
    // Refunds without evidence of returned goods do not recover product capital.
    if (skuRevenue < 0n && !explicitlyReturned) continue;
    const costs = lines.map(item => item.capitalCostMinorSnapshot == null ? (item.capitalCostSnapshot == null ? null : toMinor(item.capitalCostSnapshot)) : BigInt(item.capitalCostMinorSnapshot));
    const unitCost = costs[0];
    if (!line || costs.some(cost => cost == null || cost < 0n)) return { known: false, minor: 0n };
    const quantity = skuRevenue < 0n ? Number(sku.return_quantity ?? sku.returned_quantity ?? sku.quantity ?? 1) : Number(sku.quantity ?? line.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return { known: false, minor: 0n };
    if (costs.some(cost => cost !== unitCost)) {
      // Different historical costs can be allocated only for the complete SKU quantity.
      const quantities = lines.map(item => Number(item.quantity ?? 1));
      if (quantities.some(value => !Number.isSafeInteger(value) || value < 0) || quantities.reduce((sum, value) => sum + value, 0) !== quantity) return { known: false, minor: 0n };
      total += (skuRevenue < 0n ? -1n : 1n) * costs.reduce((sum, cost, index) => sum + cost * BigInt(quantities[index]), 0n);
      continue;
    }
    total += (skuRevenue < 0n ? -1n : 1n) * unitCost * BigInt(Math.trunc(quantity));
  }
  return { known: true, minor: total };
};

export function normalizeFinanceTransaction(row, { shopId, statementId, statementDate, currency, order, orderFinance }) {
  const revenue = financeMinor(row.revenue_amount, "revenue", row.type === "ORDER"); const settlement = financeMinor(row.settlement_amount, "settlement", true);
  const tax = taxTotal(row.fee_tax_breakdown?.tax);
  const fee = row.fee_tax_amount == null ? directFeeTotal(row.fee_tax_breakdown?.fee) : financeMinor(row.fee_tax_amount, "fee/tax") - tax;
  const capital = row.type === "ORDER" ? signedCost(order, orderFinance, statementId, revenue) : { known: true, minor: 0n };
  const status = row.type === "ORDER" && !order ? "awaiting_order" : !capital.known ? "awaiting_cost" : "reconciled";
  return {
    shopId, transactionId: String(row.id), statementId, isCurrent: true, tiktokOrderId: row.order_id ? String(row.order_id) : undefined, transactionType: row.type,
    transactionDate: statementDate, orderDate: at(row.order_create_time), statementDate, currency,
    revenueMinor: minorString(revenue), feeMinor: minorString(fee), taxMinor: minorString(tax), shippingMinor: minorString(financeMinor(row.shipping_cost_amount, "shipping")),
    refundMinor: minorString(revenue < 0n ? -revenue : 0n), adjustmentMinor: minorString(financeMinor(row.adjustment_amount, "adjustment")), settlementMinor: minorString(settlement),
    capitalCostMinor: capital.known ? minorString(capital.minor) : undefined, profitMinor: capital.known ? minorString(settlement - capital.minor) : undefined,
    capitalCostKnown: capital.known, reconciliationStatus: status, linkedOrderId: order?._id,
    feeBreakdown: row.fee_tax_breakdown?.fee || {}, taxBreakdown: row.fee_tax_breakdown?.tax || {},
    revenueBreakdown: row.revenue_breakdown || {}, shippingBreakdown: row.shipping_cost_breakdown || {}, supplementaryAmounts: row.supplementary_component || {},
    originalAmounts: { revenue: row.revenue_amount, feeTax: row.fee_tax_amount, shipping: row.shipping_cost_amount, adjustment: row.adjustment_amount, settlement: row.settlement_amount }, lastSyncedAt: new Date(),
  };
}
export const normalizeEarning = (row, shopId) => ({
  shopId, transactionId: String(row.id), type: row.type, status: row.status,
  amountMinor: minorString(financeMinor(row.amount, "earning", true)), originalAmount: String(row.amount), currency: row.currency || "PHP",
  transactionDate: at(row.create_time), lastSyncedAt: new Date(),
});

async function connectedShop() {
  const shop = await TikTokShop.findOne({ key: "singleton" }).select("+shopCipher");
  if (!shop?.shopId || !shop.shopCipher || shop.status !== "connected") throw failure("Connect TikTok Shop and refresh shop information first.", 409);
  if (!shop.scopes.includes(FINANCE_SCOPE)) throw failure("Finance Information permission is missing. Enable seller.finance.info and reauthorize the shop.", 403);
  return shop;
}
async function acquire(shop) {
  const owner = crypto.randomUUID();
  const locked = await TikTokShop.findOneAndUpdate({ _id: shop._id, $or: [{ settlementSyncLeaseUntil: { $lte: new Date() } }, { settlementSyncLeaseUntil: null }] }, { settlementSyncOwner: owner, settlementSyncLeaseUntil: new Date(Date.now() + 30 * 60_000) });
  if (!locked) throw failure("A finance synchronization is already running.", 409);
  return owner;
}
export async function importTikTokEarnings(shop, start, end) {
  let token; let imported = 0; const seen = new Set();
  do {
    const data = await tiktokRequest("/finance/202309/withdrawals", { query: { types: ["WITHDRAW", "SETTLE", "TRANSFER", "REVERSE"], page_size: 100, page_token: token, ...lowerTimeFilter("create_time_ge", start), create_time_lt: Math.floor(end.getTime() / 1000), shop_cipher: shop.shopCipher } });
    if (!Array.isArray(data.withdrawals)) throw failure("TikTok returned an invalid earnings page.");
    const rows = distinctBy(data.withdrawals.filter(row => row.id), row => String(row.id)).map(row => normalizeEarning(row, shop.shopId));
    const previous = await TikTokEarning.find({ shopId: shop.shopId, transactionId: { $in: rows.map(row => row.transactionId) } }).lean();
    const byId = new Map(previous.map(row => [row.transactionId, row]));
    await syncBulkWrite(TikTokEarning, rows.filter(row => ownedFieldsChanged(byId.get(row.transactionId), row)).map(row => ({ updateOne: { filter: { shopId: shop.shopId, transactionId: row.transactionId }, update: { $set: row }, upsert: true } })));
    imported += rows.length;
    token = nextSyncToken(data.next_page_token, seen);
  } while (token);
  return imported;
}
export async function reconcileTikTokEarnings(shop, start, end, refreshedSettlementIds = []) {
  let reconciled = 0;
  const processBatch = async earnings => {
    if (!earnings.length) return;
    const dates = earnings.map(row => new Date(row.transactionDate).getTime());
    const candidates = await TikTokSettlement.find({ shopId: shop.shopId, settlementDate: { $gte: new Date(Math.min(...dates) - 30 * 86400_000), $lte: new Date(Math.max(...dates) + 86400_000) }, netSettlementMinor: { $in: [...new Set(earnings.map(row => row.amountMinor))] } }).lean();
    const adjustmentCounts = await FinanceTransaction.aggregate([{ $match: { shopId: shop.shopId, statementId: { $in: candidates.map(row => row.statementId) }, isCurrent: { $ne: false }, transactionType: { $ne: "ORDER" } } }, { $group: { _id: "$statementId", count: { $sum: 1 } } }]);
    const adjustments = new Map(adjustmentCounts.map(row => [row._id, row.count])); const operations = [];
    for (const earning of earnings) {
      const date = new Date(earning.transactionDate).getTime();
      const matching = candidates.filter(row => (row.currency || "PHP") === (earning.currency || "PHP") && row.netSettlementMinor === earning.amountMinor && new Date(row.settlementDate).getTime() >= date - 30 * 86400_000 && new Date(row.settlementDate).getTime() <= date + 86400_000);
      let values;
      if (matching.length !== 1) values = { linkedSettlementIds: [], capitalCostMinor: undefined, profitMinor: undefined, orderCount: 0, adjustmentCount: 0, reconciliationStatus: matching.length > 1 ? "ambiguous" : "awaiting_transactions" };
      else {
        const statement = matching[0];
        const known = statement.reconciliationStatus === "reconciled" && statement.calculatedProfitMinor != null;
        values = { linkedSettlementIds: [statement._id], orderCount: statement.orderCount, adjustmentCount: adjustments.get(statement.statementId) || 0, capitalCostMinor: known ? statement.totalCapitalCostMinor : undefined, profitMinor: known ? statement.calculatedProfitMinor : undefined, reconciliationStatus: known ? "reconciled" : statement.reconciliationStatus === "amount_mismatch" ? "amount_mismatch" : "awaiting_cost" };
        if (known) reconciled++;
      }
      if (ownedFieldsChanged(earning, values)) operations.push({ updateOne: { filter: { shopId: shop.shopId, transactionId: earning.transactionId }, update: nullableUpdate(values) } });
    }
    await syncBulkWrite(TikTokEarning, operations);
  };
  const filter = { shopId: shop.shopId, type: "SETTLE", $or: [{ transactionDate: { $gte: start, $lte: end } }, { reconciliationStatus: { $ne: "reconciled" } }, ...(refreshedSettlementIds.length ? [{ linkedSettlementIds: { $in: refreshedSettlementIds } }] : [])] };
  let lastId;
  while (true) {
    const batch = await TikTokEarning.find({ ...filter, ...(lastId ? { _id: { $gt: lastId } } : {}) }).sort({ _id: 1 }).limit(100).lean();
    if (!batch.length) break;
    lastId = batch[batch.length - 1]._id;
    await processBatch(batch);
  }
  return reconciled;
}
export async function getOrderFinance(shop, order, statementId, financeByOrder, bypass = false) {
  financeByOrder.checkedOrders?.add(order.orderId);
  if (financeByOrder.has(order.orderId)) {
    const cached = await financeByOrder.get(order.orderId);
    if (cached?.sku_transactions?.some(row => String(row.statement_id) === statementId)) return cached;
    // A snapshot used by an earlier statement may predate a newly discovered one.
    financeByOrder.delete(order.orderId); bypass = true;
  }
  const path = `/finance/202501/orders/${encodeURIComponent(order.orderId)}/statement_transactions`;
  const query = { shop_cipher: shop.shopCipher };
  const age = order.financeSyncedAt ? Date.now() - new Date(order.financeSyncedAt).getTime() : Infinity;
  const fresh = age >= 0 && age < financeCacheTtl();
  const matches = order.finance?.sku_transactions?.some(row => String(row.statement_id) === statementId);
  const promise = (async () => {
    if (!bypass && fresh && matches) { countSync("cacheHits"); return order.finance; }
    const finance = await cachedFinance(shop.shopId, path, query, () => tiktokRequest(path, { query }), { bypass: bypass || !matches });
    if (!Array.isArray(finance.sku_transactions)) throw failure("TikTok returned incomplete order finance data.");
    financeByOrder.pendingWrites ||= new Map();
    financeByOrder.pendingWrites.set(order.orderId, { updateOne: { filter: { _id: order._id, shopId: shop.shopId }, update: { $set: { finance, financeSyncedAt: new Date() } } } });
    return finance;
  })();
  financeByOrder.set(order.orderId, promise);
  try { const finance = await promise; financeByOrder.set(order.orderId, finance); return finance; }
  catch (error) { financeByOrder.delete(order.orderId); throw error; }
}

export async function importStatement(shop, statementId, financeByOrder, { summary, bypass = false } = {}) {
  let token; let root; let statementDate; const imported = new Map(); const seen = new Set();
  const existing = await TikTokSettlement.findOne({ shopId: shop.shopId, statementId }).lean();
  do {
    const data = await tiktokRequest(`/finance/202501/statements/${encodeURIComponent(statementId)}/statement_transactions`, { query: { page_size: 100, page_token: token, sort_field: "order_create_time", sort_order: "ASC", shop_cipher: shop.shopCipher } });
    if (!Array.isArray(data.transactions)) throw failure("TikTok returned an invalid statement page.");
    if (data.transactions.some(row => !row.id)) throw failure("TikTok returned a statement transaction without an ID.");
    root ||= data;
    if (!token && existing) {
      // Partial corrections must never leave the old profit labelled confirmed.
      await TikTokSettlement.updateOne({ _id: existing._id }, { $set: { reconciliationStatus: "awaiting_reconciliation" }, $unset: { calculatedProfitMinor: 1, profitMarginBasisPoints: 1 } });
      await TikTokEarning.updateMany({ shopId: shop.shopId, linkedSettlementIds: existing._id }, { $set: { reconciliationStatus: "awaiting_cost" }, $unset: { capitalCostMinor: 1, profitMinor: 1 } });
    }
    if (!statementDate) {
      const valid = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
      statementDate = valid(at(summary?.statement_time)) || valid(at(root?.create_time)) || valid(existing?.settlementDate);
      if (!statementDate) {
        const previous = await FinanceTransaction.findOne({ shopId: shop.shopId, statementId, statementDate: { $ne: null } }).sort({ _id: 1 }).lean();
        statementDate = valid(previous?.statementDate);
      }
      if (!statementDate) {
        if (existing || await FinanceTransaction.exists({ shopId: shop.shopId, statementId })) throw failure(`Statement ${statementId} has no valid historical date.`, 409);
        statementDate = new Date();
        console.warn(`New TikTok statement ${statementId} has no date; using import time.`);
      }
    }
    const orderIds = [...new Set((data.transactions || []).map(row => String(row.order_id || "")).filter(Boolean))];
    const orders = await TikTokOrder.find({ shopId: shop.shopId, orderId: { $in: orderIds } }).lean(); const byOrder = new Map(orders.map(order => [order.orderId, order]));
    await forEachBatch(orders, 3, order => getOrderFinance(shop, order, statementId, financeByOrder, bypass));
    await syncBulkWrite(TikTokOrder, [...(financeByOrder.pendingWrites?.values() || [])]);
    financeByOrder.pendingWrites?.clear();
    const normalizedRows = [];
    for (const row of distinctBy(data.transactions, row => String(row.id))) {
      if (!row.id) continue;
      const normalized = normalizeFinanceTransaction(row, { shopId: shop.shopId, statementId, statementDate, currency: data.currency || "PHP", order: byOrder.get(String(row.order_id || "")), orderFinance: financeByOrder.get(String(row.order_id || "")) });
      normalizedRows.push(normalized); imported.set(normalized.transactionId, normalized);
    }
    const previous = await FinanceTransaction.find({ shopId: shop.shopId, transactionId: { $in: normalizedRows.map(row => row.transactionId) } }).lean();
    const byId = new Map(previous.map(row => [row.transactionId, row]));
    await syncBulkWrite(FinanceTransaction, normalizedRows.filter(row => ownedFieldsChanged(byId.get(row.transactionId), row)).map(row => ({ updateOne: { filter: { shopId: shop.shopId, transactionId: row.transactionId }, update: nullableUpdate(row), upsert: true } })));
    token = nextSyncToken(data.next_page_token, seen);
    if (financeByOrder.size > 1000) financeByOrder.clear();
  } while (token);
  if (root?.total_count != null && (!Number.isSafeInteger(Number(root.total_count)) || Number(root.total_count) !== imported.size)) throw failure("TikTok returned an incomplete statement transaction set.");
  const orderCounts = new Map();
  for (const row of imported.values()) if (row.transactionType === "ORDER") orderCounts.set(row.tiktokOrderId, (orderCounts.get(row.tiktokOrderId) || 0) + 1);
  const ambiguousCosts = [];
  for (const row of imported.values()) if (row.transactionType === "ORDER" && orderCounts.get(row.tiktokOrderId) > 1) {
    // SKU finance is keyed by statement, not transaction: reusing it would charge COGS twice.
    row.capitalCostKnown = false; row.capitalCostMinor = undefined; row.profitMinor = undefined;
    if (row.reconciliationStatus !== "awaiting_order") row.reconciliationStatus = "awaiting_cost";
    ambiguousCosts.push({ updateOne: { filter: { shopId: shop.shopId, transactionId: row.transactionId }, update: nullableUpdate({ capitalCostKnown: false, capitalCostMinor: undefined, profitMinor: undefined, reconciliationStatus: row.reconciliationStatus }) } });
  }
  await syncBulkWrite(FinanceTransaction, ambiguousCosts);
  const totals = [...imported.values()].reduce((acc, row) => { for (const key of ["revenueMinor", "feeMinor", "taxMinor", "refundMinor", "adjustmentMinor", "settlementMinor"]) acc[key] += BigInt(row[key] || 0); if (row.capitalCostKnown) acc.capital += BigInt(row.capitalCostMinor || 0); else { acc.unknown += BigInt(row.settlementMinor || 0); acc.unknownCount++; } if (row.tiktokOrderId) acc.orders.add(row.tiktokOrderId); return acc; }, { revenueMinor: 0n, feeMinor: 0n, taxMinor: 0n, refundMinor: 0n, adjustmentMinor: 0n, settlementMinor: 0n, capital: 0n, unknown: 0n, unknownCount: 0, orders: new Set() });
  const expected = financeMinor(root?.total_settlement_amount, "statement settlement"); const mismatch = root?.total_settlement_amount != null && expected !== totals.settlementMinor;
  // Retain corrected-away rows for audit without including them in current details or metrics.
  if (!mismatch) await FinanceTransaction.updateMany({ shopId: shop.shopId, statementId, transactionId: { $nin: [...imported.keys()] } }, { $set: { isCurrent: false } });
  const status = mismatch ? "amount_mismatch" : totals.unknownCount > 0 ? "awaiting_reconciliation" : "reconciled";
  const profit = status === "reconciled" ? totals.settlementMinor - totals.capital : null;
  await TikTokSettlement.findOneAndUpdate({ shopId: shop.shopId, statementId }, nullableUpdate({ settlementDate: statementDate, currency: root?.currency || "PHP", totalRevenueMinor: minorString(totals.revenueMinor), totalFeesMinor: minorString(totals.feeMinor), totalTaxesMinor: minorString(totals.taxMinor), totalRefundsMinor: minorString(totals.refundMinor), totalAdjustmentsMinor: minorString(totals.adjustmentMinor), netSettlementMinor: minorString(totals.settlementMinor), totalCapitalCostMinor: minorString(totals.capital), calculatedProfitMinor: profit == null ? undefined : minorString(profit), profitMarginBasisPoints: profit != null && totals.settlementMinor > 0n ? Number(profit * 10000n / totals.settlementMinor) : undefined, unreconciledAmountMinor: minorString(totals.unknown), orderCount: totals.orders.size, transactionCount: imported.size, reconciliationStatus: status, sourceTotals: { paymentStatus: summary?.payment_status || root?.status, totalSettlementAmount: root?.total_settlement_amount, payableAmount: root?.payable_amount, status: root?.status }, lastSyncedAt: new Date() }), { upsert: true });
  return { transactions: imported.size, reconciled: status === "reconciled" };
}

export async function syncTikTokSettlements({ from, to = new Date(), mode = "manual", forceFull = false } = {}) {
  const shop = await connectedShop();
  const periodicFull = !from && (!shop.lastFullFinanceSyncAt || Date.now() - new Date(shop.lastFullFinanceSyncAt).getTime() > Math.max(1, Number(process.env.TIKTOK_FINANCE_FULL_REFRESH_DAYS) || 7) * 86400_000);
  const { start, end, advance, full } = syncWindow({ checkpoint: shop.financeCheckpoint, from, to, forceFull: forceFull || periodicFull, overlap: Math.max(1, Number(process.env.TIKTOK_FINANCE_OVERLAP_DAYS) || 2) * 86400_000 });
  const owner = await acquire(shop);
  let leaseLost = false;
  const heartbeat=setInterval(()=>TikTokShop.updateOne({_id:shop._id,settlementSyncOwner:owner},{$set:{settlementSyncLeaseUntil:new Date(Date.now()+30*60_000)}}).then(result=>{if(result.matchedCount===0)leaseLost=true;}).catch(()=>{}),10*60_000); heartbeat.unref?.();
  let log;
  try {
    log = await FinanceSyncLog.create({ shopId: shop.shopId, mode, status: "running", rangeStart: start, rangeEnd: end });
    const pendingEarning = await TikTokEarning.findOne({ shopId: shop.shopId, status: { $nin: ["SUCCESS", "FAILED"] }, transactionDate: { $lt: start } }).sort({ transactionDate: 1 }).lean();
    const earnings = await importTikTokEarnings(shop, pendingEarning?.transactionDate || start, end);
    // An earning can arrive after its statement has fallen behind the checkpoint.
    // Retry discovery across the same lookback used by reconciliation, including
    // older unmatched earnings that ordinary incremental imports no longer fetch.
    const unmatchedEarning = await TikTokEarning.findOne({ shopId: shop.shopId, type: "SETTLE", reconciliationStatus: { $ne: "reconciled" }, transactionDate: { $lte: end } }).sort({ transactionDate: 1 }).lean();
    const discoveryStart = unmatchedEarning ? new Date(Math.max(0, Math.min(start.getTime(), new Date(unmatchedEarning.transactionDate).getTime() - 30 * 86400_000))) : start;
    // Discover statements directly, including adjustments with no local order.
    const statements = new Map(); let token; const seen = new Set(); let pages = 0;
    do {
      const page = await tiktokRequest("/finance/202309/statements", { query: { shop_cipher: shop.shopCipher, page_size: 100, page_token: token, sort_field: "statement_time", sort_order: "ASC", ...lowerTimeFilter("statement_time_ge", new Date(Math.max(0, discoveryStart.getTime() - 86400_000))) } });
      if (!Array.isArray(page.statements) || page.statements.some(row => !row.id)) throw failure("TikTok returned an invalid statement list.");
      // TikTok statement filters use generation-day boundaries that can exclude the current business day.
      // Fetch from one day earlier with no upper bound, then enforce exact returned statement dates locally.
      for (const row of page.statements) {
        const date = at(row.statement_time);
        if (!date || !Number.isFinite(date.getTime())) throw failure("TikTok returned a statement without a valid date.");
        if (date >= discoveryStart && date <= end) statements.set(String(row.id), row);
      }
      pages++; await reportSync({ stage: "Discovering finance statements", processed: 0, pages });
      token = nextSyncToken(page.next_page_token, seen);
    } while (token);
    const unresolved = await TikTokSettlement.find({ shopId: shop.shopId, $or: [{ reconciliationStatus: { $nin: forceFull ? ["reconciled"] : ["reconciled", "unmatchable"] } }, { "sourceTotals.paymentStatus": { $in: ["PROCESSING", "FAILED"] } }] }).select("statementId settlementDate sourceTotals").lean();
    const unresolvedIds = new Set(unresolved.map(row => row.statementId));
    for (const row of unresolved) if (!statements.has(row.statementId)) statements.set(row.statementId, { statement_time: Math.floor(new Date(row.settlementDate).getTime() / 1000), payment_status: row.sourceTotals?.paymentStatus });
    // Retry older incomplete transactions even when the parent statement was previously marked complete.
    const incomplete = await FinanceTransaction.distinct("statementId", { shopId: shop.shopId, isCurrent: { $ne: false }, reconciliationStatus: { $nin: forceFull ? ["reconciled"] : ["reconciled", "unmatchable"] } });
    for (const id of incomplete) { unresolvedIds.add(id); if (!statements.has(id)) statements.set(id, undefined); }
    const financeByOrder = new Map(); financeByOrder.checkedOrders = new Set(); let transactions = 0; let reconciled = 0; let processed = 0;
    // A newly imported order makes its formerly missing finance data retryable.
    const missingRows = await FinanceTransaction.find({ shopId: shop.shopId, isCurrent: { $ne: false }, reconciliationStatus: { $in: ["awaiting_order", "unmatchable"] } }).select("statementId tiktokOrderId").lean();
    const arrived = new Set(await TikTokOrder.distinct("orderId", { shopId: shop.shopId, orderId: { $in: missingRows.map(row => row.tiktokOrderId).filter(Boolean) } }));
    const resetIds = new Set(missingRows.filter(row => arrived.has(row.tiktokOrderId)).map(row => row.statementId));
    if (forceFull) for (const id of statements.keys()) resetIds.add(id);
    for (const id of resetIds) {
      if (leaseLost) throw failure("Synchronization lease was lost.", 409);
      await FinanceTransaction.updateMany({ shopId: shop.shopId, statementId: id, reconciliationStatus: { $in: ["awaiting_order", "unmatchable"] } }, { $set: { reconciliationStatus: "awaiting_order", retryCount: 0, lastRetriedAt: null } });
      await TikTokSettlement.updateOne({ shopId: shop.shopId, statementId: id }, { $set: { reconciliationStatus: "awaiting_reconciliation", retryCount: 0, lastRetriedAt: null } });
      if (!statements.has(id)) statements.set(id, undefined);
      unresolvedIds.add(id);
    }
    const configuredRetries = Number(process.env.TIKTOK_FINANCE_MAX_RETRIES);
    const maxRetries = Number.isFinite(configuredRetries) && configuredRetries >= 1 ? Math.trunc(configuredRetries) : 10;
    for (const [id, summary] of statements) {
      if (leaseLost) throw failure("Synchronization lease was lost.", 409);
      const retry = await TikTokSettlement.findOne({ shopId: shop.shopId, statementId: id }).lean();
      const retryDelay = Math.min(86400_000, 60000 * 2 ** Math.min((retry?.retryCount || 1) - 1, 11));
      if (!forceFull && !resetIds.has(id) && (retry?.reconciliationStatus === "unmatchable" || (retry?.retryCount > 0 && retry.lastRetriedAt && Date.now() - new Date(retry.lastRetriedAt).getTime() < retryDelay))) continue;
      const result = await importStatement(shop, id, financeByOrder, { summary, bypass: forceFull || unresolvedIds.has(id) });
      if (leaseLost) throw failure("Synchronization lease was lost.", 409);
      const missingOrders = await FinanceTransaction.exists({ shopId: shop.shopId, statementId: id, isCurrent: { $ne: false }, reconciliationStatus: "awaiting_order" });
      const retryCount = missingOrders ? (retry?.retryCount || 0) + 1 : 0;
      const lastRetriedAt = missingOrders ? new Date() : null;
      await TikTokSettlement.updateOne({ shopId: shop.shopId, statementId: id }, { $set: { retryCount, lastRetriedAt, ...(retryCount >= maxRetries ? { reconciliationStatus: "unmatchable" } : {}) } });
      await FinanceTransaction.updateMany({ shopId: shop.shopId, statementId: id }, { $set: { retryCount: 0, lastRetriedAt: null } });
      await FinanceTransaction.updateMany({ shopId: shop.shopId, statementId: id, reconciliationStatus: "awaiting_order" }, { $set: { retryCount, lastRetriedAt, ...(retryCount >= maxRetries ? { reconciliationStatus: "unmatchable" } : {}) } });
      transactions += result.transactions; if (result.reconciled) reconciled++;
      processed++; await reportSync({ stage: "Reconciling statements", processed, recordsProcessed: transactions, total: statements.size, pages });
    }
    if (leaseLost) throw failure("Synchronization lease was lost.", 409);
    // Refresh linked earnings even when they were reconciled earlier and lie outside this date range.
    const refreshedSettlementIds = statements.size ? await TikTokSettlement.distinct("_id", { shopId: shop.shopId, statementId: { $in: [...statements.keys()] } }) : [];
    const reconciledEarnings = await reconcileTikTokEarnings(shop, start, end, refreshedSettlementIds);
    Object.assign(log, { status: "completed", ordersChecked: financeByOrder.checkedOrders.size, statementsFound: statements.size, transactionsImported: transactions, reconciledStatements: reconciled, completedAt: new Date() }); await log.save();
    const checkpointUpdate = await TikTokShop.updateOne({ _id: shop._id, settlementSyncOwner: owner }, { $max: { lastSettlementSyncAt: new Date(), ...(advance ? { financeCheckpoint: end } : {}), ...(full ? { lastFullFinanceSyncAt: end } : {}) } });
    if (checkpointUpdate.matchedCount !== 1) throw failure("Synchronization lease was lost before saving its checkpoint. Retry safely.", 409);
    invalidateFinanceCache(shop.shopId);
    return { earnings, reconciledEarnings, orders: financeByOrder.checkedOrders.size, statements: statements.size, transactions, reconciled, synchronizedAt: end, inventoryChanged: false };
  } catch (error) { if (log) { log.status = "failed"; log.errorMessage = error.message; log.completedAt = new Date(); try { await log.save(); } catch (saveError) { console.warn(`Could not save finance sync failure: ${saveError.message}`); } } throw error; }
  finally { clearInterval(heartbeat); await TikTokShop.updateOne({ _id: shop._id, settlementSyncOwner: owner }, { $unset: { settlementSyncLeaseUntil: 1, settlementSyncOwner: 1 } }); }
}

const SHOP_TZ_OFFSET = "+08:00";
const rangeFilter = (from, to) => {
  const valid = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw failure("Invalid finance date range. Use real YYYY-MM-DD dates with from <= to.", 400);
  return { $gte: new Date(from + "T00:00:00" + SHOP_TZ_OFFSET), $lte: new Date(to + "T23:59:59.999" + SHOP_TZ_OFFSET) };
};
const publicSettlement = row => ({ ...row, totalRevenue: fromMinor(row.totalRevenueMinor), totalFees: fromMinor(row.totalFeesMinor), totalTaxes: fromMinor(row.totalTaxesMinor), totalRefunds: fromMinor(row.totalRefundsMinor), totalAdjustments: fromMinor(row.totalAdjustmentsMinor), netSettlement: fromMinor(row.netSettlementMinor), totalCapitalCost: fromMinor(row.totalCapitalCostMinor), calculatedProfit: row.calculatedProfitMinor == null ? null : fromMinor(row.calculatedProfitMinor), profitMargin: row.profitMarginBasisPoints == null ? null : row.profitMarginBasisPoints / 100, unreconciledAmount: fromMinor(row.unreconciledAmountMinor) });
export async function financeOverview(from, to) { rangeFilter(from, to); const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); const rows = shop?.shopId ? await TikTokSettlement.find({ shopId: shop.shopId, currency: "PHP", settlementDate: rangeFilter(from, to) }).lean() : []; const confirmed = rows.filter(row => row.reconciliationStatus === "reconciled"); const confirmedNet = confirmed.reduce((sum, row) => sum + BigInt(row.netSettlementMinor || 0), 0n); const confirmedProfit = confirmed.reduce((sum, row) => sum + BigInt(row.calculatedProfitMinor || 0), 0n); const fields = ["totalRevenueMinor", "totalFeesMinor", "totalTaxesMinor", "netSettlementMinor", "totalCapitalCostMinor", "calculatedProfitMinor", "unreconciledAmountMinor"]; const sums = Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + BigInt(row[field] || 0), 0n)])); return { grossRevenue: fromMinor(sums.totalRevenueMinor), fees: fromMinor(sums.totalFeesMinor), taxes: fromMinor(sums.totalTaxesMinor), netSettlement: fromMinor(sums.netSettlementMinor), capitalCost: fromMinor(sums.totalCapitalCostMinor), netProfit: fromMinor(confirmedProfit), unreconciledAmount: fromMinor(sums.unreconciledAmountMinor), profitMargin: confirmedNet > 0n ? Number(confirmedProfit * 10000n / confirmedNet) / 100 : null, statementCount: rows.length, reconciledNetSettlement: fromMinor(confirmedNet), reconciledStatementCount: confirmed.length }; }
export async function listFinanceSettlements(from, to) { rangeFilter(from, to); const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); return shop?.shopId ? (await TikTokSettlement.find({ shopId: shop.shopId, currency: "PHP", settlementDate: rangeFilter(from, to) }).sort({ settlementDate: -1 }).lean()).map(publicSettlement) : []; }
export const publicEarning = row => ({ ...row, amount: fromMinor(row.amountMinor), capitalCost: row.capitalCostMinor == null ? null : fromMinor(row.capitalCostMinor), profit: row.profitMinor == null ? null : fromMinor(row.profitMinor), displayType: row.type === "SETTLE" ? "Order settlement" : row.type === "WITHDRAW" ? "Withdrawal" : row.type === "TRANSFER" ? "Platform transfer" : "Withdrawal reversal" });
export async function listTikTokEarnings(from, to) { rangeFilter(from, to); const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); if (!shop?.shopId) return []; return (await TikTokEarning.find({ shopId: shop.shopId, currency: "PHP", transactionDate: rangeFilter(from, to) }).sort({ transactionDate: -1, transactionId: 1 }).lean()).map(publicEarning); }
export { publicSettlement };

let timer; export function startTikTokSettlementScheduler() { if (String(process.env.TIKTOK_SETTLEMENT_SYNC_ENABLED || "true").toLowerCase() !== "true" || timer) return; const run=()=>import("./tiktokSyncJobService.js").then(({ enqueueSync })=>enqueueSync("settlements",{},"scheduled")).catch(error=>{if(![401,403,409].includes(error.statusCode))console.error(`TikTok finance sync failed: ${error.message}`);}); timer=setInterval(run,Math.max(1,Number(process.env.TIKTOK_SETTLEMENT_SYNC_INTERVAL_HOURS)||1)*3600_000); timer.unref?.(); const startup=setTimeout(run,45_000); startup.unref?.(); }
