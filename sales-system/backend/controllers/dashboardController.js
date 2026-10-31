import Sale from "../models/Sale.js";
import TikTokOrder from "../models/TikTokOrder.js";
import TikTokSettlement from "../models/TikTokSettlement.js";
import TikTokProductMapping from "../models/TikTokProductMapping.js";
import TikTokOrderSyncLog from "../models/TikTokOrderSyncLog.js";
import TikTokFinanceSyncLog from "../models/TikTokFinanceSyncLog.js";
import TikTokShop from "../models/TikTokShop.js";
import { getSettingsDocument } from "./settingsController.js";
import { fromMinor } from "../services/money.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const zeroSales = { totalSales: 0, totalCapital: 0, totalTiktokFees: 0, totalWithholdingTax: 0, netSales: 0, totalProfit: 0, totalQuantitySold: 0, transactionCount: 0 };
const margin = (profit, revenue) => revenue === 0 ? 0 : profit / revenue * 100;
const change = (current, previous) => previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
const phDay = date => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

function getDateRange(startDate, endDate) {
  if (!startDate && !endDate) return null;
  if (!startDate || !endDate || !datePattern.test(startDate) || !datePattern.test(endDate)) {
    const error = new Error("Start date and end date must use YYYY-MM-DD format."); error.statusCode = 400; throw error;
  }
  const start = new Date(`${startDate}T00:00:00+08:00`); const endExclusive = new Date(`${endDate}T00:00:00+08:00`); endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime()) || start >= endExclusive) { const error = new Error("Start date must not be after end date."); error.statusCode = 400; throw error; }
  return { start, endExclusive };
}
const previousRange = range => range ? { start: new Date(range.start.getTime() - (range.endExclusive - range.start)), endExclusive: range.start } : null;
const dateMatch = (field, range) => range ? { [field]: { $gte: range.start, $lt: range.endExclusive } } : {};
export const dashboardMath = { getDateRange, previousRange, margin, change };

const salesPipeline = match => [
  { $match: match },
  { $set: { reportItems: { $cond: [{ $gt: [{ $size: { $ifNull: ["$items", []] } }, 0] }, "$items", [{ productId: "$productId", productName: "$productName", sku: null, quantity: "$quantity", totalSales: "$totalSales", profit: "$profit", netSales: "$netSales" }]] } } },
  { $facet: {
    summary: [{ $group: { _id: null, totalSales: { $sum: "$totalSales" }, totalCapital: { $sum: "$totalCapital" }, totalTiktokFees: { $sum: "$tiktokFees" }, totalWithholdingTax: { $sum: { $ifNull: ["$withholdingTax", 0] } }, netSales: { $sum: "$netSales" }, totalProfit: { $sum: "$profit" }, totalQuantitySold: { $sum: { $ifNull: ["$totalQuantity", "$quantity"] } }, transactionCount: { $sum: 1 } } }],
    trend: [{ $group: { _id: { $dateToString: { date: "$date", format: "%Y-%m-%d", timezone: "Asia/Manila" } }, revenue: { $sum: "$netSales" }, profit: { $sum: "$profit" } } }, { $sort: { _id: 1 } }],
    recent: [{ $sort: { date: -1, createdAt: -1 } }, { $limit: 10 }, { $project: { _id: 1, orderId: 1, date: 1, productName: 1, totalQuantity: 1, quantity: 1, totalSales: 1, profit: 1 } }],
    products: [{ $unwind: "$reportItems" }, { $group: { _id: { productId: "$reportItems.productId", productName: "$reportItems.productName", sku: "$reportItems.sku" }, units: { $sum: "$reportItems.quantity" }, revenue: { $sum: "$reportItems.netSales" }, profit: { $sum: "$reportItems.profit" } } }, { $sort: { units: -1, revenue: -1 } }, { $limit: 10 }],
  } },
];

function settlementTotals(rows) {
  const sum = key => rows.reduce((total, row) => total + BigInt(row[key] || 0), 0n);
  return { netSettlement: fromMinor(sum("netSettlementMinor")), confirmedProfit: fromMinor(sum("calculatedProfitMinor")), fees: fromMinor(sum("totalFeesMinor")), refunds: fromMinor(sum("totalRefundsMinor")), unreconciledAmount: fromMinor(sum("unreconciledAmountMinor")), statementCount: rows.length, reconciledCount: rows.filter(row => row.reconciliationStatus === "reconciled").length, unreconciledCount: rows.filter(row => row.reconciliationStatus !== "reconciled").length };
}

