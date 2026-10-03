import mongoose from "mongoose";
import Product from "../models/Product.js";
import Sale from "../models/Sale.js";
import InventoryMovement from "../models/InventoryMovement.js";

const validId = (id) => mongoose.isValidObjectId(id);
const displayName = (product) => product.brand
  ? `${product.brand} ${product.category || ""} ${product.model || ""}`.replace(/\s+/g, " ").trim()
  : product.name;
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const runTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    return result;
  } finally {
    await session.endSession();
  }
};

const addMovement = (product, type, quantity, previousStock, reason, referenceId, session) =>
  InventoryMovement.create([{
    productId: product._id,
    productName: displayName(product),
    type,
    quantity,
    previousStock,
    newStock: product.stock,
    reason,
    referenceId,
  }], { session });

const parseMoney = (value, label) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw error(`${label} cannot be negative.`);
  return amount;
};

const generatedOrderId = (date) => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(date).replaceAll("-", "");
  return `RJE-${day}-${Date.now().toString(36).slice(-7).toUpperCase()}`;
};

const parseLegacyItem = (body) => {
  if (!body.productId) return [];
  if (!validId(body.productId)) throw error("Invalid product ID.");
  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw error("Quantity must be a whole number greater than zero.");
  return [{ productId: body.productId, quantity, ...(body.sellingPrice !== undefined ? { sellingPrice: body.sellingPrice } : {}), ...(body.capitalPrice !== undefined ? { capitalPrice: body.capitalPrice } : {}) }];
};

const parseItems = (body, existing) => {
  const rawItems = Array.isArray(body.items) ? body.items : existing?.items?.length ? existing.items : parseLegacyItem(body);
  const merged = new Map();
  rawItems.forEach((raw) => {
    if (!validId(raw.productId)) throw error("Each order item must have a valid product.");
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw error("Each item quantity must be a positive whole number.");
    const current = merged.get(String(raw.productId));
    if (current) current.quantity += quantity;
    else merged.set(String(raw.productId), { productId: raw.productId, quantity, sellingPrice: raw.sellingPrice, capitalPrice: raw.capitalPrice });
  });
  return [...merged.values()];
};

const allocate = (amount, items) => {
  const totalSales = items.reduce((sum, item) => sum + item.totalSales, 0);
  let allocated = 0;
  return items.map((item, index) => {
    if (index === items.length - 1) return round(amount - allocated);
    const value = totalSales === 0 ? 0 : round(amount * item.totalSales / totalSales);
    allocated += value;
    return value;
  });
};

const buildItems = async (rawItems, session, fee, withholdingTax) => {
  const products = [];
  for (const raw of rawItems) {
    const product = await Product.findById(raw.productId).session(session);
    if (!product) throw error(`Product not found: ${raw.productId}`, 404);
    const sellingPrice = raw.sellingPrice === undefined ? product.sellingPrice : parseMoney(raw.sellingPrice, "Selling price");
    const capitalPrice = raw.capitalPrice === undefined ? product.capitalPrice : parseMoney(raw.capitalPrice, "Capital price");
    products.push({ product, quantity: raw.quantity, sellingPrice, capitalPrice });
  }
  const snapshots = products.map(({ product, quantity, sellingPrice, capitalPrice }) => ({
    productId: product._id,
    productName: displayName(product),
    sku: product.sku,
    quantity,
    sellingPrice,
    capitalPrice,
    totalSales: round(quantity * sellingPrice),
    totalCapital: round(quantity * capitalPrice),
  }));
  const fees = allocate(fee, snapshots);
  const taxes = allocate(withholdingTax, snapshots);
  return snapshots.map((item, index) => ({
    ...item,
    allocatedTikTokFee: fees[index],
    allocatedWithholdingTax: taxes[index],
    netSales: round(item.totalSales - fees[index] - taxes[index]),
    profit: round(item.totalSales - fees[index] - taxes[index] - item.totalCapital),
    product: products[index].product,
  }));
};

const totalsFor = (items, tiktokFees, withholdingTax) => {
  const totalSales = round(items.reduce((sum, item) => sum + item.totalSales, 0));
  const totalCapital = round(items.reduce((sum, item) => sum + item.totalCapital, 0));
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const netSales = round(totalSales - tiktokFees - withholdingTax);
  const profit = round(netSales - totalCapital);
  return { totalSales, totalCapital, totalQuantity, netSales, profit, profitMargin: netSales === 0 ? 0 : round(profit / netSales * 100) };
};

