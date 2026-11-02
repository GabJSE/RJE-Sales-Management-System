import TikTokOrder from "../models/TikTokOrder.js";
import FinanceTransaction from "../models/TikTokFinanceTransaction.js";
import Settlement from "../models/TikTokSettlement.js";
import { fromMinor } from "./money.js";

// Order-level amounts can only be attributed safely when every line is the same variant.
export function summarizeProductSettlements(products, orders, transactions) {
  const byOrder = new Map(orders.map(order => [order.orderId, order]));
  return new Map(products.map(product => {
    let settlement = 0n; let profit = 0n; let units = 0; let count = 0;
    for (const transaction of transactions) {
      if (transaction.transactionType !== "ORDER" || transaction.reconciliationStatus !== "reconciled" || transaction.profitMinor == null || transaction.currency !== product.currency) continue;
      const order = byOrder.get(transaction.tiktokOrderId);
      if (!order?.lines?.length || !order.lines.every(line => line.skuId === product.tiktokSkuId && line.productId === product.tiktokProductId)) continue;
      // Refunds and adjustments do not represent a final selling price per unit.
      if (BigInt(transaction.revenueMinor || 0) <= 0n || BigInt(transaction.settlementMinor || 0) <= 0n) continue;
      const quantity = order.lines.reduce((sum, line) => sum + Number(line.quantity), 0);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;
      settlement += BigInt(transaction.settlementMinor); profit += BigInt(transaction.profitMinor); units += quantity; count++;
    }
    return [product.tiktokSkuId, { averageSettlementPrice: units ? fromMinor(settlement) / units : null, settlementProfitMargin: settlement > 0n ? Number(profit * 10000n / settlement) / 100 : null, settledUnits: units, settlementTransactionCount: count }];
  }));
}

export function productMetricsPipeline(shopId, products, { from, to } = {}) {
  const dateFilter = from || to ? { statementDate: { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) } } : {};
  const decimal = field => ({ $convert: { input: "$" + field, to: "decimal", onNull: null, onError: null } });
  return [
    { $match: { shopId, "lines.skuId": { $in: products.map(row => row.tiktokSkuId) } } },
    { $set: { variant: { $arrayElemAt: ["$lines", 0] }, units: { $sum: "$lines.quantity" } } },
    { $match: { $expr: { $and: [
      { $gt: ["$units", 0] }, { $lte: ["$units", Number.MAX_SAFE_INTEGER] }, { $eq: ["$units", { $trunc: "$units" }] },
      { $gt: [{ $size: "$lines" }, 0] },
      { $allElementsTrue: [{ $map: { input: "$lines", as: "line", in: { $and: [{ $eq: ["$$line.skuId", "$variant.skuId"] }, { $eq: ["$$line.productId", "$variant.productId"] }] } } }] },
    ] } } },
    { $project: { orderId: 1, "variant.skuId": 1, "variant.productId": 1, units: 1 } },
    // A plain indexed equality join lets Mongo use its optimized lookup execution.
    { $lookup: { from: FinanceTransaction.collection.name, localField: "orderId", foreignField: "tiktokOrderId", as: "transaction" } },
    { $unwind: "$transaction" },
    { $lookup: { from: Settlement.collection.name, let: { statementId: "$transaction.statementId" }, pipeline: [{ $match: { shopId, reconciliationStatus: "reconciled", $expr: { $eq: ["$statementId", "$$statementId"] } } }, { $project: { _id: 1 } }], as: "confirmedStatement" } },
    { $match: { "confirmedStatement.0": { $exists: true } } },
    { $match: {
      "transaction.shopId": shopId, "transaction.isCurrent": { $ne: false }, "transaction.transactionType": "ORDER", "transaction.reconciliationStatus": "reconciled", "transaction.profitMinor": { $ne: null },
      ...(dateFilter.statementDate ? { "transaction.statementDate": dateFilter.statementDate } : {}),
      $or: products.map(row => ({ "variant.skuId": row.tiktokSkuId, "variant.productId": row.tiktokProductId, "transaction.currency": row.currency })),
    } },
    { $set: { settlementValue: decimal("transaction.settlementMinor"), profitValue: decimal("transaction.profitMinor"), revenueValue: decimal("transaction.revenueMinor") } },
    { $match: { $expr: { $and: [{ $gt: ["$settlementValue", 0] }, { $gt: ["$revenueValue", 0] }, { $ne: ["$profitValue", null] }] } } },
    { $group: { _id: { skuId: "$variant.skuId", productId: "$variant.productId", currency: "$transaction.currency" }, settlement: { $sum: "$settlementValue" }, profit: { $sum: "$profitValue" }, revenue: { $sum: "$revenueValue" }, units: { $sum: "$units" }, count: { $sum: 1 } } },
    { $project: { settlement: { $toString: "$settlement" }, profit: { $toString: "$profit" }, revenue: { $toString: "$revenue" }, units: 1, count: 1 } },
  ];
}

export async function productSettlementMetrics(shopId, products, range = {}) {
  if (!products.length) return new Map();
  const totals = await TikTokOrder.aggregate(productMetricsPipeline(shopId, products, range)).allowDiskUse(true);
  const bySku = new Map(totals.map(row => [row._id.skuId, row]));
  return new Map(products.map(product => {
    const row = bySku.get(product.tiktokSkuId); const settlement = BigInt(row?.settlement || 0); const profit = BigInt(row?.profit || 0);
    return [product.tiktokSkuId, { averageSettlementProfit: row?.units ? fromMinor(profit) / row.units : null, averageSettlementPrice: row?.units ? fromMinor(settlement) / row.units : null, settlementProfitMargin: settlement > 0n ? Number(profit * 10000n / settlement) / 100 : null, settledUnits: row?.units || 0, settlementTransactionCount: row?.count || 0, settledRevenue: fromMinor(row?.revenue || 0), settledCapitalCost: fromMinor(settlement - profit), settledGrossProfit: fromMinor(BigInt(row?.revenue || 0) - (settlement - profit)), settledProfit: fromMinor(profit) }];
  }));
}
