import crypto from "node:crypto";
import RevokedAuthToken from "../models/RevokedAuthToken.js";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const getSecret = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured.");
  return process.env.JWT_SECRET;
};

export const signToken = (user) => jwt.sign({ sub: user._id.toString(), version: user.tokenVersion || 0 }, getSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || "1d", jwtid: crypto.randomUUID() });

export const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication is required." });
    const token = header.slice(7); const payload = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    if (await RevokedAuthToken.exists({ digest: crypto.createHash("sha256").update(token).digest("hex") })) return res.status(401).json({ message: "Your authentication session is invalid or expired." });
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) return res.status(401).json({ message: "Your account is inactive or no longer exists." });
    if ((payload.version || 0) !== (user.tokenVersion || 0)) return res.status(401).json({ message: "Your authentication session is invalid or expired." });
    req.authPayload = payload; req.authToken = token; req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") return res.status(401).json({ message: "Your authentication session is invalid or expired." });
    next(error);
  }
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: "You do not have permission to perform this action." });
  next();
};

export const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  username: user.username,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt, lastLoginAt: user.lastLoginAt || null,
  updatedAt: user.updatedAt,
});
