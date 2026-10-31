import crypto from "node:crypto";
import TikTokShop from "../models/TikTokShop.js";
import TikTokOrder from "../models/TikTokOrder.js";
import TikTokSettlement from "../models/TikTokSettlement.js";
import FinanceTransaction from "../models/TikTokFinanceTransaction.js";
import FinanceSyncLog from "../models/TikTokFinanceSyncLog.js";
import TikTokEarning from "../models/TikTokEarning.js";
import { failure, tiktokRequest } from "./tiktokApiService.js";
import { fromMinor, minorString, sumMinorLeaves, toMinor } from "./money.js";

const FINANCE_SCOPE = "seller.finance.info";
const at = value => value ? new Date(Number(value) * 1000) : null;
const directFeeTotal = fee => Object.entries(fee || {}).reduce((sum, [key, value]) => {
  if (key.includes("before_pit") || value == null || typeof value === "object") return sum;
  return sum + toMinor(value);
}, 0n);
const signedCost = (order, finance, statementId, revenue) => {
  if (revenue === 0n) return { known: true, minor: 0n };
  if (!order) return { known: false, minor: 0n };
  const skuRows = (finance?.sku_transactions || []).filter(row => String(row.statement_id || "") === statementId);
  if (!skuRows.length) return { known: false, minor: 0n };
  let total = 0n;
  for (const sku of skuRows) {
    const line = order.lines.find(item => String(item.skuId) === String(sku.sku_id));
    const returnedQuantity = Number(sku.return_quantity || sku.returned_quantity || 0);
    const explicitlyReturned = returnedQuantity > 0 || sku.goods_returned === true || ["RETURNED", "RETURN_COMPLETED"].includes(String(sku.return_status || "").toUpperCase());
    if (revenue < 0n && !explicitlyReturned) continue;
    const unitCost = line?.capitalCostMinorSnapshot == null ? (line?.capitalCostSnapshot == null ? null : toMinor(line.capitalCostSnapshot)) : BigInt(line.capitalCostMinorSnapshot);
    if (!line || unitCost == null) return { known: false, minor: 0n };
    const quantity = revenue < 0n ? (returnedQuantity || Number(sku.quantity) || 1) : (Number(sku.quantity) || Number(line.quantity) || 1);
    total += unitCost * BigInt(quantity);
  }
  return { known: true, minor: revenue < 0n ? -total : revenue > 0n ? total : 0n };
};

