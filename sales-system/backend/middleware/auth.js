import jwt from "jsonwebtoken";
import User from "../models/User.js";

const getSecret = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured.");
  return process.env.JWT_SECRET;
};

export const signToken = (user) => jwt.sign({ sub: user._id.toString() }, getSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || "1d" });

export const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication is required." });
    const payload = jwt.verify(header.slice(7), getSecret());
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) return res.status(401).json({ message: "Your account is inactive or no longer exists." });
    req.user = user;
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
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
