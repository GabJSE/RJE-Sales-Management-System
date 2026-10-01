import { useEffect, useMemo, useState } from "react";
import { getReport } from "../services/reportService.js";
import { downloadExport } from "../services/exportService.js";
import { useSettings } from "../context/SettingsContext.jsx";

const percent = (value) => `${Number(value || 0).toFixed(2)}%`;
const localDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const monthRange = () => {
  const now = new Date();
  return { startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};
const emptyReport = { summary: {}, daily: [], products: [] };

function Reports() {
  const { formatCurrency: peso, formatDate } = useSettings();
  const initialRange = monthRange();
  const [range, setRange] = useState(initialRange);
  const [selectedPreset, setSelectedPreset] = useState("month");
  const [report, setReport] = useState(emptyReport);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [isLoading, setIsLoading] = useState(true);

  const loadReport = async (nextRange = range) => {
    try {
      setIsLoading(true);
      setReport(await getReport(nextRange.startDate, nextRange.endDate));
      setNotice({ type: "", text: "" });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
      setReport(emptyReport);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadReport(initialRange); }, []);

  const applyPreset = (event) => {
    const value = event.target.value;
    setSelectedPreset(value);
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), 1);
    let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (value === "today") start = end = now;
    if (value === "yesterday") { start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); end = start; }
    if (value === "week") { start = new Date(now); start.setDate(now.getDate() - now.getDay()); end = new Date(start); end.setDate(start.getDate() + 6); }
    if (value === "lastMonth") { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); }
    if (value === "year") { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31); }
    const nextRange = { startDate: localDate(start), endDate: localDate(end) };
    setRange(nextRange);
    if (value !== "custom") loadReport(nextRange);
  };

  const handleExport = async () => {
    try {
      await downloadExport(`reports?format=csv&startDate=${range.startDate}&endDate=${range.endDate}`, `RJE_Report_${range.startDate}_to_${range.endDate}.csv`);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  };

  const maxChartValue = useMemo(() => Math.max(...report.daily.map((item) => Math.abs(item.netSales || 0)), 1), [report.daily]);
  const topByQuantity = useMemo(() => [...report.products].sort((a, b) => b.totalQuantitySold - a.totalQuantitySold).slice(0, 5), [report.products]);
  const topByProfit = useMemo(() => [...report.products].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 5), [report.products]);
  const summary = report.summary;
  const hasSales = report.daily.length > 0;

  return (
    <section>
      <div className="page-header"><div><p className="eyebrow">Business intelligence</p><h1>Reports</h1><p className="muted">Analyze sales performance using stored historical sale values.</p></div><button className="primary-button report-export-button" onClick={handleExport} disabled={isLoading}>Export Report</button></div>
      {notice.text && <div className="notice error">{notice.text}<button onClick={() => setNotice({ type: "", text: "" })}>×</button></div>}
      <div className="panel report-filters"><label>Date range<select value={selectedPreset} onChange={applyPreset}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This Week</option><option value="month">This Month</option><option value="lastMonth">Last Month</option><option value="year">This Year</option><option value="custom">Custom Date Range</option></select></label><label>From<input type="date" value={range.startDate} onChange={(event) => { setSelectedPreset("custom"); setRange({ ...range, startDate: event.target.value }); }} /></label><label>To<input type="date" value={range.endDate} onChange={(event) => { setSelectedPreset("custom"); setRange({ ...range, endDate: event.target.value }); }} /></label><button className="primary-button filter-button" onClick={() => loadReport()} disabled={isLoading}>Generate report</button></div>
      {isLoading ? <p className="empty-state">Loading report...</p> : <><div className="summary-grid">{[["Total Sales", peso(summary.totalSales)],["Total Capital", peso(summary.totalCapital)],["TikTok Fees", peso(summary.totalTiktokFees)],["Withholding Tax", peso(summary.totalWithholdingTax)],["Net Sales", peso(summary.netSales)],["Total Profit", peso(summary.totalProfit)],["Profit Margin", percent(summary.profitMargin)],["Quantity Sold", summary.totalQuantitySold || 0],["Transactions", summary.transactionCount || 0]].map(([label, value]) => <div className="summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{!hasSales ? <p className="empty-state report-empty">No sales found for the selected date range.</p> : <><div className="report-charts"><div className="panel"><div className="list-toolbar"><div><p className="eyebrow">Trend</p><h2>Net sales by day</h2></div></div><div className="bar-chart">{report.daily.map((item) => <div className="bar-column" key={item.date}><div className="bar-value">{peso(item.netSales)}</div><div className="bar" style={{ height: `${Math.max(5, Math.abs(item.netSales) / maxChartValue * 150)}px` }} /><small>{item.date.slice(5)}</small></div>)}</div></div><div className="panel"><div className="list-toolbar"><div><p className="eyebrow">Trend</p><h2>Profit by day</h2></div></div><div className="bar-chart">{report.daily.map((item) => <div className="bar-column" key={item.date}><div className="bar-value">{peso(item.totalProfit)}</div><div className="bar profit-bar" style={{ height: `${Math.max(5, Math.abs(item.totalProfit) / maxChartValue * 150)}px` }} /><small>{item.date.slice(5)}</small></div>)}</div></div></div><div className="top-products"><div className="panel"><p className="eyebrow">Top products</p><h2>By quantity sold</h2><ol>{topByQuantity.map((item) => <li key={`quantity-${item.productId}-${item.productName}`}><strong>{item.productName}</strong> — {item.totalQuantitySold} units</li>)}</ol></div><div className="panel"><p className="eyebrow">Top products</p><h2>By profit</h2><ol>{topByProfit.map((item) => <li key={`profit-${item.productId}-${item.productName}`}><strong>{item.productName}</strong> — {peso(item.totalProfit)}</li>)}</ol></div></div><div className="panel report-table-panel"><div className="list-toolbar"><div><p className="eyebrow">Daily breakdown</p><h2>Daily sales report</h2></div></div><div className="table-wrapper"><table><thead><tr><th>Date</th><th>Sales</th><th>Capital</th><th>Fees</th><th>Net Sales</th><th>Profit</th><th>Margin</th></tr></thead><tbody>{report.daily.map((item) => <tr key={item.date}><td>{item.date}</td><td>{peso(item.totalSales)}</td><td>{peso(item.totalCapital)}</td><td>{peso(item.totalTiktokFees)}</td><td>{peso(item.netSales)}</td><td>{peso(item.totalProfit)}</td><td>{percent(item.profitMargin)}</td></tr>)}</tbody></table></div></div><div className="panel report-table-panel"><div className="list-toolbar"><div><p className="eyebrow">Product performance</p><h2>Products</h2></div></div><div className="table-wrapper"><table><thead><tr><th>Product</th><th>Quantity</th><th>Sales</th><th>Capital</th><th>Fees</th><th>Net Sales</th><th>Profit</th><th>Margin</th></tr></thead><tbody>{report.products.map((item) => <tr key={`${item.productId}-${item.productName}`}><td>{item.productName}</td><td>{item.totalQuantitySold}</td><td>{peso(item.totalSales)}</td><td>{peso(item.totalCapital)}</td><td>{peso(item.totalTiktokFees)}</td><td>{peso(item.netSales)}</td><td>{peso(item.totalProfit)}</td><td>{percent(item.profitMargin)}</td></tr>)}</tbody></table></div></div></>}</>}
    </section>
  );
}

export default Reports;
