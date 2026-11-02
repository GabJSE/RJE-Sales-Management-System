import { request } from "./api.js";
const notified = new Set();
export function notifyTikTokSyncComplete(job) {
  if (notified.has(job._id)) return;
  notified.add(job._id); if (notified.size > 200) notified.delete(notified.values().next().value);
  window.dispatchEvent(new CustomEvent("tiktok-sync-completed", { detail: { type: job.type } }));
}
export const getTikTokSyncJobs = type => request(`/api/tiktok/sync/jobs${type ? `?type=${encodeURIComponent(type)}` : ""}`);
export const getTikTokSyncJob = id => request(`/api/tiktok/sync/jobs/${encodeURIComponent(id)}`);
export const startTikTokSync = (type, options = {}) => request(`/api/tiktok/${{ products: "products", orders: "orders", settlements: "finance" }[type]}/sync`, { method: "POST", body: JSON.stringify(options) });
export async function waitForTikTokSync(response) {
  if (!response.jobId) return response; // Compatibility with older deployments during rollout.
  let job = response.job; let failures = 0;
  while (!job || ["pending", "running"].includes(job.status)) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try { job = (await getTikTokSyncJob(response.jobId)).job; failures = 0; }
    catch (error) { if (++failures >= 3) throw new Error(`Could not check synchronization progress. The job continues in the background. ${error.message}`); }
  }
  notifyTikTokSyncComplete(job);
  if (job.status === "failed") throw new Error(job.errorMessage || "Synchronization failed. See synchronization progress for details.");
  return job.result;
}
