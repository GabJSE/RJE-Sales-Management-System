import mongoose from "mongoose";
import Product from "../models/Product.js";

const validateProductId = (id) => mongoose.isValidObjectId(id);

export const getProducts = async (_req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    next(error);
  }
};

export const getProduct = async (req, res, next) => {
  try {
    if (!validateProductId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (data.brand || data.category || data.model) {
      data.name = `${data.brand || ""} ${data.category || ""} ${data.model || ""}`.trim();
    }
    const product = await Product.create(data);
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    if (!validateProductId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const data = { ...req.body };
    delete data.stock;
    if (data.brand || data.category || data.model) {
      data.name = `${data.brand || ""} ${data.category || ""} ${data.model || ""}`.trim();
    }
    const product = await Product.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    if (!validateProductId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    res.json({ message: "Product deleted successfully." });
  } catch (error) {
    next(error);
  }
};
