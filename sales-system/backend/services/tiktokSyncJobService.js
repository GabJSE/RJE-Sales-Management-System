import crypto from "node:crypto";
import mongoose from "mongoose";
import Job from "../models/TikTokSyncJob.js";
import Shop from "../models/TikTokShop.js";
import { measureSync } from "./syncTelemetry.js";

export const publicSyncJob = job => ({
  _id: job._id, shopId: job.shopId, type: job.type, status: job.status, stage: job.stage, processed: job.processed, recordsProcessed: job.recordsProcessed, total: job.total, pages: job.pages,
  attempts: job.attempts, maxAttempts: job.maxAttempts, nextAttemptAt: job.nextAttemptAt, startedAt: job.startedAt, completedAt: job.completedAt,
  createdAt: job.createdAt, errorMessage: job.errorMessage, forceFull: job.options?.forceFull || false,
  durationMs: job.startedAt ? Math.max(0, new Date(job.completedAt || Date.now()) - new Date(job.startedAt)) : 0,
  apiDiagnostics: job.apiDiagnostics, performance: job.performance, result: job.status === "completed" ? job.result : undefined,
});
export const retryDelay = attempts => Math.min(300000, 5000 * 2 ** Math.max(0, attempts - 1));
export const retryableSyncError = error => !error.statusCode || [409, 429, 502, 503, 504].includes(error.statusCode);

export async function enqueueSync(type, options = {}, mode = "manual") {
  if (!["orders", "products", "settlements"].includes(type)) throw Object.assign(new Error("Invalid synchronization type."), { statusCode: 400 });
  const shop = await Shop.findOne({ key: "singleton" }).lean();
  if (!shop?.shopId || shop.status !== "connected") throw Object.assign(new Error("Connect TikTok Shop first."), { statusCode: 409 });
  const activeKey = `${shop.shopId}:${type}`;
  const clean = { ...(options.from ? { from: new Date(options.from) } : {}), ...(options.to ? { to: new Date(options.to) } : {}), forceFull: options.forceFull === true };
  if (Object.values(clean).some(value => value instanceof Date && !Number.isFinite(value.getTime())) || (clean.from && clean.to && clean.from > clean.to)) throw Object.assign(new Error("Invalid synchronization date range."), { statusCode: 400 });
  try { return publicSyncJob(await Job.create({ shopId: shop.shopId, type, options: clean, mode, activeKey })); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await Job.findOne({ activeKey }).lean();
    if (!existing) throw error;
    // Do not silently claim that a full or different-range request was accepted.
    const same = JSON.stringify(clean) === JSON.stringify({ ...(existing.options?.from ? { from: new Date(existing.options.from) } : {}), ...(existing.options?.to ? { to: new Date(existing.options.to) } : {}), forceFull: existing.options?.forceFull === true });
    if (!same && mode === "manual") throw Object.assign(new Error("A different synchronization is already queued or running. Wait for it to finish before requesting another range or full refresh."), { statusCode: 409 });
    return publicSyncJob(existing);
  }
}

export async function recoverExpiredJobs(now = new Date()) {
  // Replaying upserts is safe. An expired worker must also reacquire the service's shop lease.
  await Job.updateMany({ status: "running", leaseUntil: { $lte: now }, attempts: { $lt: 4 } }, { $set: { status: "pending", stage: "Recovering interrupted synchronization", nextAttemptAt: now }, $unset: { owner: 1, leaseUntil: 1 } });
  await Job.updateMany({ status: "running", leaseUntil: { $lte: now }, attempts: { $gte: 4 } }, { $set: { status: "failed", stage: "Failed after interruption", completedAt: now, errorMessage: "Synchronization was interrupted repeatedly. Start a new sync to retry." }, $unset: { activeKey: 1, owner: 1, leaseUntil: 1 } });
}

async function execute(job) {
  const options = { ...job.options, mode: job.mode };
  if (job.type === "orders") return (await import("./tiktokOrderService.js")).syncTikTokOrders(options);
  if (job.type === "products") return (await import("./tiktokProductService.js")).syncProducts(options);
  return (await import("./tiktokSettlementService.js")).syncTikTokSettlements(options);
}

