import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../models/User.js";
import { publicUser } from "../middleware/auth.js";

const getUser = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error("Invalid user ID."), { statusCode: 400 });
  const user = await User.findById(id).select("+password");
  if (!user) throw Object.assign(new Error("User not found."), { statusCode: 404 });
  return user;
};
const validatePassword = (password) => {
  if (typeof password !== "string" || password.length < 8) throw Object.assign(new Error("Password must be at least 8 characters."), { statusCode: 400 });
};
const activeAdminCount = () => User.countDocuments({ role: "admin", isActive: true });

export const listUsers = async (_req, res, next) => {
  try { res.json((await User.find().sort({ createdAt: -1 })).map(publicUser)); } catch (error) { next(error); }
};
export const getUserById = async (req, res, next) => {
  try { res.json(publicUser(await getUser(req.params.id))); } catch (error) { next(error); }
};
export const createUser = async (req, res, next) => {
  try {
    const { name, username, email, role = "staff", password } = req.body;
    if (!name || !username || !email || !["admin", "staff"].includes(role)) return res.status(400).json({ message: "Name, username, email, and a valid role are required." });
    validatePassword(password);
    const user = await User.create({ name, username, email, role, password: await bcrypt.hash(password, 12) });
    res.status(201).json(publicUser(user));
  } catch (error) { next(error); }
};
export const updateUser = async (req, res, next) => {
  try {
    const user = await getUser(req.params.id);
    const nextRole = req.body.role ?? user.role;
    const nextActive = req.body.isActive ?? user.isActive;
    if (!["admin", "staff"].includes(nextRole)) return res.status(400).json({ message: "Invalid role." });
    if (user._id.equals(req.user._id) && nextActive === false) return res.status(400).json({ message: "You cannot deactivate your own account." });
    if (user.role === "admin" && user.isActive && (nextRole !== "admin" || nextActive === false) && await activeAdminCount() <= 1) return res.status(400).json({ message: "The last active admin cannot be removed or deactivated." });
    Object.assign(user, { name: req.body.name ?? user.name, username: req.body.username ?? user.username, email: req.body.email ?? user.email, role: nextRole, isActive: nextActive });
    await user.save();
    res.json(publicUser(user));
  } catch (error) { next(error); }
};
export const updateStatus = async (req, res, next) => {
  req.body.isActive = Boolean(req.body.isActive);
  return updateUser(req, res, next);
};
export const resetPassword = async (req, res, next) => {
  try {
    const user = await getUser(req.params.id);
    validatePassword(req.body.password);
    user.password = await bcrypt.hash(req.body.password, 12);
    await user.save();
    res.json({ message: "Password reset successfully." });
  } catch (error) { next(error); }
};
