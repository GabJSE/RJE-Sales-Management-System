import { useSettings } from "../context/SettingsContext.jsx";
﻿import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, AlertCircle, RefreshCw } from "lucide-react";
import { getTikTokSyncJobs, notifyTikTokSyncComplete } from "../services/tiktokSyncService.js";
import { financeDate, syncPresentation } from "../utils/financePresentation.js";

export default function FinanceSyncStatus({ logs = [], onChange, onFullRefresh, admin, starting }) {
  const { formatDateTime: financeDate } = useSettings();
  const [state, setState] = useState({ jobs: [], lastSuccessful: {} }); const [error, setError] = useState(""); const callback = useRef(onChange); callback.current = onChange;
  useEffect(() => {
    let stopped = false; let timer; let polling = false; let rerun = false; const previous = new Map();
    const poll = async () => {
      if (polling) { rerun = true; return; } polling = true; let delay = 15000;
      try {
        const result = await getTikTokSyncJobs("settlements"); if (stopped) return;
        for (const job of result.jobs || []) { if (["running", "pending"].includes(previous.get(job._id)) && ["completed", "failed"].includes(job.status)) notifyTikTokSyncComplete(job); previous.set(job._id, job.status); }
        setState(result); setError(""); const view = syncPresentation(result.jobs, result.lastSuccessful?.settlements); callback.current?.({ ...view, lastSuccessful: result.lastSuccessful?.settlements }); if (view.active) delay = 2000;
      } catch (failure) { if (!stopped) { setError(failure.message); callback.current?.({ active: true, unavailable: true }); } }
      finally { polling = false; if (!stopped) timer = setTimeout(poll, rerun ? 0 : delay); rerun = false; }
    };
    const refresh = () => { clearTimeout(timer); void poll(); }; void poll(); window.addEventListener("tiktok-sync-started", refresh);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener("tiktok-sync-started", refresh); };
  }, []);
  const view = syncPresentation(state.jobs, state.lastSuccessful?.settlements); const job = view.job; const Icon = view.tone === "positive" ? CheckCircle2 : view.tone === "negative" ? AlertCircle : view.active ? RefreshCw : Clock3;
  return <section className={`sf-sync sf-${view.tone}`} aria-label="Finance synchronization"><div className="sf-sync-main" role="status"><Icon size={18}/><div><strong>{error ? "Status unavailable" : view.label}</strong><p>{error ? "Could not check synchronization. Status checks will retry automatically; avoid starting another job." : view.message}</p>{!error && job?.status === "pending" && job.nextAttemptAt && <small>Next check: {financeDate(job.nextAttemptAt)}</small>}</div></div>
    {!error && job?.status === "running" && <div className="sf-sync-progress"><span>{job.recordsProcessed ?? job.processed ?? 0} records · {job.pages || 0} pages{job.total > 0 ? ` · ${job.processed || 0} of ${job.total} stage steps` : ""}</span><progress aria-label="Finance synchronization progress" max={job.total > 0 ? job.total : undefined} value={job.total > 0 ? Math.min(job.processed || 0, job.total) : undefined}/></div>}
    <details className="sf-sync-details"><summary>Synchronization Details</summary><div>{error && <p role="alert">{error}</p>}<p>Last successful sync: {financeDate(state.lastSuccessful?.settlements)}</p>{job && <dl><div><dt>Job status</dt><dd>{job.status}</dd></div><div><dt>Operation</dt><dd>{job.stage}</dd></div><div><dt>Attempts</dt><dd>{job.attempts || 0} / {job.maxAttempts}</dd></div><div><dt>Records / pages</dt><dd>{job.recordsProcessed ?? "Not reported"} / {job.pages || 0}</dd></div></dl>}{job?.errorMessage && <p>{job.errorMessage}</p>}{admin && <button disabled={view.active || starting || Boolean(error)} onClick={onFullRefresh}>Force Full Refresh</button>}<h3>Recent finance runs</h3>{logs.length ? <ul>{logs.slice(0, 10).map(log => <li key={log._id}><strong>{log.status === "completed" ? "Completed" : log.status === "failed" ? "Failed" : "Running"}</strong><span>{financeDate(log.startedAt)} · {log.transactionsImported || 0} transactions</span>{log.errorMessage && <small>{log.errorMessage}</small>}</li>)}</ul> : <p>No finance synchronization history yet.</p>}</div></details>
  </section>;
}
