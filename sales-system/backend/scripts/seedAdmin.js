import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import connectDatabase from "../config/database.js";
import User from "../models/User.js";
import mongoose from "mongoose";

dotenv.config();

const run = async () => {
  const required = ["ADMIN_NAME", "ADMIN_USERNAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  if (process.env.ADMIN_PASSWORD.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  await connectDatabase();
  const username = process.env.ADMIN_USERNAME.trim().toLowerCase();
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    console.log("An account with the configured admin username or email already exists. No changes made.");
    return;
  }
  await User.create({ name: process.env.ADMIN_NAME, username, email, role: "admin", password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12) });
  console.log("Initial admin account created.");
};

run()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
