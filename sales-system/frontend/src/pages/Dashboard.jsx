import { useEffect, useMemo, useState } from "react";
import { getDashboard } from "../services/dashboardService.js";
import { useSettings } from "../context/SettingsContext.jsx";

const percent = (value) => `${Number(value || 0).toFixed(2)}%`;
const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthRange = () => { const now = new Date(); return { startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }; };
const displayProduct = (item) => item.brand ? `${item.brand} ${item.category || ""} ${item.model || ""}`.replace(/\s+/g, " ").trim() : item.name;

function Dashboard() {
  const { settings, formatCurrency: peso, formatDate } = useSettings();
  const initialRange = monthRange();
  const [range, setRange] = useState(initialRange);
  const [preset, setPreset] = useState(settings.defaultDashboardPeriod);
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (nextRange = range) => {
    try { setLoading(true); setData(await getDashboard(nextRange.startDate, nextRange.endDate)); setNotice(""); }
    catch (error) { setNotice(error.message); } finally { setLoading(false); }
  };
  useEffect(() => {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), 1);
    let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (settings.defaultDashboardPeriod === "today") start = end = now;
    if (settings.defaultDashboardPeriod === "week") { start = new Date(now); start.setDate(now.getDate() - now.getDay()); end = new Date(start); end.setDate(start.getDate() + 6); }
    if (settings.defaultDashboardPeriod === "year") { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31); }
    const next = { startDate: localDate(start), endDate: localDate(end) };
    setPreset(settings.defaultDashboardPeriod);
    setRange(next);
    load(next);
  }, [settings.defaultDashboardPeriod]);

  const changePreset = (event) => {
    const value = event.target.value; setPreset(value);
    if (value === "custom") return;
    const now = new Date(); let start = new Date(now.getFullYear(), now.getMonth(), 1); let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (value === "today") start = end = now;
    if (value === "yesterday") start = end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (value === "week") { start = new Date(now); start.setDate(now.getDate() - now.getDay()); end = new Date(start); end.setDate(start.getDate() + 6); }
    if (value === "lastMonth") { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); }
    if (value === "year") { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31); }
    if (value === "all") { setRange({ startDate: "", endDate: "" }); return load({ startDate: "", endDate: "" }); }
    const next = { startDate: localDate(start), endDate: localDate(end) }; setRange(next); load(next);
  };
  const maxTrend = useMemo(() => Math.max(...(data?.salesTrend || []).map((item) => Math.abs(item.totalSales || 0)), 1), [data]);
  const summary = data?.summary || {};

  return <section>
    <div className="page-header"><div><p className="eyebrow">Business overview</p><h1>Dashboard</h1><p className="muted">Monitor sales, profit, products, and inventory at a glance.</p></div><div className="dashboard-filter"><select value={preset} onChange={changePreset}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This Week</option><option value="month">This Month</option><option value="lastMonth">Last Month</option><option value="year">This Year</option><option value="all">All Time</option><option value="custom">Custom Date Range</option></select>{preset === "custom" && <><input type="date" value={range.startDate} onChange={(event) => setRange({ ...range, startDate: event.target.value })} /><input type="date" value={range.endDate} onChange={(event) => setRange({ ...range, endDate: event.target.value })} /><button className="primary-button" onClick={() => load()}>Generate</button></>}</div></div>
    {notice && <div className="notice error">{notice}<button onClick={() => load()}>Retry</button></div>}
    {loading ? <p className="empty-state">Loading dashboard...</p> : <><div className="summary-grid">{[["Total Sales", peso(summary.totalSales)],["Total Capital", peso(summary.totalCapital)],["TikTok Fees", peso(summary.totalTiktokFees)],["Withholding Tax", peso(summary.totalWithholdingTax)],["Net Sales", peso(summary.netSales)],["Total Profit", peso(summary.totalProfit)],["Profit Margin", percent(summary.profitMargin)],["Quantity Sold", summary.totalQuantitySold],["Transactions", summary.transactionCount]].map(([label, value]) => <div className="summary-card" key={label}><span>{label}</span><strong>{value || 0}</strong></div>)}</div><div className="dashboard-charts"><div className="panel"><div className="list-toolbar"><div><p className="eyebrow">Sales Overview</p><h2>Sales performance</h2></div></div><div className="bar-chart dashboard-chart">{(data?.salesTrend || []).map((item) => <div className="bar-column" key={item.date}><div className="bar-value">{peso(item.totalSales)}</div><div className="bar" style={{ height: `${Math.max(5, Math.abs(item.totalSales) / maxTrend * 145)}px` }} /><small>{item.date.slice(5)}</small></div>)}</div></div><div className="panel"><div className="list-toolbar"><div><p className="eyebrow">Profit Performance</p><h2>Daily profit</h2></div></div><div className="bar-chart dashboard-chart">{(data?.profitTrend || []).map((item) => <div className="bar-column" key={item.date}><div className="bar-value">{peso(item.profit)}</div><div className={`bar ${item.profit < 0 ? "loss-bar" : "profit-bar"}`} style={{ height: `${Math.max(5, Math.abs(item.profit) / maxTrend * 145)}px` }} /><small>{item.date.slice(5)}</small></div>)}</div></div></div><div className="dashboard-columns"><div className="panel"><div className="list-toolbar"><div><p className="eyebrow">Latest transactions</p><h2>Recent Sales</h2></div><button className="text-button" onClick={() => { window.history.pushState({}, "", "/sales"); window.dispatchEvent(new PopStateEvent("popstate")); }}>View all</button></div>{data.recentSales.length === 0 ? <p className="empty-state">No sales recorded yet.</p> : <div className="table-wrapper"><table><thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Total Sales</th><th>Net Sales</th><th>Profit</th></tr></thead><tbody>{data.recentSales.map((sale) => <tr key={sale._id}><td>{formatDate(sale.date)}</td><td>{sale.productName}</td><td>{sale.quantity}</td><td>{peso(sale.totalSales)}</td><td>{peso(sale.netSales)}</td><td>{peso(sale.profit)}</td></tr>)}</tbody></table></div>}</div><div className="panel"><div className="list-toolbar"><div><p className="eyebrow">Product performance</p><h2>Top-selling products</h2></div><button className="text-button" onClick={() => { window.history.pushState({}, "", "/reports"); window.dispatchEvent(new PopStateEvent("popstate")); }}>View reports</button></div><ol className="dashboard-list">{data.topSellingProducts.map((item) => <li key={`${item.productId}-${item.productName}`}><strong>{item.productName}</strong><span>{item.quantitySold} sold · {peso(item.totalSales)}</span></li>)}</ol></div></div><div className="dashboard-columns"><div className="panel"><p className="eyebrow">Profit performance</p><h2>Most profitable products</h2><ol className="dashboard-list">{data.mostProfitableProducts.map((item) => <li key={`${item.productId}-${item.productName}`}><strong>{item.productName}</strong><span>{peso(item.totalProfit)} · {item.quantitySold} sold · {percent(item.profitMargin)}</span></li>)}</ol></div><div className="panel"><p className="eyebrow">Inventory overview</p><h2>Stock health</h2><div className="inventory-stats"><span>Total products<strong>{data.inventory.totalProducts}</strong></span><span>Total stock<strong>{data.inventory.totalStock}</strong></span><span>Low stock<strong>{data.inventory.lowStockCount}</strong></span><span>Out of stock<strong>{data.inventory.outOfStockCount}</strong></span></div><h3>Low stock products</h3>{data.inventory.lowStockProducts.length === 0 ? <p className="muted">No low stock products.</p> : <ul className="low-stock-list">{data.inventory.lowStockProducts.map((item) => <li key={item._id}><strong>{displayProduct(item)}</strong><span>{item.sku} · {item.stock} left</span></li>)}</ul>}</div></div></>}
  </section>;
}

export default Dashboard;
