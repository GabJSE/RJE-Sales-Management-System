import mongoose from "mongoose";
import Product from "../models/Product.js";
import Sale from "../models/Sale.js";
import InventoryMovement from "../models/InventoryMovement.js";

const validateSaleId = (id) => mongoose.isValidObjectId(id);

const getProductDisplayName = (product) =>
  product.brand
    ? `${product.brand} ${product.category || ""} ${product.model || ""}`.replace(/\s+/g, " ").trim()
    : product.name;

const calculateSale = ({ quantity, sellingPrice, capitalPrice, tiktokFees, withholdingTax }) => {
  const totalSales = quantity * sellingPrice;
  const totalCapital = quantity * capitalPrice;
  const netSales = totalSales - tiktokFees - withholdingTax;
  const profit = netSales - totalCapital;
  const profitMargin = netSales === 0 ? 0 : (profit / netSales) * 100;

  return { totalSales, totalCapital, netSales, profit, profitMargin };
};

const parseSaleInputs = (body, { allowZeroQuantity = false } = {}) => {
  const quantity = Number(body.quantity);
  const tiktokFees = Number(body.tiktokFees ?? 0);
  const withholdingTax = Number(body.withholdingTax ?? 0);

  if (!Number.isInteger(quantity) || quantity < 0 || (!allowZeroQuantity && quantity === 0)) {
    const error = new Error("Quantity must be a whole number greater than zero.");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isFinite(tiktokFees) || tiktokFees < 0) {
    const error = new Error("TikTok fees cannot be negative.");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isFinite(withholdingTax) || withholdingTax < 0) {
    const error = new Error("Withholding tax cannot be negative.");
    error.statusCode = 400;
    throw error;
  }

  return { quantity, tiktokFees, withholdingTax };
};

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
    productName: getProductDisplayName(product),
    type,
    quantity,
    previousStock,
    newStock: product.stock,
    reason,
    referenceId,
  }], { session });

export const createSale = async (req, res, next) => {
  try {
    const isWithholdingOnly = !req.body.productId;
    const { quantity, tiktokFees, withholdingTax } = parseSaleInputs(
      isWithholdingOnly ? { ...req.body, quantity: 0 } : req.body,
      { allowZeroQuantity: isWithholdingOnly }
    );
    if (isWithholdingOnly && withholdingTax <= 0) {
      return res.status(400).json({ message: "Select a product or enter a withholding tax amount." });
    }

    const date = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: "Invalid sale date." });
    }

    let product = null;
    if (!isWithholdingOnly) {
      if (!mongoose.isValidObjectId(req.body.productId)) {
        return res.status(400).json({ message: "Invalid product ID." });
      }
      product = await Product.findById(req.body.productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found." });
      }
      if (quantity <= 0) {
        return res.status(400).json({ message: "Quantity must be a whole number greater than zero." });
      }
    }

    const sale = await runTransaction(async (session) => {
      let saleProduct = product;
      if (saleProduct) {
        saleProduct = await Product.findOneAndUpdate(
          { _id: saleProduct._id, stock: { $gte: quantity } },
          { $inc: { stock: -quantity } },
          { new: true, session }
        );
        if (!saleProduct) {
          const current = await Product.findById(product._id).session(session);
          const error = new Error(`Insufficient stock. Available quantity: ${current?.stock ?? 0}.`);
          error.statusCode = 400;
          throw error;
        }
      }
      const values = {
        date,
        ...(saleProduct ? { productId: saleProduct._id } : {}),
        productName: saleProduct ? getProductDisplayName(saleProduct) : "Withholding tax",
        quantity: saleProduct ? quantity : 0,
        sellingPrice: saleProduct ? saleProduct.sellingPrice : 0,
        capitalPrice: saleProduct ? saleProduct.capitalPrice : 0,
        tiktokFees,
        withholdingTax,
        ...calculateSale({ quantity: saleProduct ? quantity : 0, sellingPrice: saleProduct ? saleProduct.sellingPrice : 0, capitalPrice: saleProduct ? saleProduct.capitalPrice : 0, tiktokFees, withholdingTax }),
      };
      const [createdSale] = await Sale.create([values], { session });
      if (saleProduct) await addMovement(saleProduct, "SALE", quantity, saleProduct.stock + quantity, "Sale transaction", createdSale._id, session);
      return createdSale;
    });
    res.status(201).json(sale);
  } catch (error) {
    next(error);
  }
};

export const getSales = async (_req, res, next) => {
  try {
    const sales = await Sale.find().sort({ date: -1, createdAt: -1 });
    res.json(sales);
  } catch (error) {
    next(error);
  }
};

