import Sale from "../models/Sale.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const getDateRange = (startDate, endDate) => {
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

const reportPipeline = (start, endExclusive) => [
  { $match: { date: { $gte: start, $lt: endExclusive } } },
  {
    $facet: {
      summary: [
        {
          $group: {
            _id: null,
            totalSales: { $sum: "$totalSales" },
            totalCapital: { $sum: "$totalCapital" },
            totalTiktokFees: { $sum: "$tiktokFees" },
            totalWithholdingTax: { $sum: { $ifNull: ["$withholdingTax", 0] } },
            netSales: { $sum: "$netSales" },
            totalProfit: { $sum: "$profit" },
            totalQuantitySold: { $sum: "$quantity" },
            transactionCount: { $sum: 1 },
          },
        },
      ],
      daily: [
        {
          $group: {
            _id: { $dateToString: { date: "$date", format: "%Y-%m-%d", timezone: "Asia/Manila" } },
            totalSales: { $sum: "$totalSales" },
            totalCapital: { $sum: "$totalCapital" },
            totalTiktokFees: { $sum: "$tiktokFees" },
            totalWithholdingTax: { $sum: { $ifNull: ["$withholdingTax", 0] } },
            netSales: { $sum: "$netSales" },
            totalProfit: { $sum: "$profit" },
            totalQuantitySold: { $sum: "$quantity" },
          },
        },
        { $sort: { _id: 1 } },
      ],
      products: [
        { $match: { productId: { $exists: true } } },
        {
          $group: {
            _id: { productId: "$productId", productName: "$productName" },
            totalQuantitySold: { $sum: "$quantity" },
            totalSales: { $sum: "$totalSales" },
            totalCapital: { $sum: "$totalCapital" },
            totalTiktokFees: { $sum: "$tiktokFees" },
            totalWithholdingTax: { $sum: { $ifNull: ["$withholdingTax", 0] } },
            netSales: { $sum: "$netSales" },
            totalProfit: { $sum: "$profit" },
          },
        },
        { $sort: { totalQuantitySold: -1, totalProfit: -1 } },
      ],
    },
  },
];

const withMargin = (item, profitKey = "totalProfit", netKey = "netSales") => ({
  ...item,
  profitMargin: item[netKey] === 0 ? 0 : (item[profitKey] / item[netKey]) * 100,
});

export const getReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const { start, endExclusive } = getDateRange(startDate, endDate);
    const [result] = await Sale.aggregate(reportPipeline(start, endExclusive));
    const rawSummary = result.summary[0] || {
      totalSales: 0, totalCapital: 0, totalTiktokFees: 0, totalWithholdingTax: 0, netSales: 0,
      totalProfit: 0, totalQuantitySold: 0, transactionCount: 0,
    };

    res.json({
      period: { startDate, endDate },
      summary: withMargin(rawSummary),
      daily: result.daily.map((item) => withMargin({ date: item._id, ...item })),
      products: result.products.map((item) => withMargin({
        productId: item._id.productId,
        productName: item._id.productName,
        ...item,
      })),
    });
  } catch (error) {
    next(error);
  }
};

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export const exportReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const { start, endExclusive } = getDateRange(startDate, endDate);
    const sales = await Sale.find({ date: { $gte: start, $lt: endExclusive } })
      .sort({ date: 1, createdAt: 1 })
      .lean();
    const headers = ["Date", "Product", "Quantity", "Selling Price", "Capital Price", "Total Sales", "TikTok Fees", "Withholding Tax", "Net Sales", "Profit", "Profit Margin"];
    const rows = sales.map((sale) => [
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(sale.date)),
      sale.productName, sale.quantity, sale.sellingPrice, sale.capitalPrice, sale.totalSales,
      sale.tiktokFees, sale.withholdingTax || 0, sale.netSales, sale.profit, sale.profitMargin,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    res.attachment(`sales-report-${startDate}-to-${endDate}.csv`).type("text/csv").send(csv);
  } catch (error) {
    next(error);
  }
};
