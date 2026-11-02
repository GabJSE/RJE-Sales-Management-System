import crypto from "node:crypto";
import RevokedAuthToken from "../models/RevokedAuthToken.js";
import { passwordIssue, validEmail } from "../services/settingsValidation.js";
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
    const current = await User.findOneAndUpdate({ _id: user._id, password: user.password, isActive: true }, { $set: { lastLoginAt: new Date() } }, { new: true });
    if (!current) return res.status(401).json({ message: "Invalid username or password." });
    res.json({ token: signToken(current), user: publicUser(current) });
  } catch (error) { next(error); }
};

export const me = (req, res) => res.json({ ...publicUser(req.user), session: { issuedAt: req.authPayload?.iat ? new Date(req.authPayload.iat * 1000) : null, expiresAt: req.authPayload?.exp ? new Date(req.authPayload.exp * 1000) : null } });

export const changePassword = async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    const issue = passwordIssue(newPassword); if (issue) throw passwordError(issue);
    const user = await User.findById(req.user._id).select("+password");
    if (!user || !(await user.comparePassword(currentPassword))) return res.status(400).json({ message: "Current password is incorrect." });
    if (await user.comparePassword(newPassword)) throw passwordError("Choose a password different from the current password.");
    const updated = await User.findOneAndUpdate({ _id: user._id, password: user.password }, { $set: { password: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date() }, $inc: { tokenVersion: 1 } }, { new: true });
    if (!updated) throw Object.assign(new Error("Account credentials changed. Sign in again."), { statusCode: 409 });
    res.json({ message: "Password changed. Other sessions have been signed out.", token: signToken(updated), user: publicUser(updated) });
  } catch (error) { next(error); }
};

export const logout = async (req, res, next) => { try { if (req.authToken && req.authPayload?.exp) await RevokedAuthToken.updateOne({ digest: crypto.createHash("sha256").update(req.authToken).digest("hex") }, { $set: { expiresAt: new Date(req.authPayload.exp * 1000) } }, { upsert: true }); res.json({ message: "Signed out." }); } catch (error) { next(error); } };
export const logoutOthers = async (req, res, next) => { try { const user = await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } }, { new: true }); if (!user) return res.status(401).json({ message: "Your authentication session is invalid or expired." }); res.json({ token: signToken(user), user: publicUser(user), message: "Other sessions have been signed out." }); } catch (error) { next(error); } };

export const updateProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (req.body.name !== undefined) user.name = String(req.body.name).trim();
    if (req.body.email !== undefined) user.email = String(req.body.email).trim().toLowerCase();
    if (!validEmail(user.email)) return res.status(400).json({ message: "Enter a valid account email." });
    if (!user.name || !user.email) return res.status(400).json({ message: "Name and email are required." });
    await user.save();
    res.json(publicUser(user));
  } catch (error) { next(error); }
};