export const getSaleById = async (req, res, next) => {
  try {
    if (!validateSaleId(req.params.id)) {
      return res.status(400).json({ message: "Invalid sale ID." });
    }
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: "Sale not found." });
    res.json(sale);
  } catch (error) {
    next(error);
  }
};

export const updateSale = async (req, res, next) => {
  try {
    if (!validateSaleId(req.params.id)) {
      return res.status(400).json({ message: "Invalid sale ID." });
    }
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: "Sale not found." });

    const isWithholdingOnly = !sale.productId;
    const requestedProductId = req.body.productId || sale.productId;
    const { quantity, tiktokFees, withholdingTax } = parseSaleInputs({
      quantity: req.body.quantity ?? sale.quantity,
      tiktokFees: req.body.tiktokFees ?? sale.tiktokFees,
      withholdingTax: req.body.withholdingTax ?? sale.withholdingTax ?? 0,
    }, { allowZeroQuantity: isWithholdingOnly });
    if (isWithholdingOnly && withholdingTax <= 0) {
      return res.status(400).json({ message: "Withholding tax must be greater than zero." });
    }
    const date = req.body.date ? new Date(req.body.date) : sale.date;
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: "Invalid sale date." });
    }

    const updatedSale = await runTransaction(async (session) => {
      if (isWithholdingOnly) {
        Object.assign(sale, { date, quantity: 0, tiktokFees, withholdingTax, ...calculateSale({ quantity: 0, sellingPrice: 0, capitalPrice: 0, tiktokFees, withholdingTax }) });
      } else {
        if (!mongoose.isValidObjectId(requestedProductId)) {
          return Promise.reject(Object.assign(new Error("Invalid product ID."), { statusCode: 400 }));
        }
        const originalProduct = await Product.findOneAndUpdate(
          { _id: sale.productId, stock: { $gte: 0 } },
          { $inc: { stock: sale.quantity } },
          { new: true, session }
        );
        if (!originalProduct) return Promise.reject(Object.assign(new Error("Product not found."), { statusCode: 404 }));
        const updatedProduct = await Product.findOneAndUpdate(
          { _id: requestedProductId, stock: { $gte: quantity } },
          { $inc: { stock: -quantity } },
          { new: true, session }
        );
        if (!updatedProduct) {
          const current = await Product.findById(requestedProductId).session(session);
          return Promise.reject(Object.assign(new Error(current ? `Insufficient stock. Available quantity: ${current.stock}.` : "Product not found."), { statusCode: current ? 400 : 404 }));
        }
        if (sale.quantity !== quantity || String(requestedProductId) !== String(sale.productId)) {
          await addMovement(originalProduct, "SALE_CANCELLATION", sale.quantity, originalProduct.stock - sale.quantity, "Sale updated", sale._id, session);
          await addMovement(updatedProduct, "SALE", quantity, updatedProduct.stock + quantity, "Sale quantity updated", sale._id, session);
        }
        Object.assign(sale, { date, productId: updatedProduct._id, productName: getProductDisplayName(updatedProduct), quantity, sellingPrice: updatedProduct.sellingPrice, capitalPrice: updatedProduct.capitalPrice, tiktokFees, withholdingTax, ...calculateSale({ quantity, sellingPrice: updatedProduct.sellingPrice, capitalPrice: updatedProduct.capitalPrice, tiktokFees, withholdingTax }) });
      }
      await sale.save({ session });
      return sale;
    });
    res.json(updatedSale);
  } catch (error) {
    next(error);
  }
};

export const deleteSale = async (req, res, next) => {
  try {
    if (!validateSaleId(req.params.id)) {
      return res.status(400).json({ message: "Invalid sale ID." });
    }
    const sale = await runTransaction(async (session) => {
      const existingSale = await Sale.findById(req.params.id).session(session);
      if (!existingSale) return null;
      if (existingSale.productId && existingSale.quantity > 0) {
        const product = await Product.findByIdAndUpdate(existingSale.productId, { $inc: { stock: existingSale.quantity } }, { new: true, session });
        if (!product) return Promise.reject(Object.assign(new Error("Product not found."), { statusCode: 404 }));
        await addMovement(product, "SALE_CANCELLATION", existingSale.quantity, product.stock - existingSale.quantity, "Sale deleted", existingSale._id, session);
      }
      await Sale.deleteOne({ _id: existingSale._id }, { session });
      return existingSale;
    });
    if (!sale) return res.status(404).json({ message: "Sale not found." });
    res.json({ message: "Sale deleted successfully." });
  } catch (error) {
    next(error);
  }
};
