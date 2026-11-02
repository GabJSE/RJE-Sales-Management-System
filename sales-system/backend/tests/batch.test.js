import test from "node:test";
import assert from "node:assert/strict";
import { forEachBatch } from "../services/batchService.js";

test("runs independent requests concurrently without exceeding the limit", async () => {
  let active = 0; let peak = 0; const processed = [];
  await forEachBatch([1, 2, 3, 4, 5, 6, 7], 3, async item => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    processed.push(item); active--;
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(processed.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test("waits for in-flight work on failure and does not start another batch", async () => {
  const started = []; let drained = false;
  await assert.rejects(forEachBatch([1, 2, 3], 2, async item => {
    started.push(item);
    if (item === 1) throw new Error("rate limited");
    await new Promise(resolve => setImmediate(resolve));
    drained = true;
  }), /rate limited/);
  assert.equal(drained, true);
  assert.deepEqual(started, [1, 2]);
});

test("empty input performs no requests and invalid limits fail", async () => {
  await forEachBatch([], 3, () => assert.fail("Unexpected request"));
  await assert.rejects(forEachBatch([1], 0, () => {}), RangeError);
});
