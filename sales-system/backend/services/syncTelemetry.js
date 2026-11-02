import { AsyncLocalStorage } from "node:async_hooks";
const context = new AsyncLocalStorage();
export const syncContext = context;
export const countSync = (name, count = 1) => { const state = context.getStore(); if (state) state.metrics[name] = (state.metrics[name] || 0) + count; };
export const reportSync = async progress => { const state = context.getStore(); if (state?.report) await state.report(progress); };
export async function measureSync(task, report) {
  const state = { metrics: { apiRequests: 0, databaseBatches: 0, databaseRecords: 0, cacheHits: 0 }, report };
  const started = performance.now(); const memory = process.memoryUsage().heapUsed;
  return context.run(state, async () => {
    try { const result = await task(); return { ...result, performance: { ...state.metrics, durationMs: Math.round(performance.now() - started), heapDeltaBytes: process.memoryUsage().heapUsed - memory } }; }
    catch (error) { error.syncPerformance = { ...state.metrics, durationMs: Math.round(performance.now() - started) }; throw error; }
  });
}
