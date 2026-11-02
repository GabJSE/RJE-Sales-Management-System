import userRoutes from "../routes/userRoutes.js";
﻿import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import authRoutes from "../routes/authRoutes.js";
import settingsRoutes from "../routes/settingsRoutes.js";
import tiktokRoutes from "../routes/tiktokRoutes.js";
import dashboardRoutes from "../routes/dashboardRoutes.js";
import { authenticate, signToken } from "../middleware/auth.js";
import User from "../models/User.js";
import Settings from "../models/SystemSettings.js";
import Shop from "../models/TikTokShop.js";
import Job from "../models/TikTokSyncJob.js";
import Mapping from "../models/TikTokProductMapping.js";
import Revoked from "../models/RevokedAuthToken.js";
let mongo; let server; let base; let admin; let staff; let token; let staffToken;
before(async () => {
  process.env.JWT_SECRET = "isolated-settings-test-secret"; process.env.JWT_EXPIRES_IN = "1h";
  mongo = await MongoMemoryServer.create({ binary: { downloadDir: fileURLToPath(new URL("../node_modules/.cache/mongodb-memory-server", import.meta.url)) } }); await mongoose.connect(mongo.getUri("settings_tests"));
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const app = express(); app.use(express.json()); app.use("/api/auth", authRoutes); app.use("/api/users", userRoutes); app.use("/api/settings", settingsRoutes); app.use("/api/tiktok", tiktokRoutes); app.use("/api/dashboard", authenticate, dashboardRoutes); app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  server = await new Promise(resolve => { const running = app.listen(0, "127.0.0.1", () => resolve(running)); }); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map(model => model.deleteMany({})));
  const password = await bcrypt.hash("original test passphrase", 4);
  admin = await User.create({ name: "Admin", username: "admin", email: "admin@example.test", password, role: "admin" }); staff = await User.create({ name: "Staff", username: "staff", email: "staff@example.test", password, role: "staff" }); token = signToken(admin); staffToken = signToken(staff);
});
async function api(path, method = "GET", body, auth = token) { const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: await response.json() }; }