export async function runNextSyncJob({ run = execute } = {}) {
  await recoverExpiredJobs();
  const owner = crypto.randomUUID(); const leaseMs = 120000;
  const job = await Job.findOneAndUpdate({ status: "pending", $or: [{ nextAttemptAt: { $lte: new Date() } }, { stage: "Waiting for previous sync lease", updatedAt: { $lte: new Date(Date.now() - 30000) } }] }, { $set: { status: "running", stage: "Starting", owner, leaseUntil: new Date(Date.now() + leaseMs), startedAt: new Date(), processed: 0, pages: 0 }, $unset: { errorMessage: 1, total: 1, recordsProcessed: 1 }, $inc: { attempts: 1 } }, { sort: { createdAt: 1 }, new: true }).lean();
  if (!job) return false;
  const filter = { _id: job._id, status: "running", owner };
  let leaseLost = false;
  const heartbeat = setInterval(() => Job.updateOne(filter, { $set: { leaseUntil: new Date(Date.now() + leaseMs) } }).then(result => { if (result.matchedCount !== 1) leaseLost = true; }).catch(() => {}), 30000); heartbeat.unref?.();
  try {
    const shop = await Shop.findOne({ key: "singleton", shopId: job.shopId, status: "connected" }).lean();
    if (!shop) throw Object.assign(new Error("The shop for this synchronization is no longer connected."), { statusCode: 401 });
    const serviceLease = shop[{ orders: "orderSyncLeaseUntil", products: "syncLeaseUntil", settlements: "settlementSyncLeaseUntil" }[job.type]];
    if (serviceLease && new Date(serviceLease) > new Date()) {
      await Job.updateOne(filter, { $set: { status: "pending", stage: "Waiting for previous sync lease", nextAttemptAt: new Date(Math.min(new Date(serviceLease).getTime() + 1000, Date.now() + 30000)) }, $inc: { attempts: -1 }, $unset: { owner: 1, leaseUntil: 1 } });
      return true;
    }
    if (leaseLost) throw Object.assign(new Error("Synchronization job lease was lost."), { statusCode: 409 });
    const result = await measureSync(() => run(job), async progress => {
      if (leaseLost) throw Object.assign(new Error("Synchronization job lease was lost."), { statusCode: 409 });
      const changed = await Job.updateOne(filter, { $set: { ...progress, leaseUntil: new Date(Date.now() + leaseMs) } });
      if (changed.matchedCount !== 1) throw new Error("Synchronization job lease was lost.");
    });
    if (leaseLost) throw Object.assign(new Error("Synchronization job lease was lost."), { statusCode: 409 });
    const completed = await Job.updateOne(filter, { $set: { status: "completed", stage: "Completed", completedAt: new Date(), result, performance: result.performance }, $unset: { activeKey: 1, owner: 1, leaseUntil: 1 } });
    if (completed.matchedCount !== 1) throw Object.assign(new Error("Synchronization job lease was lost."), { statusCode: 409 });
  } catch (error) {
    const retry = retryableSyncError(error) && job.attempts < job.maxAttempts;
    await Job.updateOne(filter, { $set: { status: retry ? "pending" : "failed", stage: retry ? "Waiting to retry" : "Failed", errorMessage: String(error.statusCode ? error.message : "Synchronization failed unexpectedly. Check server logs and retry.").slice(0, 500), nextAttemptAt: new Date(Date.now() + Math.max(retryDelay(job.attempts), error.retryAfterMs || 0)), ...(!retry ? { completedAt: new Date() } : {}), apiDiagnostics: error.apiDiagnostics, performance: error.syncPerformance, failedRecords: error.failedRecords }, $unset: { owner: 1, leaseUntil: 1, ...(!retry ? { activeKey: 1 } : {}) } });
  } finally { clearInterval(heartbeat); }
  return true;
}
let timer; let busy = false;
export async function startSyncWorker() {
  if (timer) return;
  // Build the uniqueness constraint before accepting work; no Redis service required.
  await Job.init();
  let failures = 0; let nextPollAt = 0;
  const tick = async () => {
    if (busy || mongoose.connection.readyState !== 1 || Date.now() < nextPollAt) return;
    busy = true;
    try {
      await runNextSyncJob();
      failures = 0; nextPollAt = 0;
    } catch (error) {
      failures++;
      const delay = retryDelay(failures);
      nextPollAt = Date.now() + delay;
      // Log diagnostic codes, never raw driver messages that may contain connection credentials.
      console.error("TikTok sync worker failed:", { name: error.name, code: error.code, causeCode: error.cause?.code, retryInMs: delay });
    } finally { busy = false; }
  };
  timer = setInterval(tick, 2000); timer.unref?.(); void tick();
}
