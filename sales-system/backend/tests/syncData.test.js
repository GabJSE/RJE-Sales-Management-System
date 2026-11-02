import test from "node:test";
import assert from "node:assert/strict";
import { cachedFinance, invalidateFinanceCache, financeCacheKey } from "../services/financeCacheService.js";
import { syncWindow, lowerTimeFilter, nextSyncToken, ownedFieldsChanged, syncBulkWrite } from "../services/syncDataService.js";
import { scheduleTikTokRequest, delayTikTokRequests } from "../services/tiktokRequestScheduler.js";

test("finance cache expires, isolates shops and queries, and bypasses pending data", async () => {
  let calls = 0; const load = async () => ({ version: ++calls }); const now = Date.now();
  assert.equal((await cachedFinance("cache-shop", "/order/1", { x: 1 }, load)).version, 1);
  assert.equal((await cachedFinance("cache-shop", "/order/1", { x: 1 }, load)).version, 1);
  assert.equal((await cachedFinance("cache-shop", "/order/1", { x: 1 }, load, { now: now + 400000 })).version, 2);
  assert.equal((await cachedFinance("other-shop", "/order/1", { x: 1 }, load)).version, 3);
  assert.equal((await cachedFinance("cache-shop", "/order/1", { x: 2 }, load)).version, 4);
  assert.equal((await cachedFinance("cache-shop", "/order/1", { x: 1 }, load, { bypass: true })).version, 5);
  invalidateFinanceCache("cache-shop");
  assert.equal((await cachedFinance("cache-shop", "/order/1", { x: 1 }, load)).version, 6);
  assert.equal(financeCacheKey("s", "/x", { b: 2, a: 1 }), financeCacheKey("s", "/x", { a: 1, b: 2 }));
});
test("identical concurrent requests coalesce; errors are never cached", async () => {
  let calls = 0;
  const load = async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return { rows: [] }; };
  await Promise.all(Array.from({ length: 5 }, () => cachedFinance("coalesce", "/x", {}, load)));
  assert.equal(calls, 1);
  const fail = () => cachedFinance("failure", "/x", {}, async () => { calls++; throw new Error("failure"); });
  await assert.rejects(fail()); await assert.rejects(fail()); assert.equal(calls, 3);
});
test("invalidation prevents an older in-flight response repopulating cache", async () => {
  let finish; const old = cachedFinance("invalidate", "/x", {}, () => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve)); invalidateFinanceCache("invalidate");
  assert.equal(await cachedFinance("invalidate", "/x", {}, async () => "new"), "new"); finish("old"); await old;
  assert.equal(await cachedFinance("invalidate", "/x", {}, async () => assert.fail("Expected new cache entry")), "new");
});
test("sync windows preserve global coverage and configurable overlap", () => {
  assert.equal(syncWindow().start.getTime(), 0);
  const checkpoint = new Date(Date.now() - 3600000);
  assert.equal(syncWindow({ checkpoint, overlap: 60000 }).start.getTime(), checkpoint.getTime() - 60000);
  assert.equal(syncWindow({ checkpoint, from: new Date(0) }).advance, false);
  assert.equal(syncWindow({ checkpoint, from: new Date(), forceFull: true }).start.getTime(), 0);
  assert.throws(() => syncWindow({ from: "bad" }), /Invalid/);
  const seen = new Set(); nextSyncToken("repeat", seen); assert.throws(() => nextSyncToken("repeat", seen), /repeated/);
});
test("unchanged business fields avoid database writes", async () => {
  assert.equal(ownedFieldsChanged({ title: "Same", lastSyncedAt: new Date(0) }, { title: "Same", lastSyncedAt: new Date() }), false);
  assert.equal(ownedFieldsChanged({ price: "10" }, { price: "11" }), true);
  await syncBulkWrite({ bulkWrite: () => assert.fail("No writes expected") }, []);
});
test("global request cap stays at three and shared cooldown delays subsequent work", async () => {
  let active = 0; let peak = 0;
  await Promise.all(Array.from({ length: 12 }, () => scheduleTikTokRequest("limit", async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--; })));
  assert.equal(peak, 3);
  delayTikTokRequests("cooldown", 500); let delay;
  await scheduleTikTokRequest("cooldown", async () => {}, async ms => { delay = ms; }); assert.ok(delay > 0 && delay <= 500);
});

test("a long Retry-After is returned to the job queue without another API attempt", async () => {
  const { tiktokRequest } = await import("../services/tiktokApiService.js"); let calls = 0;
  await assert.rejects(tiktokRequest("/fixture", {}, { config: () => ({ appKey: "long-cooldown", appSecret: "fixture", apiBaseUrl: "https://example.test" }), getToken: async () => "fixture", fetch: async () => { calls++; return new Response(JSON.stringify({ code: 104029 }), { status: 429, headers: { "retry-after": "30" } }); } }), error => error.statusCode === 503 && error.retryAfterMs === 30000);
  assert.equal(calls, 1);
});

test("full-history sentinels never become invalid zero API date filters", () => {
  for (const name of ["create_time_ge", "update_time_ge", "statement_time_ge"]) {
    assert.deepEqual(lowerTimeFilter(name, new Date(0)), {});
    assert.deepEqual(lowerTimeFilter(name, new Date("2026-10-01T00:00:00Z")), { [name]: 1790812800 });
  }
});
