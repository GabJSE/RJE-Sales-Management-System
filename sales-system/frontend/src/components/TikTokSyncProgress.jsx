import { useSettings } from "../context/SettingsContext.jsx";
import { syncPresentation } from "../utils/financePresentation.js";
import { useEffect, useRef, useState } from "react";
import { getTikTokSyncJobs, startTikTokSync, notifyTikTokSyncComplete } from "../services/tiktokSyncService.js";
import { useAuth } from "../context/AuthContext.jsx";

export function useSyncCompletion(type, reload) {
  const latest = useRef(reload); latest.current = reload;
  useEffect(() => { const done = event => { if (!type || type === event.detail?.type) latest.current(); }; window.addEventListener("tiktok-sync-completed", done); return () => window.removeEventListener("tiktok-sync-completed", done); }, [type]);
}
const labels = { products: "Products", orders: "Orders", settlements: "Settlements & Profit" };
export default function TikTokSyncProgress({ type, friendly = false, allowStart = true, actionLabel = "Sync Now" }) {
  const { formatDateTime: date } = useSettings();
  const { user } = useAuth(); const [state, setState] = useState({ jobs: [], lastSuccessful: {} }); const [error, setError] = useState(""); const [starting, setStarting] = useState(false); const previous = useRef(new Map());
  useEffect(() => {
    let stopped = false; let timer; let polling = false; let rerun = false;
    const poll = async () => {
      if (polling) { rerun = true; return; }
      polling = true;
      let delay = 15000;
      try {
        const result = await getTikTokSyncJobs(type);
        if (stopped) return;
        for (const job of result.jobs) {
          const prior = previous.current.get(job._id);
          if (prior && prior !== job.status && ["completed", "failed"].includes(job.status)) notifyTikTokSyncComplete(job);
          previous.current.set(job._id, job.status);
        }
        setState(result); setError("");
        if (result.jobs.some(job => ["pending", "running"].includes(job.status))) delay = 2000;
      } catch (failure) { if (!stopped) setError(failure.message); }
      polling = false;
      if (!stopped) timer = setTimeout(poll, rerun ? 0 : delay);
      rerun = false;
    };
    const refresh = () => { clearTimeout(timer); void poll(); };
    void poll(); window.addEventListener("tiktok-sync-started", refresh);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener("tiktok-sync-started", refresh); };
  }, [type]);
  const active = state.jobs.some(job => ["pending", "running"].includes(job.status));
  const start = async forceFull => {
    if (forceFull && !window.confirm("Refresh all available TikTok history? This may take longer. Existing records and capital costs will be preserved.")) return;
    setStarting(true); setError("");
    try { await startTikTokSync(type, { forceFull }); window.dispatchEvent(new Event("tiktok-sync-started")); }
    catch (failure) { setError(failure.message); } finally { setStarting(false); }
  };
  const jobs = type ? state.jobs.slice(0, 1) : Object.keys(labels).map(name => state.jobs.find(job => job.type === name)).filter(Boolean);
  return <section className="sync-progress-panel" aria-label="TikTok synchronization progress"><div className="sync-progress-heading"><div><strong>{type ? labels[type] : "TikTok"} synchronization</strong>{type && <small>Last successful sync: {date(state.lastSuccessful?.[type])}</small>}</div>{type && user?.role === "admin" && <div><button disabled={starting || active || !allowStart} onClick={() => start(false)}>{actionLabel}</button><button disabled={starting || active} onClick={() => start(true)}>Force Full Refresh</button></div>}</div>
    {error && <p role="alert">{error}</p>}
    {!error && !jobs.length && <p className="muted">{state.lastSuccessful?.[type] ? "Up to date ? last synchronization completed successfully." : "Never synchronized."}</p>}
    {jobs.map(job => <div key={job._id} className="sync-progress-job"><div><strong>{labels[job.type]}: {friendly ? syncPresentation([job], state.lastSuccessful?.[job.type]).label : job.status}</strong>{job.stage?.toLowerCase() !== job.status && <span>{job.stage === "Waiting for previous sync lease" ? "Another synchronization is finishing. This job will retry automatically." : job.stage}</span>}</div>{["running", "pending"].includes(job.status) && <progress aria-label={`${labels[job.type]} sync progress`} max={job.total || 1} value={job.total ? Math.min(job.processed, job.total) : undefined}/>}
      <small>{job.recordsProcessed ?? job.processed ?? 0} records{job.total != null ? ` | ${job.processed} / ${job.total} stage steps` : ""}  |  {job.pages || 0} pages  |  {friendly ? "Elapsed incl. waits: " : ""}{Math.round((job.durationMs || 0) / 1000)}s  |  Attempt {job.attempts || 0}/{job.maxAttempts}{job.status === "pending" && job.attempts > 0 ? `  |  Retry after ${date(job.nextAttemptAt)}` : ""}</small>
      {job.errorMessage && <p role={job.status === "failed" ? "alert" : "status"}>{job.errorMessage}</p>}
      {job.performance && <small>{job.performance.apiRequests || 0} API requests  |  {job.performance.cacheHits || 0} cache hits  |  {job.performance.databaseBatches || 0} bulk write batches</small>}
    </div>)}<small className="muted">{active ? "Sync continues in the background when you leave this page." : "Start a new sync to check for updates."}</small></section>;
}
