const API_URL = "/api/dashboard";
import { waitForTikTokSync } from "./tiktokSyncService.js";
import { request } from "./api.js";

export const getDashboard = async (startDate, endDate) => {
  const query = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : "";
  return request(`${API_URL}${query}`);
};
export const getTikTokAutomaticSyncStatus = () => request("/api/tiktok/sync/status");
export const syncTikTokEverythingNow = () => request("/api/tiktok/sync/now", { method: "POST" }).then(async response => { window.dispatchEvent(new Event("tiktok-sync-started")); const results = {}; for (const [type, entry] of Object.entries(response.results || {})) { if (!entry.ok || !entry.job) { results[type] = entry; continue; } try { results[type] = { ok: true, result: await waitForTikTokSync({ jobId: entry.job._id, job: entry.job }) }; } catch (error) { results[type] = { ok: false, message: error.message }; } } return { results }; });
