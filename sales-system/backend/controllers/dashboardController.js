import TikTokOrder from "../models/TikTokOrder.js";
import TikTokSettlement from "../models/TikTokSettlement.js";
import TikTokProductMapping from "../models/TikTokProductMapping.js";
import TikTokOrderSyncLog from "../models/TikTokOrderSyncLog.js";
import TikTokFinanceSyncLog from "../models/TikTokFinanceSyncLog.js";
import TikTokShop from "../models/TikTokShop.js";
import TikTokProductReview from "../models/TikTokProductReview.js";
import { getSettingsDocument } from "./settingsController.js";
import { fromMinor } from "../services/money.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
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
export const dashboardMath = { getDateRange, previousRange, margin, change, settlementTotals };

function settlementTotals(rows) {
  const sum = key => rows.reduce((total, row) => total + BigInt(row[key] || 0), 0n);
  const confirmed = rows.filter(row => row.reconciliationStatus === "reconciled");
  const confirmedNet = confirmed.reduce((sum, row) => sum + BigInt(row.netSettlementMinor || 0), 0n);
  const profit = confirmed.reduce((sum, row) => sum + BigInt(row.calculatedProfitMinor || 0), 0n);
  return { netSettlement: fromMinor(sum("netSettlementMinor")), confirmedProfit: fromMinor(profit), reconciledNetSettlement: fromMinor(confirmedNet), profitMargin: confirmedNet > 0n ? Number(profit * 10000n / confirmedNet) / 100 : null, fees: fromMinor(sum("totalFeesMinor")), refunds: fromMinor(sum("totalRefundsMinor")), unreconciledAmount: fromMinor(sum("unreconciledAmountMinor")), statementCount: rows.length, reconciledCount: rows.filter(row => row.reconciliationStatus === "reconciled").length, unreconciledCount: rows.filter(row => row.reconciliationStatus !== "reconciled").length };
}

