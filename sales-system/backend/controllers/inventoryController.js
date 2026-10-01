import mongoose from "mongoose";
import InventoryMovement from "../models/InventoryMovement.js";
import Product from "../models/Product.js";
import { getSettingsDocument } from "./settingsController.js";

const validId = (id) => mongoose.isValidObjectId(id);
const movementTypes = new Set(["STOCK_IN", "STOCK_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "SALE", "SALE_CANCELLATION"]);

const parseQuantity = (value, label = "Quantity") => {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    const error = new Error(`${label} must be a positive whole number.`);
    error.statusCode = 400;
    throw error;
  }
  return quantity;
};

const getProductOrThrow = async (id, session) => {
  if (!validId(id)) {
    const error = new Error("Invalid product ID.");
    error.statusCode = 400;
    throw error;
  }
  const product = await Product.findById(id).session(session);
  if (!product) {
    const error = new Error("Product not found.");
    error.statusCode = 404;
    throw error;
  }
  return product;
};

const saveMovement = (product, type, quantity, previousStock, reason, referenceId, session) =>
  InventoryMovement.create([{
    productId: product._id,
    productName: product.name,
    type,
    quantity,
    previousStock,
    newStock: product.stock,
    reason,
    ...(referenceId ? { referenceId } : {}),
  }], { session });

const runInventoryOperation = async (operation, res, next) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    res.json(result);
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
};

export const getInventory = async (_req, res, next) => {
  try {
    const products = await Product.find().sort({ name: 1 }).lean();
    const settings = await getSettingsDocument();
    const lowStockThreshold = settings.lowStockThreshold;
    res.json({
      summary: {
        totalProducts: products.length,
        totalStock: products.reduce((sum, product) => sum + product.stock, 0),
        lowStockProducts: products.filter((product) => product.stock > 0 && product.stock <= lowStockThreshold).length,
        outOfStockProducts: products.filter((product) => product.stock === 0).length,
      },
      lowStockThreshold,
      products,
    });
  } catch (error) { next(error); }
};

export const getInventoryByProduct = async (req, res, next) => {
  try {
    const product = await getProductOrThrow(req.params.productId, null);
    res.json(product);
  } catch (error) { next(error); }
};

export const getInventoryMovements = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.productId) {
      if (!validId(req.query.productId)) return res.status(400).json({ message: "Invalid product ID." });
      filter.productId = req.query.productId;
    }
    if (req.query.type) {
      if (!movementTypes.has(req.query.type)) return res.status(400).json({ message: "Invalid movement type." });
      filter.type = req.query.type;
    }
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(`${req.query.startDate}T00:00:00.000Z`);
      if (req.query.endDate) filter.createdAt.$lt = new Date(`${req.query.endDate}T23:59:59.999Z`);
    }
    res.json(await InventoryMovement.find(filter).sort({ createdAt: -1 }).limit(500).lean());
  } catch (error) { next(error); }
};

export const getProductMovements = async (req, res, next) => {
  req.query.productId = req.params.productId;
  return getInventoryMovements(req, res, next);
};

export const stockIn = async (req, res, next) => {
  const quantity = parseQuantity(req.body.quantity, "Stock-in quantity");
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ message: "A reason is required for stock-in." });
  await runInventoryOperation(async (session) => {
    const product = await getProductOrThrow(req.body.productId, session);
    const previousStock = product.stock;
    product.stock += quantity;
    await product.save({ session });
    await saveMovement(product, "STOCK_IN", quantity, previousStock, reason, null, session);
    return product;
  }, res, next);
};

export const adjustStock = async (req, res, next) => {
  const adjustment = Number(req.body.quantity);
  if (!Number.isInteger(adjustment) || adjustment === 0) return res.status(400).json({ message: "Adjustment must be a non-zero whole number." });
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ message: "A reason is required for stock adjustment." });
  await runInventoryOperation(async (session) => {
    const product = await getProductOrThrow(req.body.productId, session);
    const previousStock = product.stock;
    const newStock = previousStock + adjustment;
    if (newStock < 0) {
      const error = new Error(`Insufficient stock. Available quantity: ${previousStock}.`);
      error.statusCode = 400;
      throw error;
    }
    product.stock = newStock;
    await product.save({ session });
    await saveMovement(product, adjustment > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", Math.abs(adjustment), previousStock, reason, null, session);
    return product;
  }, res, next);
};
