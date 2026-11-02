import { displayCalendarDate } from "../utils/settingsPresentation.js";
﻿import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import TikTokSyncProgress, { useSyncCompletion } from "../components/TikTokSyncProgress.jsx";
import DateRangeFilter, { dateRangeForPreset } from "../components/DateRangeFilter.jsx";
import { getTikTokFinanceOverview, getTikTokSettlements, syncTikTokSettlements } from "../services/tiktokService.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSettings } from "../context/SettingsContext.jsx";

const peso = value => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value ?? 0);
const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
const empty = { overview: {}, settlements: [] };

export default function Reports() {
  const { user } = useAuth(); const { formatDate, settings } = useSettings();
  const [range, setRange] = useState(() => { const query = new URLSearchParams(window.location.search); const defaults = dateRangeForPreset("today"); return { from: query.get("startDate") || defaults.from, to: query.get("endDate") || defaults.to }; });
  const [data, setData] = useState(empty); const [loading, setLoading] = useState(true); const [syncing, setSyncing] = useState(false); const [notice, setNotice] = useState(""); const loadVersion = useRef(0);
  const load = async () => {
    const version = ++loadVersion.current; setLoading(true); setNotice(""); setData(empty);
    try {
      const [overview, rows] = await Promise.all([getTikTokFinanceOverview(range.from, range.to), getTikTokSettlements(range.from, range.to)]);
      if (version === loadVersion.current) setData({ overview, settlements: rows.settlements || [] });
    } catch (error) { if (version === loadVersion.current) setNotice(error.message); }
    finally { if (version === loadVersion.current) setLoading(false); }
  };
  useEffect(() => { load(); return () => { loadVersion.current++; }; }, [range.from, range.to]);
  useSyncCompletion("settlements", load);
  const sync = async () => { setSyncing(true); setNotice(""); try { await syncTikTokSettlements(range); await load(); } catch (error) { setNotice(error.message); } finally { setSyncing(false); } };
  const exportSettlements = () => {
    const headers = ["Settlement date", "Statement ID", "Orders", "Settlement revenue", "Fees", "Taxes", "Net settlement", "Known capital", "Confirmed profit", "Status"];
    const rows = data.settlements.map(row => [row.settlementDate, row.statementId, row.orderCount, row.totalRevenue, row.totalFees, row.totalTaxes, row.netSettlement, row.totalCapitalCost, row.calculatedProfit ?? "Unconfirmed", row.reconciliationStatus]);
    const blob = new Blob([[headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `TikTok_Settlements_${range.from}_to_${range.to}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href);
  };
  const days = useMemo(() => {
    const grouped = new Map();
    for (const row of data.settlements) {
      const date = new Date(new Date(row.settlementDate).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
      const day = grouped.get(date) || { date, netMinor: 0n, profitMinor: 0n, statements: 0, confirmed: 0 };
      day.netMinor += BigInt(row.netSettlementMinor || 0); day.statements++;
      if (row.reconciliationStatus === "reconciled") { day.profitMinor += BigInt(row.calculatedProfitMinor || 0); day.confirmed++; }
      grouped.set(date, day);
    }
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data.settlements]);
  const summary = data.overview;
  return <section className="reports-page">
    <div className="page-header"><div className="standard-page-title"><p className="eyebrow">TikTok analytics</p><h1>Reports</h1><p className="muted">PHP settlement performance using actual TikTok amounts and historical product capital.</p></div><button className="secondary-header-button report-export-button" onClick={exportSettlements} disabled={loading || !data.settlements.length}><Download size={16}/>Export Settlements</button></div>
    {notice && <div className="notice error" role="alert">{notice}<button onClick={load}>Retry</button></div>}
    <TikTokSyncProgress type="settlements"/>
    <div className="report-finance-actions"><DateRangeFilter value={range} onApply={next => setRange({ from: next.from, to: next.to })} syncUrlKeys={{ from: "startDate", to: "endDate" }} disabled={loading || syncing}/>{user?.role === "admin" && <button className="primary-button report-sync-button" onClick={sync} disabled={loading || syncing}><RefreshCw size={16}/>{syncing ? "Syncing…" : "Sync Finance"}</button>}</div>
    {loading ? <p className="empty-state" role="status">Loading TikTok report…</p> : <>
      <div className="summary-grid reports-summary-grid">{[["Settlement revenue", peso(summary.grossRevenue)], ["TikTok fees", peso(summary.fees)], ["TikTok tax deductions", peso(summary.taxes)], ["Net settlement", peso(summary.netSettlement)], ["Known product capital", peso(summary.capitalCost)], ["Confirmed settlement profit", peso(summary.netProfit)], ["Confirmed margin", summary.profitMargin == null ? "Unconfirmed" : `${summary.profitMargin.toFixed(2)}%`], ["Unreconciled amount", peso(summary.unreconciledAmount)]].map(([label, value]) => <div className="summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="muted">Profit covers {summary.reconciledStatementCount || 0} of {summary.statementCount || 0} statements and excludes external expenses. Capital can be partial on unreconciled statements. Bank payment may still be pending.</p>
      <div className="panel report-table-panel"><h2>Daily settlements and confirmed profit</h2><div className="table-wrapper"><table><thead><tr><th>Date (Manila)</th><th>Net settlement</th><th>Confirmed profit</th><th>Reconciled statements</th></tr></thead><tbody>{days.map(day => <tr key={day.date}><td>{displayCalendarDate(day.date, settings.dateFormat)}</td><td>{peso(Number(day.netMinor) / 100)}</td><td>{day.confirmed ? peso(Number(day.profitMinor) / 100) : "Unconfirmed"}</td><td>{day.confirmed} / {day.statements}</td></tr>)}{!days.length && <tr><td colSpan="4">No settlements for this period.</td></tr>}</tbody></table></div></div>
      <div className="panel report-table-panel"><h2>TikTok settlement statements</h2><div className="table-wrapper report-settlement-table"><table><thead><tr><th>Date</th><th>Statement</th><th>Orders</th><th>Revenue</th><th>Fees</th><th>Tax</th><th>Net settlement</th><th>Known capital</th><th>Confirmed profit</th><th>Status</th></tr></thead><tbody>{data.settlements.map(row => <tr key={row._id}><td>{formatDate(row.settlementDate)}</td><td>{row.statementId}</td><td>{row.orderCount}</td><td>{peso(row.totalRevenue)}</td><td>{peso(row.totalFees)}</td><td>{peso(row.totalTaxes)}</td><td>{peso(row.netSettlement)}</td><td>{peso(row.totalCapitalCost)}</td><td>{row.calculatedProfit == null ? "Unconfirmed" : peso(row.calculatedProfit)}</td><td>{String(row.reconciliationStatus || "").replaceAll("_", " ")}</td></tr>)}{!data.settlements.length && <tr><td colSpan="10">No TikTok statements for this period.</td></tr>}</tbody></table></div></div>
    </>}
  </section>;
}
