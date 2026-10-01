import Product from "../models/Product.js";
import Sale from "../models/Sale.js";
import InventoryMovement from "../models/InventoryMovement.js";
import { getSettingsDocument } from "./settingsController.js";

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const sendCsv = (res, filename, headers, rows) => {
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  res.attachment(filename).type("text/csv").send(csv);
};
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const range = (startDate, endDate) => {
  if (!startDate || !endDate || !datePattern.test(startDate) || !datePattern.test(endDate)) {
    throw Object.assign(new Error("Start date and end date must use YYYY-MM-DD format."), { statusCode: 400 });
  }
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T00:00:00+08:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  if (start >= end) throw Object.assign(new Error("Start date must not be after end date."), { statusCode: 400 });
  return { start, end };
};
const phDate = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(value));

export const exportProducts = async (_req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: 1 }).lean();
    sendCsv(res, "RJE_Products.csv", ["Product Name", "SKU", "Category", "Capital Price", "Selling Price", "Current Stock", "Created Date", "Updated Date"], products.map((p) => [p.name, p.sku, p.category, p.capitalPrice, p.sellingPrice, p.stock, phDate(p.createdAt), phDate(p.updatedAt)]));
  } catch (error) { next(error); }
};

export const exportSales = async (req, res, next) => {
  try {
    const { start, end } = range(req.query.startDate, req.query.endDate);
    const sales = await Sale.find({ date: { $gte: start, $lt: end } }).sort({ date: 1, createdAt: 1 }).lean();
    sendCsv(res, `RJE_Sales_${req.query.startDate}_to_${req.query.endDate}.csv`, ["Transaction Date", "Product Name", "Quantity", "Selling Price", "Capital Price", "Total Sales", "Total Capital", "TikTok Fees", "Withholding Tax", "Net Sales", "Profit", "Profit Margin"], sales.map((s) => [phDate(s.date), s.productName, s.quantity, s.sellingPrice, s.capitalPrice, s.totalSales, s.totalCapital, s.tiktokFees, s.withholdingTax || 0, s.netSales, s.profit, s.profitMargin]));
  } catch (error) { next(error); }
};

export const exportInventory = async (_req, res, next) => {
  try {
    const [products, settings] = await Promise.all([Product.find().sort({ name: 1 }).lean(), getSettingsDocument()]);
    sendCsv(res, "RJE_Inventory.csv", ["Product Name", "SKU", "Category", "Current Stock", "Capital Price", "Stock Value", "Low Stock Status", "Last Updated"], products.map((p) => [p.name, p.sku, p.category, p.stock, p.capitalPrice, p.stock * p.capitalPrice, p.stock === 0 ? "Out of Stock" : p.stock <= settings.lowStockThreshold ? "Low Stock" : "In Stock", phDate(p.updatedAt)]));
  } catch (error) { next(error); }
};

export const exportReports = async (req, res, next) => {
  try {
    const { start, end } = range(req.query.startDate, req.query.endDate);
    const sales = await Sale.find({ date: { $gte: start, $lt: end } }).sort({ date: 1, createdAt: 1 }).lean();
    const totals = sales.reduce((a, s) => ({ sales: a.sales + s.totalSales, capital: a.capital + s.totalCapital, fees: a.fees + s.tiktokFees, net: a.net + s.netSales, profit: a.profit + s.profit, quantity: a.quantity + s.quantity }), { sales: 0, capital: 0, fees: 0, net: 0, profit: 0, quantity: 0 });
    const daily = new Map();
    const products = new Map();
    sales.forEach((s) => {
      const day = phDate(s.date);
      const dailyItem = daily.get(day) || { quantity: 0, sales: 0, capital: 0, fees: 0, net: 0, profit: 0 };
      dailyItem.quantity += s.quantity; dailyItem.sales += s.totalSales; dailyItem.capital += s.totalCapital; dailyItem.fees += s.tiktokFees; dailyItem.net += s.netSales; dailyItem.profit += s.profit; daily.set(day, dailyItem);
      const product = products.get(s.productName) || { quantity: 0, sales: 0, profit: 0 };
      product.quantity += s.quantity; product.sales += s.totalSales; product.profit += s.profit; products.set(s.productName, product);
    });
    const rows = [["Summary"], ["Metric", "Value"], ["Total Sales", totals.sales], ["Total Capital", totals.capital], ["TikTok Fees", totals.fees], ["Net Sales", totals.net], ["Total Profit", totals.profit], ["Quantity Sold", totals.quantity], ["Profit Margin", totals.net === 0 ? 0 : totals.profit / totals.net * 100], [], ["Daily Sales & Profit"], ["Date", "Quantity", "Sales", "Capital", "Fees", "Net Sales", "Profit"], ...Array.from(daily, ([day, value]) => [day, value.quantity, value.sales, value.capital, value.fees, value.net, value.profit]), [], ["Product Performance"], ["Product", "Quantity", "Sales", "Profit", "Margin"], ...Array.from(products, ([name, value]) => [name, value.quantity, value.sales, value.profit, value.sales === 0 ? 0 : value.profit / value.sales * 100]), [], ["Sales"], ["Date", "Product", "Quantity", "Sales", "Capital", "Fees", "Net Sales", "Profit", "Margin"], ...sales.map((s) => [phDate(s.date), s.productName, s.quantity, s.totalSales, s.totalCapital, s.tiktokFees, s.netSales, s.profit, s.profitMargin])];
    sendCsv(res, `RJE_Report_${req.query.startDate}_to_${req.query.endDate}.csv`, ["Report Export"], rows);
  } catch (error) { next(error); }
};

export const exportInventoryMovements = async (_req, res, next) => {
  try {
    const movements = await InventoryMovement.find().sort({ createdAt: 1 }).lean();
    sendCsv(res, "RJE_Inventory_Movements.csv", ["Date", "Product", "Type", "Quantity", "Previous Stock", "New Stock", "Reason", "Reference"], movements.map((m) => [phDate(m.createdAt), m.productName, m.type, m.quantity, m.previousStock, m.newStock, m.reason, m.referenceId || ""]));
  } catch (error) { next(error); }
};
