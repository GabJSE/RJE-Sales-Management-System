import { isDeepStrictEqual } from "node:util";
import { countSync } from "./syncTelemetry.js";
export const overlapMs = () => Math.max(60, Math.min(86400 * 7, Number(process.env.TIKTOK_SYNC_OVERLAP_SECONDS) || 300)) * 1000;
export function syncWindow({ checkpoint, from, to = new Date(), forceFull = false, overlap = overlapMs() } = {}) {
  const end = new Date(Math.min(new Date(to).getTime(), Date.now()));
  const start = forceFull ? new Date(0) : from ? new Date(from) : checkpoint ? new Date(Math.max(0, new Date(checkpoint).getTime() - overlap)) : new Date(0);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw Object.assign(new Error("Invalid synchronization date range."), { statusCode: 400 });
  return { start, end, full: forceFull || (!from && !checkpoint), advance: forceFull || !from };
}
// A zero date is an internal full-history sentinel, not a valid TikTok timestamp filter.
export const lowerTimeFilter = (name, date) => { const seconds = Math.floor(new Date(date).getTime() / 1000); return seconds > 0 ? { [name]: seconds } : {}; };
export function nextSyncToken(token, seen) {
  if (!token) return null;
  if (seen.has(token)) throw new Error("TikTok repeated a pagination token. Synchronization stopped.");
  seen.add(token); return token;
}
export const distinctBy = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];
export function ownedFieldsChanged(previous, next, ignored = ["lastSyncedAt", "lastSynchronizedAt"]) {
  return !previous || Object.entries(next).some(([key, value]) => !ignored.includes(key) && !isDeepStrictEqual(JSON.parse(JSON.stringify(previous[key] ?? null)), JSON.parse(JSON.stringify(value ?? null))));
}
// Unordered batches may partially succeed. Do not hide failures or advance a checkpoint.
export async function syncBulkWrite(model, operations, size = 250) {
  let matched = 0;
  for (let offset = 0; offset < operations.length; offset += size) {
    const batch = operations.slice(offset, offset + size);
    countSync("databaseBatches"); countSync("databaseRecords", batch.length);
    try { const result = await model.bulkWrite(batch, { ordered: false }); matched += result.matchedCount || 0; }
    catch (cause) {
      const failures = (cause.writeErrors || []).slice(0, 20).map(error => ({ record: batch[error.index]?.updateOne?.filter, code: error.code }));
      const error = new Error(`A synchronization database batch failed (${failures.length || "unknown"} records). Retry is safe.`);
      error.failedRecords = failures; error.statusCode = 503; throw error;
    }
  }
  return { matchedCount: matched };
}
