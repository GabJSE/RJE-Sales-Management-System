import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Job from "../models/TikTokSyncJob.js";
import { startSyncWorker } from "../services/tiktokSyncJobService.js";

test("worker pauses while disconnected, backs off failures, and resumes polling", async t => {
  let state = 0; let now = 1000; let tick; let calls = 0; const logs = [];
  const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  Object.defineProperty(mongoose.connection, "readyState", { configurable: true, get: () => state });
  t.after(() => { if (descriptor) Object.defineProperty(mongoose.connection, "readyState", descriptor); else delete mongoose.connection.readyState; });
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", callback => { tick = callback; return { unref() {} }; });
  t.mock.method(console, "error", (...args) => logs.push(args));
  t.mock.method(Job, "init", async () => {});
  t.mock.method(Job, "updateMany", async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("mongodb://secret-credentials"), { name: "MongoNetworkError", cause: { code: "ECONNRESET" } });
  });
  t.mock.method(Job, "findOneAndUpdate", () => ({ lean: async () => null }));
  await startSyncWorker(); assert.equal(calls, 0);
  state = 1; await tick(); assert.equal(calls, 1);
  assert.equal(logs[0][1].causeCode, "ECONNRESET");
  assert.equal(logs[0][1].retryInMs, 5000);
  assert.ok(!JSON.stringify(logs).includes("secret-credentials"));
  await tick(); assert.equal(calls, 1);
  now += 5000; await tick(); assert.equal(calls, 3);
  await tick(); assert.equal(calls, 5);
  state = 0; await tick(); assert.equal(calls, 5);
});
