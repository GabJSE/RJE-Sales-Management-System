import mongoose from "mongoose";
import Shop from "../models/TikTokShop.js";
import Job from "../models/TikTokSyncJob.js";
import { enqueueSync, publicSyncJob } from "../services/tiktokSyncJobService.js";
const dateOnly = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export const queueSync = type => async (req, res, next) => { try {
  const { from, to, forceFull } = req.body || {};
  if ((from !== undefined && !dateOnly(from)) || (to !== undefined && !dateOnly(to)) || (forceFull !== undefined && typeof forceFull !== "boolean")) throw Object.assign(new Error("Use YYYY-MM-DD dates and a boolean forceFull option."), { statusCode: 400 });
  const options = { forceFull: forceFull === true, ...(!forceFull && from ? { from: new Date(`${from}T00:00:00+08:00`) } : {}), ...(!forceFull && to ? { to: new Date(`${to}T23:59:59.999+08:00`) } : {}) };
  const job = await enqueueSync(type, options);
  res.status(202).json({ jobId: job._id, job });
} catch (error) { next(error); } };
export const listSyncJobs = async (req, res, next) => { try {
  const shop = await Shop.findOne({ key: "singleton" }).lean();
  if (!shop?.shopId) return res.json({ jobs: [] });
  const filter = { shopId: shop.shopId, ...(req.query.type ? { type: String(req.query.type) } : {}) };
  const [active, recent] = await Promise.all([Job.find({ ...filter, status: { $in: ["pending", "running"] } }).lean(), Job.find(filter).sort({ createdAt: -1 }).limit(20).lean()]);
  const jobs = [...new Map([...active, ...recent].map(job => [String(job._id), job])).values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ jobs: jobs.map(publicSyncJob), lastSuccessful: { orders: shop.lastOrderSyncAt, products: shop.lastProductSyncAt, settlements: shop.lastSettlementSyncAt } });
} catch (error) { next(error); } };
export const getSyncJob = async (req, res, next) => { try {
  const shop = await Shop.findOne({ key: "singleton" }).lean();
  const job = mongoose.isValidObjectId(req.params.jobId) ? await Job.findOne({ _id: req.params.jobId, shopId: shop?.shopId }).lean() : null;
  if (!job) throw Object.assign(new Error("Synchronization job not found."), { statusCode: 404 });
  res.json({ job: publicSyncJob(job) });
} catch (error) { next(error); } };
