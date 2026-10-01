import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { publicUser, signToken } from "../middleware/auth.js";

const passwordError = (message) => Object.assign(new Error(message), { statusCode: 400 });

export const login = async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!username || !password) return res.status(400).json({ message: "Username and password are required." });
    const user = await User.findOne({ username }).select("+password");
    if (!user || !(await user.comparePassword(password))) return res.status(401).json({ message: "Invalid username or password." });
    if (!user.isActive) return res.status(403).json({ message: "This account is inactive." });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (error) { next(error); }
};

export const me = (req, res) => res.json(publicUser(req.user));

export const changePassword = async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 8) throw passwordError("New password must be at least 8 characters.");
    const user = await User.findById(req.user._id).select("+password");
    if (!user || !(await user.comparePassword(currentPassword))) return res.status(400).json({ message: "Current password is incorrect." });
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ message: "Password changed successfully." });
  } catch (error) { next(error); }
};

export const logout = (_req, res) => res.json({ message: "Logout completed. Clear the client session." });

export const updateProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (req.body.name !== undefined) user.name = String(req.body.name).trim();
    if (req.body.email !== undefined) user.email = String(req.body.email).trim().toLowerCase();
    if (!user.name || !user.email) return res.status(400).json({ message: "Name and email are required." });
    await user.save();
    res.json(publicUser(user));
  } catch (error) { next(error); }
};
