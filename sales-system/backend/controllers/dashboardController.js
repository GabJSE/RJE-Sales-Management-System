import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import { getSettingsDocument } from "./settingsController.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const getDateRange = (startDate, endDate) => {
  if (!startDate && !endDate) return null;
  if (!startDate || !endDate || !datePattern.test(startDate) || !datePattern.test(endDate)) {
    const error = new Error("Start date and end date must use YYYY-MM-DD format.");
    error.statusCode = 400;
    throw error;
  }
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const endExclusive = new Date(`${endDate}T00:00:00+08:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime()) || start >= endExclusive) {
    const error = new Error("Start date must not be after end date.");
    error.statusCode = 400;
    throw error;
  }
  return { start, endExclusive };
};

const margin = (profit, netSales) => (netSales === 0 ? 0 : (profit / netSales) * 100);

export const getDashboard = async (req, res, next) => {
  try {
    const range = getDateRange(req.query.startDate, req.query.endDate);
    const match = range ? { date: { $gte: range.start, $lt: range.endExclusive } } : {};
    const settings = await getSettingsDocument();
    const lowStockThreshold = settings.lowStockThreshold;
    const [result, inventory] = await Promise.all([
      Sale.aggregate([
        { $match: match },
        { $set: { reportItems: { $cond: [{ $gt: [{ $size: { $ifNull: ["$items", []] } }, 0] }, "$items", [{ productId: "$productId", productName: "$productName", quantity: "$quantity", totalSales: "$totalSales", profit: "$profit", netSales: "$netSales" }]] } } },
        {
          $facet: {
            summary: [{ $group: { _id: null, totalSales: { $sum: "$totalSales" }, totalCapital: { $sum: "$totalCapital" }, totalTiktokFees: { $sum: "$tiktokFees" }, totalWithholdingTax: { $sum: { $ifNull: ["$withholdingTax", 0] } }, netSales: { $sum: "$netSales" }, totalProfit: { $sum: "$profit" }, totalQuantitySold: { $sum: { $ifNull: ["$totalQuantity", "$quantity"] } }, transactionCount: { $sum: 1 } } }],
            trend: [{ $group: { _id: { $dateToString: { date: "$date", format: "%Y-%m-%d", timezone: "Asia/Manila" } }, totalSales: { $sum: "$totalSales" }, netSales: { $sum: "$netSales" }, totalProfit: { $sum: "$profit" } } }, { $sort: { _id: 1 } }],
            recentSales: [{ $sort: { date: -1, createdAt: -1 } }, { $limit: 10 }, { $project: { _id: 1, orderId: 1, date: 1, productName: 1, totalQuantity: 1, quantity: 1, totalSales: 1, netSales: 1, profit: 1 } }],
            topSellingProducts: [{ $unwind: "$reportItems" }, { $match: { "reportItems.productId": { $exists: true } } }, { $group: { _id: { productId: "$reportItems.productId", productName: "$reportItems.productName" }, quantitySold: { $sum: "$reportItems.quantity" }, totalSales: { $sum: "$reportItems.totalSales" } } }, { $sort: { quantitySold: -1, totalSales: -1 } }, { $limit: 5 }],
            mostProfitableProducts: [{ $unwind: "$reportItems" }, { $match: { "reportItems.productId": { $exists: true } } }, { $group: { _id: { productId: "$reportItems.productId", productName: "$reportItems.productName" }, totalProfit: { $sum: "$reportItems.profit" }, netSales: { $sum: "$reportItems.netSales" }, quantitySold: { $sum: "$reportItems.quantity" } } }, { $sort: { totalProfit: -1, quantitySold: -1 } }, { $limit: 5 }],
          },
        },
      ]),
      Product.aggregate([
        { $facet: {
          summary: [{ $group: { _id: null, totalProducts: { $sum: 1 }, totalStock: { $sum: "$stock" }, lowStockCount: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", lowStockThreshold] }] }, 1, 0] } }, outOfStockCount: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } } } }],
          lowStockProducts: [{ $match: { stock: { $gt: 0, $lte: lowStockThreshold } } }, { $sort: { stock: 1, name: 1 } }, { $project: { _id: 1, name: 1, brand: 1, category: 1, model: 1, sku: 1, stock: 1 } }],
        } },
      ]),
    ]);

    const raw = result[0] || {};
    const totals = raw.summary[0] || {     totalSales: 0, totalCapital: 0, totalTiktokFees: 0, totalWithholdingTax: 0, netSales: 0, totalProfit: 0, totalQuantitySold: 0, transactionCount: 0 };
    const inventoryRaw = inventory[0] || {};
    const inventorySummary = inventoryRaw.summary[0] || { totalProducts: 0, totalStock: 0, lowStockCount: 0, outOfStockCount: 0 };
    const { _id: summaryId, ...summaryValues } = totals;
    const { _id: inventoryId, ...inventoryValues } = inventorySummary;
    res.json({
      period: range ? { startDate: req.query.startDate, endDate: req.query.endDate } : null,
      summary: { ...summaryValues, profitMargin: margin(totals.totalProfit, totals.netSales) },
      salesTrend: raw.trend.map((item) => ({ date: item._id, totalSales: item.totalSales, netSales: item.netSales, profit: item.totalProfit })),
      profitTrend: raw.trend.map((item) => ({ date: item._id, profit: item.totalProfit })),
      recentSales: raw.recentSales,
      topSellingProducts: raw.topSellingProducts.map((item) => ({ productId: item._id.productId, productName: item._id.productName, quantitySold: item.quantitySold, totalSales: item.totalSales })),
      mostProfitableProducts: raw.mostProfitableProducts.map((item) => ({ productId: item._id.productId, productName: item._id.productName, totalProfit: item.totalProfit, quantitySold: item.quantitySold, profitMargin: margin(item.totalProfit, item.netSales) })),
      inventory: { ...inventoryValues, lowStockProducts: inventoryRaw.lowStockProducts || [] },
    });
  } catch (error) {
    next(error);
  }
};