export function normalizeFinanceTransaction(row, { shopId, statementId, statementDate, currency, order, orderFinance }) {
  const revenue = toMinor(row.revenue_amount); const settlement = toMinor(row.settlement_amount);
  const tax = sumMinorLeaves(row.fee_tax_breakdown?.tax);
  const fee = row.fee_tax_amount == null ? directFeeTotal(row.fee_tax_breakdown?.fee) : toMinor(row.fee_tax_amount) - tax;
  const capital = row.type === "ORDER" ? signedCost(order, orderFinance, statementId, revenue) : { known: true, minor: 0n };
  const status = !order && row.order_id ? "awaiting_order" : !capital.known ? "awaiting_cost" : "reconciled";
  return {
    shopId, transactionId: String(row.id), statementId, tiktokOrderId: row.order_id ? String(row.order_id) : undefined, transactionType: row.type,
    transactionDate: statementDate, orderDate: at(row.order_create_time), statementDate, currency,
    revenueMinor: minorString(revenue), feeMinor: minorString(fee), taxMinor: minorString(tax), shippingMinor: minorString(toMinor(row.shipping_cost_amount)),
    refundMinor: minorString(revenue < 0n ? -revenue : 0n), adjustmentMinor: minorString(toMinor(row.adjustment_amount)), settlementMinor: minorString(settlement),
    capitalCostMinor: capital.known ? minorString(capital.minor) : undefined, profitMinor: capital.known ? minorString(settlement - capital.minor) : undefined,
    capitalCostKnown: capital.known, reconciliationStatus: status, linkedOrderId: order?._id,
    feeBreakdown: row.fee_tax_breakdown?.fee || {}, taxBreakdown: row.fee_tax_breakdown?.tax || {},
    originalAmounts: { revenue: row.revenue_amount, feeTax: row.fee_tax_amount, shipping: row.shipping_cost_amount, adjustment: row.adjustment_amount, settlement: row.settlement_amount }, lastSyncedAt: new Date(),
  };
}
export const normalizeEarning = (row, shopId) => ({
  shopId, transactionId: String(row.id), type: row.type, status: row.status,
  amountMinor: minorString(toMinor(row.amount)), originalAmount: String(row.amount), currency: row.currency || "PHP",
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
  let token; let imported = 0;
  do {
    const data = await tiktokRequest("/finance/202309/withdrawals", { query: { types: ["WITHDRAW", "SETTLE", "TRANSFER", "REVERSE"], page_size: 100, page_token: token, create_time_ge: Math.floor(start.getTime() / 1000), create_time_lt: Math.floor(end.getTime() / 1000), shop_cipher: shop.shopCipher } });
    for (const row of data.withdrawals || []) {
      if (!row.id) continue;
      const normalized = normalizeEarning(row, shop.shopId);
      await TikTokEarning.findOneAndUpdate({ shopId: shop.shopId, transactionId: normalized.transactionId }, { $set: normalized }, { upsert: true });
      imported++;
    }
    token = data.next_page_token;
  } while (token);
  return imported;
}
export async function reconcileTikTokEarnings(shop, start, end) {
  const earnings = await TikTokEarning.find({ shopId: shop.shopId, type: "SETTLE", transactionDate: { $gte: start, $lte: end } });
  let reconciled = 0;
  for (const earning of earnings) {
    const candidates = await TikTokSettlement.find({ shopId: shop.shopId, settlementDate: { $gte: new Date(earning.transactionDate.getTime() - 30 * 86400_000), $lte: new Date(earning.transactionDate.getTime() + 86400_000) }, netSettlementMinor: earning.amountMinor }).lean();
    if (candidates.length !== 1) { earning.reconciliationStatus = candidates.length > 1 ? "ambiguous" : "awaiting_transactions"; await earning.save(); continue; }
    const statement = candidates[0];
    earning.linkedSettlementIds = [statement._id]; earning.orderCount = statement.orderCount;
    if (statement.reconciliationStatus !== "reconciled" || statement.calculatedProfitMinor == null) { earning.reconciliationStatus = statement.reconciliationStatus === "amount_mismatch" ? "amount_mismatch" : "awaiting_cost"; earning.capitalCostMinor = undefined; earning.profitMinor = undefined; await earning.save(); continue; }
    const adjustmentCount = await FinanceTransaction.countDocuments({ shopId: shop.shopId, statementId: statement.statementId, transactionType: { $ne: "ORDER" } });
    earning.linkedSettlementIds = [statement._id]; earning.capitalCostMinor = statement.totalCapitalCostMinor; earning.profitMinor = statement.calculatedProfitMinor;
    earning.orderCount = statement.orderCount; earning.adjustmentCount = adjustmentCount; earning.reconciliationStatus = "reconciled"; await earning.save(); reconciled++;
  }
  return reconciled;
}
async function importStatement(shop, statementId, financeByOrder) {
  let token; let root; const imported = [];
  do {
    const data = await tiktokRequest(`/finance/202501/statements/${encodeURIComponent(statementId)}/statement_transactions`, { query: { page_size: 100, page_token: token, sort_field: "order_create_time", sort_order: "ASC", shop_cipher: shop.shopCipher } });
    root ||= data; const orderIds = [...new Set((data.transactions || []).map(row => String(row.order_id || "")).filter(Boolean))];
    const orders = await TikTokOrder.find({ shopId: shop.shopId, orderId: { $in: orderIds } }).lean(); const byOrder = new Map(orders.map(order => [order.orderId, order]));
    for (const row of data.transactions || []) {
      if (!row.id) continue;
      const normalized = normalizeFinanceTransaction(row, { shopId: shop.shopId, statementId, statementDate: at(data.create_time) || new Date(), currency: data.currency || "PHP", order: byOrder.get(String(row.order_id || "")), orderFinance: financeByOrder.get(String(row.order_id || "")) });
      await FinanceTransaction.findOneAndUpdate({ shopId: shop.shopId, transactionId: normalized.transactionId }, { $set: normalized }, { upsert: true }); imported.push(normalized);
    }
    token = data.next_page_token;
  } while (token);
  const totals = imported.reduce((acc, row) => { for (const key of ["revenueMinor", "feeMinor", "taxMinor", "refundMinor", "adjustmentMinor", "settlementMinor"]) acc[key] += BigInt(row[key] || 0); if (row.capitalCostKnown) acc.capital += BigInt(row.capitalCostMinor || 0); else acc.unknown += BigInt(row.settlementMinor || 0); if (row.tiktokOrderId) acc.orders.add(row.tiktokOrderId); return acc; }, { revenueMinor: 0n, feeMinor: 0n, taxMinor: 0n, refundMinor: 0n, adjustmentMinor: 0n, settlementMinor: 0n, capital: 0n, unknown: 0n, orders: new Set() });
  const expected = toMinor(root?.total_settlement_amount); const mismatch = root?.total_settlement_amount != null && expected !== totals.settlementMinor;
  const status = mismatch ? "amount_mismatch" : totals.unknown !== 0n ? "awaiting_reconciliation" : "reconciled";
  const profit = status === "reconciled" ? totals.settlementMinor - totals.capital : null;
  await TikTokSettlement.findOneAndUpdate({ shopId: shop.shopId, statementId }, { $set: { settlementDate: at(root?.create_time) || new Date(), currency: root?.currency || "PHP", totalRevenueMinor: minorString(totals.revenueMinor), totalFeesMinor: minorString(totals.feeMinor), totalTaxesMinor: minorString(totals.taxMinor), totalRefundsMinor: minorString(totals.refundMinor), totalAdjustmentsMinor: minorString(totals.adjustmentMinor), netSettlementMinor: minorString(totals.settlementMinor), totalCapitalCostMinor: minorString(totals.capital), calculatedProfitMinor: profit == null ? undefined : minorString(profit), profitMarginBasisPoints: profit != null && totals.settlementMinor > 0n ? Number(profit * 10000n / totals.settlementMinor) : undefined, unreconciledAmountMinor: minorString(totals.unknown), orderCount: totals.orders.size, transactionCount: imported.length, reconciliationStatus: status, sourceTotals: { totalSettlementAmount: root?.total_settlement_amount, payableAmount: root?.payable_amount, status: root?.status }, lastSyncedAt: new Date() } }, { upsert: true });
  return { transactions: imported.length, reconciled: status === "reconciled" };
}

export async function syncTikTokSettlements({ from, to = new Date(), mode = "manual" } = {}) {
  const shop = await connectedShop(); const owner = await acquire(shop); const end = new Date(to); const start = from ? new Date(from) : new Date((shop.lastSettlementSyncAt?.getTime() || Date.now() - 90 * 86400_000) - 2 * 86400_000);
  let log;
  try {
    log = await FinanceSyncLog.create({ shopId: shop.shopId, mode, status: "running", rangeStart: start, rangeEnd: end });
    const earnings = await importTikTokEarnings(shop, start, end);
    const orderDiscoveryStart = new Date(start.getTime() - 60 * 86400_000);
    const orders = await TikTokOrder.find({ shopId: shop.shopId, createdAtTikTok: { $gte: orderDiscoveryStart, $lte: end } }).lean(); const statements = new Set(); const financeByOrder = new Map();
    for (const order of orders) {
      const finance = order.finance || await tiktokRequest(`/finance/202501/orders/${encodeURIComponent(order.orderId)}/statement_transactions`, { query: { shop_cipher: shop.shopCipher } });
      financeByOrder.set(order.orderId, finance); for (const sku of finance.sku_transactions || []) if (sku.statement_id) statements.add(String(sku.statement_id));
      if (!order.finance) await TikTokOrder.updateOne({ _id: order._id }, { finance, financeSyncedAt: new Date() });
    }
    let transactions = 0; let reconciled = 0; for (const id of statements) { const result = await importStatement(shop, id, financeByOrder); transactions += result.transactions; if (result.reconciled) reconciled++; }
    const reconciledEarnings = await reconcileTikTokEarnings(shop, start, end);
    Object.assign(log, { status: "completed", ordersChecked: orders.length, statementsFound: statements.size, transactionsImported: transactions, reconciledStatements: reconciled, completedAt: new Date() }); await log.save();
    await TikTokShop.updateOne({ _id: shop._id }, { lastSettlementSyncAt: end });
    return { earnings, reconciledEarnings, orders: orders.length, statements: statements.size, transactions, reconciled, synchronizedAt: end, inventoryChanged: false };
  } catch (error) { if (log) { log.status = "failed"; log.errorMessage = error.message; log.completedAt = new Date(); await log.save(); } throw error; }
  finally { await TikTokShop.updateOne({ _id: shop._id, settlementSyncOwner: owner }, { $unset: { settlementSyncLeaseUntil: 1, settlementSyncOwner: 1 } }); }
}

const rangeFilter = (from, to) => ({ $gte: new Date(`${from}T00:00:00+08:00`), $lte: new Date(`${to}T23:59:59.999+08:00`) });
const publicSettlement = row => ({ ...row, totalRevenue: fromMinor(row.totalRevenueMinor), totalFees: fromMinor(row.totalFeesMinor), totalTaxes: fromMinor(row.totalTaxesMinor), totalRefunds: fromMinor(row.totalRefundsMinor), totalAdjustments: fromMinor(row.totalAdjustmentsMinor), netSettlement: fromMinor(row.netSettlementMinor), totalCapitalCost: fromMinor(row.totalCapitalCostMinor), calculatedProfit: row.calculatedProfitMinor == null ? null : fromMinor(row.calculatedProfitMinor), profitMargin: row.profitMarginBasisPoints == null ? null : row.profitMarginBasisPoints / 100, unreconciledAmount: fromMinor(row.unreconciledAmountMinor) });
export async function financeOverview(from, to) { const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); const rows = shop?.shopId ? await TikTokSettlement.find({ shopId: shop.shopId, settlementDate: rangeFilter(from, to) }).lean() : []; const fields = ["totalRevenueMinor", "totalFeesMinor", "totalTaxesMinor", "netSettlementMinor", "totalCapitalCostMinor", "calculatedProfitMinor", "unreconciledAmountMinor"]; const sums = Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + BigInt(row[field] || 0), 0n)])); return { grossRevenue: fromMinor(sums.totalRevenueMinor), fees: fromMinor(sums.totalFeesMinor), taxes: fromMinor(sums.totalTaxesMinor), netSettlement: fromMinor(sums.netSettlementMinor), capitalCost: fromMinor(sums.totalCapitalCostMinor), netProfit: fromMinor(sums.calculatedProfitMinor), unreconciledAmount: fromMinor(sums.unreconciledAmountMinor), profitMargin: sums.netSettlementMinor > 0n ? Number(sums.calculatedProfitMinor * 10000n / sums.netSettlementMinor) / 100 : null, statementCount: rows.length }; }
export async function listFinanceSettlements(from, to) { const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); return shop?.shopId ? (await TikTokSettlement.find({ shopId: shop.shopId, settlementDate: rangeFilter(from, to) }).sort({ settlementDate: -1 }).lean()).map(publicSettlement) : []; }
export const publicEarning = row => ({ ...row, amount: fromMinor(row.amountMinor), capitalCost: row.capitalCostMinor == null ? null : fromMinor(row.capitalCostMinor), profit: row.profitMinor == null ? null : fromMinor(row.profitMinor), displayType: row.type === "SETTLE" ? "Order settlement" : row.type === "WITHDRAW" ? "Withdrawal" : row.type === "TRANSFER" ? "Platform transfer" : "Withdrawal reversal" });
export async function listTikTokEarnings(from, to) { const shop = await TikTokShop.findOne({ key: "singleton" }).lean(); if (!shop?.shopId) return []; return (await TikTokEarning.find({ shopId: shop.shopId, transactionDate: rangeFilter(from, to) }).sort({ transactionDate: -1, transactionId: 1 }).lean()).map(publicEarning); }
export { publicSettlement };

let timer; export function startTikTokSettlementScheduler() { if (String(process.env.TIKTOK_SETTLEMENT_SYNC_ENABLED || "true").toLowerCase() !== "true" || timer) return; timer = setInterval(() => syncTikTokSettlements({ mode: "scheduled" }).catch(error => console.error(`TikTok finance sync failed: ${error.message}`)), Math.max(1, Number(process.env.TIKTOK_SETTLEMENT_SYNC_INTERVAL_HOURS) || 24) * 3600_000); timer.unref?.(); }