export const getDashboard = async (req, res, next) => {
  try {
    const range = getDateRange(req.query.startDate, req.query.endDate); const prior = previousRange(range); const settings = await getSettingsDocument(); const low = settings.lowStockThreshold;
    const [salesResult, priorSalesResult, settlements, priorSettlements, orderFacet, inventoryFacet, orderLogs, financeLogs, shop] = await Promise.all([
      Sale.aggregate(salesPipeline(dateMatch("date", range))),
      prior ? Sale.aggregate(salesPipeline(dateMatch("date", prior))) : Promise.resolve([]),
      TikTokSettlement.find(dateMatch("settlementDate", range)).lean(),
      prior ? TikTokSettlement.find(dateMatch("settlementDate", prior)).lean() : Promise.resolve([]),
      TikTokOrder.aggregate([{ $match: dateMatch("createdAtTikTok", range) }, { $facet: {
        statuses: [{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        recent: [{ $sort: { createdAtTikTok: -1 } }, { $limit: 10 }, { $project: { _id: 1, orderId: 1, createdAtTikTok: 1, totalAmount: 1, currency: 1, status: 1 } }],
        products: [{ $unwind: "$lines" }, { $group: { _id: { productId: "$lines.productId", skuId: "$lines.skuId", productName: "$lines.productName", sku: "$lines.sellerSku" }, units: { $sum: "$lines.quantity" }, revenue: { $sum: { $multiply: [{ $convert: { input: "$lines.salePrice", to: "double", onError: 0, onNull: 0 } }, "$lines.quantity"] } } } }, { $sort: { units: -1, revenue: -1 } }, { $limit: 10 }],
      } }]),
      TikTokProductMapping.aggregate([{ $match: { archivedAt: null } }, { $facet: {
        summary: [{ $group: { _id: null, totalProducts: { $sum: 1 }, totalStock: { $sum: { $ifNull: ["$stock", 0] } }, lowStockCount: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", low] }] }, 1, 0] } }, outOfStockCount: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } }, missingCostCount: { $sum: { $cond: [{ $eq: ["$capitalCostMinor", null] }, 1, 0] } }, unmatchedCount: { $sum: { $cond: [{ $ne: ["$mappingStatus", "mapped"] }, 1, 0] } } } }],
        lowStockProducts: [{ $match: { stock: { $gt: 0, $lte: low } } }, { $sort: { stock: 1, title: 1 } }, { $limit: 5 }, { $project: { _id: 1, name: "$title", sku: "$sellerSku", stock: 1 } }],
      } }]),
      TikTokOrderSyncLog.find().sort({ startedAt: -1 }).limit(5).lean(), TikTokFinanceSyncLog.find().sort({ startedAt: -1 }).limit(5).lean(), TikTokShop.findOne({ key: "singleton" }).lean(),
    ]);
    const currentSales = salesResult[0] || {}; const previousSales = priorSalesResult[0] || {}; const saleTotals = currentSales.summary?.[0] || zeroSales; const oldSaleTotals = previousSales.summary?.[0] || zeroSales;
    const finance = settlementTotals(settlements); const oldFinance = settlementTotals(priorSettlements); const orders = orderFacet[0] || {}; const orderCount = (orders.statuses || []).reduce((sum, row) => sum + row.count, 0);
    const priorOrderCount = prior ? await TikTokOrder.countDocuments(dateMatch("createdAtTikTok", prior)) : 0;
    const inventoryRaw = inventoryFacet[0] || {}; const inventory = inventoryRaw.summary?.[0] || { totalProducts: 0, totalStock: 0, lowStockCount: 0, outOfStockCount: 0, missingCostCount: 0, unmatchedCount: 0 };
    const realizedRevenue = saleTotals.netSales + finance.netSettlement; const confirmedProfit = saleTotals.totalProfit + finance.confirmedProfit; const oldRevenue = oldSaleTotals.netSales + oldFinance.netSettlement; const oldProfit = oldSaleTotals.totalProfit + oldFinance.confirmedProfit; const totalOrders = saleTotals.transactionCount + orderCount; const oldOrders = oldSaleTotals.transactionCount + priorOrderCount;
    const trend = new Map(); const addTrend = (day, values) => trend.set(day, { date: day, manualRevenue: 0, tikTokRevenue: 0, totalRevenue: 0, netProfit: 0, ...(trend.get(day) || {}), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, (trend.get(day)?.[key] || 0) + value])) });
    for (const row of currentSales.trend || []) addTrend(row._id, { manualRevenue: row.revenue, totalRevenue: row.revenue, netProfit: row.profit });
    for (const row of settlements) addTrend(phDay(row.settlementDate), { tikTokRevenue: fromMinor(row.netSettlementMinor), totalRevenue: fromMinor(row.netSettlementMinor), netProfit: fromMinor(row.calculatedProfitMinor) });
    const recent = [...(currentSales.recent || []).map(row => ({ id: String(row._id), reference: row.orderId || String(row._id).slice(-8), date: row.date, channel: "Manual", amount: row.totalSales, status: "Recorded", path: "/sales" })), ...(orders.recent || []).map(row => ({ id: String(row._id), reference: row.orderId, date: row.createdAtTikTok, channel: "TikTok", amount: Number(row.totalAmount || 0), status: row.status, path: "/tiktok/orders" }))].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    const topProducts = [...(currentSales.products || []).map(row => ({ productId: row._id.productId, productName: row._id.productName, sku: row._id.sku, units: row.units, revenue: row.revenue, profit: row.profit, channel: "Manual" })), ...(orders.products || []).map(row => ({ productId: row._id.productId, productName: row._id.productName, sku: row._id.sku, units: row.units, revenue: row.revenue, profit: null, channel: "TikTok" }))].sort((a, b) => b.units - a.units).slice(0, 10);
    const alerts = [];
    if (inventory.outOfStockCount) alerts.push({ severity: "critical", label: `${inventory.outOfStockCount} TikTok variants are out of stock`, path: "/tiktok/products" });
    if (inventory.lowStockCount) alerts.push({ severity: "warning", label: `${inventory.lowStockCount} TikTok variants have low stock`, path: "/tiktok/products" });
    if (inventory.missingCostCount) alerts.push({ severity: "warning", label: `${inventory.missingCostCount} variants need capital cost`, path: "/tiktok/products" });
    if (finance.unreconciledCount) alerts.push({ severity: "warning", label: `${finance.unreconciledCount} settlements are unreconciled`, path: "/tiktok/settlements" });
    const failedOrder = orderLogs[0]?.status === "failed" ? orderLogs[0] : null; const failedFinance = financeLogs[0]?.status === "failed" ? financeLogs[0] : null;
    if (failedOrder) alerts.push({ severity: "critical", label: "Latest TikTok order synchronization needs attention", path: "/tiktok/orders" });
    if (failedFinance) alerts.push({ severity: "critical", label: "Latest TikTok finance synchronization needs attention", path: "/tiktok/settlements" });
    res.json({
      period: range ? { startDate: req.query.startDate, endDate: req.query.endDate } : null, generatedAt: new Date(),
      kpis: { revenue: { value: realizedRevenue, change: change(realizedRevenue, oldRevenue) }, profit: { value: confirmedProfit, change: change(confirmedProfit, oldProfit) }, orders: { value: totalOrders, change: change(totalOrders, oldOrders), manual: saleTotals.transactionCount, tikTok: orderCount }, margin: { value: margin(confirmedProfit, realizedRevenue), change: prior && oldRevenue !== 0 ? margin(confirmedProfit, realizedRevenue) - margin(oldProfit, oldRevenue) : null } },
      summary: { ...saleTotals, profitMargin: margin(saleTotals.totalProfit, saleTotals.netSales) }, trend: [...trend.values()].sort((a, b) => a.date.localeCompare(b.date)),
      channels: { physicalStore: { revenue: saleTotals.netSales, transactions: saleTotals.transactionCount, profit: saleTotals.totalProfit, profitMargin: margin(saleTotals.totalProfit, saleTotals.netSales) }, tikTokSettlements: { ...finance, orderCount, profitMargin: margin(finance.confirmedProfit, finance.netSettlement) }, combined: { realizedRevenue, confirmedProfit } },
      orders: { total: orderCount, byStatus: (orders.statuses || []).map(row => ({ status: row._id || "UNKNOWN", count: row.count })) },
      inventory: { ...inventory, lowStockProducts: inventoryRaw.lowStockProducts || [] }, topProducts, recentTransactions: recent,
      finance: { ...finance, lastSyncedAt: shop?.lastSettlementSyncAt || financeLogs[0]?.completedAt || null }, alerts,
    });
  } catch (error) { next(error); }
};