export const getDashboard = async (req, res, next) => {
  try {
    const range = getDateRange(req.query.startDate, req.query.endDate); const prior = previousRange(range); const settings = await getSettingsDocument(); const low = settings.lowStockThreshold;
    const activeShop = await TikTokShop.findOne({ key: "singleton" }).select("shopId").lean(); const shopScope = { shopId: activeShop?.shopId || "__no_connected_shop__" }; const financeScope = { ...shopScope, currency: "PHP" };
    const [settlements, priorSettlements, orderFacet, inventoryFacet, orderLogs, financeLogs, shop, reviewRows] = await Promise.all([
      TikTokSettlement.find({ ...financeScope, ...dateMatch("settlementDate", range) }).lean(),
      prior ? TikTokSettlement.find({ ...financeScope, ...dateMatch("settlementDate", prior) }).lean() : Promise.resolve([]),
      TikTokOrder.aggregate([{ $match: { ...shopScope, ...dateMatch("createdAtTikTok", range) } }, { $facet: {
        statuses: [{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        recent: [{ $sort: { createdAtTikTok: -1 } }, { $limit: 10 }, { $project: { _id: 1, orderId: 1, createdAtTikTok: 1, totalAmount: 1, currency: 1, status: 1 } }],
        products: [{ $unwind: "$lines" }, { $group: { _id: { productId: "$lines.productId", skuId: "$lines.skuId", productName: "$lines.productName", sku: "$lines.sellerSku" }, units: { $sum: "$lines.quantity" }, revenue: { $sum: { $multiply: [{ $convert: { input: "$lines.salePrice", to: "double", onError: 0, onNull: 0 } }, "$lines.quantity"] } } } }, { $sort: { units: -1, revenue: -1 } }, { $limit: 10 }],
      } }]),
      TikTokProductMapping.aggregate([{ $match: { ...shopScope, archivedAt: null } }, { $facet: {
        summary: [{ $group: { _id: null, totalProducts: { $sum: 1 }, totalStock: { $sum: { $ifNull: ["$stock", 0] } }, lowStockCount: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", low] }] }, 1, 0] } }, outOfStockCount: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } }, missingCostCount: { $sum: { $cond: [{ $eq: ["$capitalCostMinor", null] }, 1, 0] } }, unmatchedCount: { $sum: { $cond: [{ $ne: ["$mappingStatus", "mapped"] }, 1, 0] } } } }],
        lowStockProducts: [{ $match: { stock: { $gt: 0, $lte: low } } }, { $sort: { stock: 1, title: 1 } }, { $limit: 5 }, { $project: { _id: 1, name: "$title", sku: "$sellerSku", stock: 1 } }],
      } }]),
      TikTokOrderSyncLog.find(shopScope).sort({ startedAt: -1 }).limit(5).lean(), TikTokFinanceSyncLog.find(shopScope).sort({ startedAt: -1 }).limit(5).lean(), TikTokShop.findOne({ key: "singleton" }).lean(),
      TikTokProductReview.aggregate([{ $group: { _id: null, total: { $sum: 1 }, averageRating: { $avg: "$rating" }, pendingApproval: { $sum: { $cond: [{ $eq: ["$status", "PENDING_APPROVAL"] }, 1, 0] } }, manuallyPublished: { $sum: { $cond: [{ $eq: ["$status", "MANUALLY_PUBLISHED"] }, 1, 0] } } } }]),
    ]);
    const finance = settlementTotals(settlements); const oldFinance = settlementTotals(priorSettlements); const orders = orderFacet[0] || {}; const orderCount = (orders.statuses || []).reduce((sum, row) => sum + row.count, 0);
    const priorOrderCount = prior ? await TikTokOrder.countDocuments({ ...shopScope, ...dateMatch("createdAtTikTok", prior) }) : 0;
    const inventoryRaw = inventoryFacet[0] || {}; const inventory = inventoryRaw.summary?.[0] || { totalProducts: 0, totalStock: 0, lowStockCount: 0, outOfStockCount: 0, missingCostCount: 0, unmatchedCount: 0 };
    const realizedRevenue = finance.netSettlement; const confirmedProfit = finance.confirmedProfit; const oldRevenue = oldFinance.netSettlement; const oldProfit = oldFinance.confirmedProfit;
    const trend = new Map();
    for (const row of settlements) {
      const day = phDay(row.settlementDate); const value = trend.get(day) || { date: day, revenueMinor: 0n, profitMinor: 0n };
      value.revenueMinor += BigInt(row.netSettlementMinor || 0);
      if (row.reconciliationStatus === "reconciled") value.profitMinor += BigInt(row.calculatedProfitMinor || 0);
      trend.set(day, value);
    }
    const recent = (orders.recent || []).map(row => ({ id: String(row._id), reference: row.orderId, date: row.createdAtTikTok, channel: "TikTok", amount: Number(row.totalAmount || 0), status: row.status, path: "/tiktok/orders" }));
    const topProducts = (orders.products || []).map(row => ({ productId: row._id.productId, productName: row._id.productName, sku: row._id.sku, units: row.units, revenue: row.revenue, profit: null, channel: "TikTok" }));
    const alerts = [];
    if (inventory.outOfStockCount) alerts.push({ severity: "critical", label: `${inventory.outOfStockCount} TikTok variants are out of stock`, path: "/tiktok/products" });
    if (settings.enableLowStockAlerts && inventory.lowStockCount) alerts.push({ severity: "warning", label: `${inventory.lowStockCount} TikTok variants have low stock`, path: "/tiktok/products" });
    if (inventory.missingCostCount) alerts.push({ severity: "warning", label: `${inventory.missingCostCount} variants need capital cost`, path: "/tiktok/products" });
    if (finance.unreconciledCount) alerts.push({ severity: "warning", label: `${finance.unreconciledCount} settlements are unreconciled`, path: "/tiktok/settlements" });
    const failedOrder = orderLogs[0]?.status === "failed" ? orderLogs[0] : null; const failedFinance = financeLogs[0]?.status === "failed" ? financeLogs[0] : null;
    if (failedOrder) alerts.push({ severity: "critical", label: "Latest TikTok order synchronization needs attention", path: "/tiktok/orders" });
    if (failedFinance) alerts.push({ severity: "critical", label: "Latest TikTok finance synchronization needs attention", path: "/tiktok/settlements" });
    res.json({
      period: range ? { startDate: req.query.startDate, endDate: req.query.endDate } : null, generatedAt: new Date(),
      kpis: { revenue: { value: realizedRevenue, change: change(realizedRevenue, oldRevenue) }, profit: { value: confirmedProfit, change: change(confirmedProfit, oldProfit) }, orders: { value: orderCount, change: change(orderCount, priorOrderCount) }, margin: { value: finance.profitMargin, change: prior && finance.profitMargin != null && oldFinance.profitMargin != null ? finance.profitMargin - oldFinance.profitMargin : null } },
      trend: [...trend.values()].map(row => ({ date: row.date, totalRevenue: fromMinor(row.revenueMinor), netProfit: fromMinor(row.profitMinor) })).sort((a, b) => a.date.localeCompare(b.date)),
      orders: { total: orderCount, byStatus: (orders.statuses || []).map(row => ({ status: row._id || "UNKNOWN", count: row.count })) },
      inventory: { ...inventory, lowStockProducts: inventoryRaw.lowStockProducts || [] }, topProducts, recentTransactions: recent,
      finance: { ...finance, lastSyncedAt: shop?.lastSettlementSyncAt || financeLogs[0]?.completedAt || null }, reviews: { ...(reviewRows[0] || { total: 0, averageRating: 0, pendingApproval: 0, manuallyPublished: 0 }), manualOnly: true }, alerts,
    });
  } catch (error) { next(error); }
};