test("business and preference updates persist without replacing unrelated saved values", async () => {
  await Settings.create({ businessName: "Existing shop", address: "Preserved address", lowStockThreshold: 9 });
  const result = await api("/api/settings/business", "PUT", { businessName: "Updated shop", contactNumber: "+63 (917) 123-4567", email: "SHOP@example.test" });
  assert.equal(result.status, 200); assert.equal(result.data.address, "Preserved address"); assert.equal(result.data.contactNumber, "+639171234567");
  assert.equal((await api("/api/settings")).data.email, "shop@example.test");
  const prefs = await api("/api/settings/preferences", "PUT", { currency: "USD", currencySymbol: "WRONG", timezone: "UTC", dateFormat: "YYYY-MM-DD" });
  assert.equal(prefs.data.currencySymbol, "$"); assert.equal(prefs.data.lowStockThreshold, 9); assert.equal(await Settings.countDocuments(), 1);
});
test("settings validate contacts, dates, threshold and booleans with field-level errors", async () => {
  for (const [section, body, field] of [["business", {email:"invalid"}, "email"], ["business", {contactNumber:"123"}, "contactNumber"], ["preferences", {timezone:"Not/AZone"}, "timezone"], ["inventory", {lowStockThreshold:1.5}, "lowStockThreshold"], ["inventory", {enableLowStockAlerts:"false"}, "enableLowStockAlerts"]]) { const result = await api(`/api/settings/${section}`, "PUT", body); assert.equal(result.status, 400); assert.ok(result.data.errors[field]); }
  assert.equal((await api("/api/settings/constructor", "PUT", {})).status, 400);
});
test("settings mutations require an authenticated administrator", async () => {
  assert.equal((await api("/api/settings", "GET", undefined, null)).status, 401);
  assert.equal((await api("/api/settings/inventory", "PUT", {lowStockThreshold:99}, staffToken)).status, 403);
  assert.equal((await api("/api/settings", "GET", undefined, staffToken)).status, 200);
  assert.equal((await Settings.findOne()).lowStockThreshold, 5);
});
test("stock alerts obey enabled flag without changing TikTok quantities", async () => {
  await Shop.create({shopId:"shop",status:"connected"}); await Mapping.create({shopId:"shop",tiktokProductId:"p",tiktokSkuId:"s",stock:2,status:"ACTIVATE"});
  await api("/api/settings/inventory", "PUT", {lowStockThreshold:3,enableLowStockAlerts:true});
  assert.ok((await api("/api/dashboard")).data.alerts.some(row=>row.label.includes("low stock")));
  await api("/api/settings/inventory", "PUT", {lowStockThreshold:3,enableLowStockAlerts:false});
  assert.ok(!(await api("/api/dashboard")).data.alerts.some(row=>row.label.includes("low stock")));
  assert.equal((await Mapping.findOne()).stock, 2);
});
test("integration status is sanitized and supported actions remain authorized and queued", async () => {
  await Shop.create({shopId:"shop",shopName:"Fixture Shop",region:"PH",status:"connected",shopCipher:"secret-cipher",scopes:["seller.finance.info"],accessToken:{value:"secret-access",iv:"iv",tag:"tag"},refreshToken:{value:"secret-refresh",iv:"iv",tag:"tag"}});
  const status = await api("/api/tiktok/status"); assert.equal(status.data.shopName,"Fixture Shop"); assert.ok(!JSON.stringify(status.data).includes("secret-"));
  for(const path of ["orders","products","finance"]) assert.equal((await api(`/api/tiktok/${path}/sync`,"POST",{})).status,202);
  assert.equal(await Job.countDocuments(),3);
  assert.equal((await api("/api/tiktok/disconnect","POST",{},staffToken)).status,403);
  assert.equal((await api("/api/tiktok/disconnect","POST",{})).status,200);
  assert.equal((await api("/api/tiktok/status")).data.connected,false);
});
test("password changes verify current password, hash new credentials and invalidate earlier tokens", async () => {
  const other = signToken(admin);
  assert.equal((await api("/api/auth/change-password","PUT",{currentPassword:"wrong",newPassword:"a new unique passphrase"})).status,400);
  assert.equal((await api("/api/auth/change-password","PUT",{currentPassword:"original test passphrase",newPassword:"short"})).status,400);
  const changed = await api("/api/auth/change-password","PUT",{currentPassword:"original test passphrase",newPassword:"a new unique passphrase"});
  assert.equal(changed.status,200); assert.ok(changed.data.token);
  assert.equal((await api("/api/auth/me","GET",undefined,other)).status,401);
  assert.equal((await api("/api/auth/me","GET",undefined,changed.data.token)).status,200);
  const saved = await User.findById(admin._id).select("+password"); assert.notEqual(saved.password,"a new unique passphrase"); assert.equal(await saved.comparePassword("a new unique passphrase"),true);
});
test("logout revokes only the supplied token and logout-others retains a replacement current token", async () => {
  const other=signToken(admin);
  assert.equal((await api("/api/auth/logout","POST",{})).status,200);
  assert.equal((await api("/api/auth/me")).status,401);
  assert.equal((await api("/api/auth/me","GET",undefined,other)).status,200);
  const revoked=await Revoked.findOne().lean(); assert.equal(revoked.digest.length,64); assert.ok(!JSON.stringify(revoked).includes(token));
  const result=await api("/api/auth/logout-others","POST",{},other); assert.equal(result.status,200);
  assert.equal((await api("/api/auth/me","GET",undefined,other)).status,401);
  assert.equal((await api("/api/auth/me","GET",undefined,result.data.token)).status,200);
});
test("last-login and current-token metadata are real and sensitive endpoints throttle requests", async () => {
  const logged=await api("/api/auth/login","POST",{username:"admin",password:"original test passphrase"},null); assert.equal(logged.status,200);
  const me=await api("/api/auth/me","GET",undefined,logged.data.token); assert.ok(me.data.lastLoginAt); assert.ok(me.data.session.issuedAt); assert.ok(me.data.session.expiresAt);
  for(let i=0;i<5;i++) await api("/api/auth/change-password","PUT",{currentPassword:"wrong",newPassword:"a new unique passphrase"});
  assert.equal((await api("/api/auth/change-password","PUT",{currentPassword:"wrong",newPassword:"a new unique passphrase"})).status,429);
});

test("account profile changes require valid emails and never expose password hashes", async () => {
  assert.equal((await api("/api/auth/profile","PUT",{name:"Updated",email:"invalid"})).status,400);
  const result=await api("/api/auth/profile","PUT",{name:"Updated",email:"updated@example.test"}); assert.equal(result.status,200); assert.equal(result.data.email,"updated@example.test"); assert.equal(result.data.password,undefined);
  assert.equal((await User.findById(admin._id)).name,"Updated");
});

test("admin password resets invalidate prior target sessions without revoking the admin", async () => {
  const body = {password:"new unique staff passphrase"};
  assert.equal((await api(`/api/users/${staff._id}/reset-password`,"PATCH",body,staffToken)).status,403);
  assert.equal((await api(`/api/users/${staff._id}/reset-password`,"PATCH",body)).status,200);
  assert.equal((await api("/api/auth/me","GET",undefined,staffToken)).status,401);
  assert.equal((await api("/api/auth/me")).status,200);
});