const adjustStock = async (items, session, direction, reason, referenceId) => {
  for (const item of items) {
    const product = await Product.findOneAndUpdate(
      { _id: item.productId, ...(direction < 0 ? { stock: { $gte: item.quantity } } : {}) },
      { $inc: { stock: direction * item.quantity } },
      { new: true, session }
    );
    if (!product) {
      const current = await Product.findById(item.productId).session(session);
      throw error(current ? `Insufficient stock for ${displayName(current)}. Available quantity: ${current.stock}.` : "Product not found.", current ? 400 : 404);
    }
    await addMovement(product, direction < 0 ? "SALE" : "SALE_CANCELLATION", item.quantity, product.stock - direction * item.quantity, reason, referenceId, session);
  }
};

const toSaleValues = (body, items, date, existing) => {
  const tiktokFees = parseMoney(body.tiktokFees ?? existing?.tiktokFees, "TikTok fees");
  const withholdingTax = parseMoney(body.withholdingTax ?? existing?.withholdingTax, "Withholding tax");
  if (!items.length && withholdingTax <= 0) throw error("Select at least one product or enter a withholding tax amount.");
  const totals = totalsFor(items, tiktokFees, withholdingTax);
  return {
    date,
    orderId: body.orderId || existing?.orderId || generatedOrderId(date),
    ...(body.orderReference !== undefined ? { orderReference: String(body.orderReference).trim() } : existing?.orderReference ? { orderReference: existing.orderReference } : {}),
    ...(body.notes !== undefined ? { notes: String(body.notes).trim() } : existing?.notes ? { notes: existing.notes } : {}),
    ...(items.length ? { items, totalQuantity: totals.totalQuantity, productName: items.length === 1 ? items[0].productName : "Multi-product order", productId: items.length === 1 ? items[0].productId : undefined, quantity: totals.totalQuantity, sellingPrice: items.length === 1 ? items[0].sellingPrice : 0, capitalPrice: items.length === 1 ? items[0].capitalPrice : 0 } : { productName: "Withholding tax", quantity: 0, sellingPrice: 0, capitalPrice: 0 }),
    tiktokFees, withholdingTax, ...totals,
  };
};

export const createSale = async (req, res, next) => {
  try {
    const date = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(date.getTime())) return res.status(400).json({ message: "Invalid sale date." });
    const sale = await runTransaction(async (session) => {
      const items = await buildItems(parseItems(req.body), session, parseMoney(req.body.tiktokFees, "TikTok fees"), parseMoney(req.body.withholdingTax, "Withholding tax"));
      const values = toSaleValues(req.body, items, date);
      const [created] = await Sale.create([{ ...values, items: items.length ? items.map(({ product, ...item }) => item) : undefined }], { session });
      await adjustStock(items, session, -1, "Sale transaction", created._id);
      return created;
    });
    res.status(201).json(sale);
  } catch (e) { next(e); }
};

export const getSales = async (_req, res, next) => {
  try { res.json(await Sale.find().sort({ date: -1, createdAt: -1 })); } catch (e) { next(e); }
};

export const getSaleById = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid sale ID." });
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: "Sale not found." });
    res.json(sale);
  } catch (e) { next(e); }
};

export const updateSale = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid sale ID." });
    const updated = await runTransaction(async (session) => {
      const sale = await Sale.findById(req.params.id).session(session);
      if (!sale) throw error("Sale not found.", 404);
      const oldItems = sale.items?.length ? sale.items : sale.productId ? [{ productId: sale.productId, quantity: sale.quantity }] : [];
      const rawItems = parseItems(req.body, sale);
      const fee = parseMoney(req.body.tiktokFees ?? sale.tiktokFees, "TikTok fees");
      const tax = parseMoney(req.body.withholdingTax ?? sale.withholdingTax, "Withholding tax");
      const items = await buildItems(rawItems, session, fee, tax);
      const date = req.body.date ? new Date(req.body.date) : sale.date;
      if (Number.isNaN(date.getTime())) throw error("Invalid sale date.");
      await adjustStock(oldItems, session, 1, "Sale updated", sale._id);
      await adjustStock(items, session, -1, "Sale updated", sale._id);
      Object.assign(sale, toSaleValues({ ...req.body, tiktokFees: fee, withholdingTax: tax }, items, date, sale), { items: items.length ? items.map(({ product, ...item }) => item) : undefined });
      await sale.save({ session });
      return sale;
    });
    res.json(updated);
  } catch (e) { next(e); }
};

export const deleteSale = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid sale ID." });
    const deleted = await runTransaction(async (session) => {
      const sale = await Sale.findById(req.params.id).session(session);
      if (!sale) return null;
      const items = sale.items?.length ? sale.items : sale.productId ? [{ productId: sale.productId, quantity: sale.quantity }] : [];
      await adjustStock(items, session, 1, "Sale deleted", sale._id);
      await Sale.deleteOne({ _id: sale._id }, { session });
      return sale;
    });
    if (!deleted) return res.status(404).json({ message: "Sale not found." });
    res.json({ message: "Sale deleted successfully." });
  } catch (e) { next(e); }
};
