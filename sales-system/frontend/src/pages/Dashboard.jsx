import { useEffect, useMemo, useState } from "react";
import { getDashboard } from "../services/dashboardService.js";
import { useSettings } from "../context/SettingsContext.jsx";

const percent = (value) => `${Number(value || 0).toFixed(2)}%`;
const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthRange = () => {
  const now = new Date();
  return { startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};
const displayProduct = (item) => item.brand ? `${item.brand} ${item.category || ""} ${item.model || ""}`.replace(/\s+/g, " ").trim() : item.name;
const goTo = (path) => {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

function Dashboard() {
  const { settings, formatCurrency: peso, formatDate } = useSettings();
  const [range, setRange] = useState(monthRange);
  const [preset, setPreset] = useState(settings.defaultDashboardPeriod);
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (nextRange = range) => {
    try {
      setLoading(true);
      setData(await getDashboard(nextRange.startDate, nextRange.endDate));
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), 1);
    let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (settings.defaultDashboardPeriod === "today") start = end = now;
    if (settings.defaultDashboardPeriod === "week") {
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      end = new Date(start);
      end.setDate(start.getDate() + 6);
    }
    if (settings.defaultDashboardPeriod === "year") {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
    }
    const next = { startDate: localDate(start), endDate: localDate(end) };
    setPreset(settings.defaultDashboardPeriod);
    setRange(next);
    load(next);
  }, [settings.defaultDashboardPeriod]);

  const changePreset = (event) => {
    const value = event.target.value;
    setPreset(value);
    if (value === "custom") return;
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), 1);
    let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (value === "today") start = end = now;
    if (value === "yesterday") start = end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (value === "week") {
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      end = new Date(start);
      end.setDate(start.getDate() + 6);
    }
    if (value === "lastMonth") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    if (value === "year") {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
    }
    if (value === "all") {
      const all = { startDate: "", endDate: "" };
      setRange(all);
      return load(all);
    }
    const next = { startDate: localDate(start), endDate: localDate(end) };
    setRange(next);
    load(next);
  };

  const summary = data?.summary || {};
  const inventory = data?.inventory || {};
  const salesTrend = data?.salesTrend || [];
  const profitTrend = data?.profitTrend || [];
  const maxSales = useMemo(() => Math.max(...salesTrend.map((item) => Math.abs(item.totalSales || 0)), 1), [salesTrend]);
  const maxProfit = useMemo(() => Math.max(...profitTrend.map((item) => Math.abs(item.profit || 0)), 1), [profitTrend]);

  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      <div className="dashboard-hero">
        <div>
          <p className="eyebrow">Business overview</p>
          <h1 id="dashboard-title">Dashboard</h1>
          <p className="muted">A clear view of today's sales, profit, and stock health.</p>
        </div>
        <div className="dashboard-actions">
          <div className="dashboard-filter" aria-label="Dashboard date range">
            <label className="sr-only" htmlFor="dashboard-period">Date range</label>
            <select id="dashboard-period" value={preset} onChange={changePreset}>
              <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This Week</option>
              <option value="month">This Month</option><option value="lastMonth">Last Month</option><option value="year">This Year</option>
              <option value="all">All Time</option><option value="custom">Custom Date Range</option>
            </select>
            {preset === "custom" && <>
              <label className="sr-only" htmlFor="dashboard-start">Start date</label>
              <input id="dashboard-start" type="date" value={range.startDate} onChange={(event) => setRange({ ...range, startDate: event.target.value })} />
              <label className="sr-only" htmlFor="dashboard-end">End date</label>
              <input id="dashboard-end" type="date" value={range.endDate} onChange={(event) => setRange({ ...range, endDate: event.target.value })} />
              <button className="primary-button header-button" type="button" onClick={() => load()}>Apply</button>
            </>}
          </div>
          <button className="primary-button dashboard-add-sale" type="button" onClick={() => goTo("/sales")}>＋ Add Sale</button>
        </div>
      </div>

      {notice && <div className="notice error" role="alert">{notice}<button type="button" onClick={() => load()}>Retry</button></div>}
      {loading ? <div className="dashboard-state" role="status" aria-live="polite"><span className="loading-dot" />Loading dashboard...</div> : data && (
        <>
          <div className="dashboard-kpis" aria-label="Key performance indicators">
            <div className="dashboard-kpi"><span className="kpi-icon sales-icon">₱</span><div><span>Total Sales</span><strong>{peso(summary.totalSales)}</strong><small>Gross revenue</small></div></div>
            <div className="dashboard-kpi"><span className="kpi-icon profit-icon">↗</span><div><span>Net Profit</span><strong>{peso(summary.totalProfit)}</strong><small>{percent(summary.profitMargin)} margin</small></div></div>
            <div className="dashboard-kpi"><span className="kpi-icon transactions-icon">▤</span><div><span>Total Transactions</span><strong>{summary.transactionCount || 0}</strong><small>{summary.totalQuantitySold || 0} items sold</small></div></div>
            <div className="dashboard-kpi warning"><span className="kpi-icon stock-icon">!</span><div><span>Low Stock Items</span><strong>{inventory.lowStockCount || 0}</strong><small>{inventory.outOfStockCount || 0} out of stock</small></div></div>
          </div>

          <div className="dashboard-section-heading"><div><p className="eyebrow">Performance</p><h2>Sales and profit trends</h2></div><span className="dashboard-period">{range.startDate && range.endDate ? `${formatDate(range.startDate)} – ${formatDate(range.endDate)}` : "All recorded data"}</span></div>
          <div className="dashboard-charts dashboard-chart-grid">
            <div className="panel dashboard-chart-panel"><div className="chart-heading"><div><span className="chart-label">Revenue</span><h3>Sales Performance</h3></div><span className="chart-legend sales-legend">Sales</span></div><div className="bar-chart dashboard-chart" aria-label="Sales performance chart">{salesTrend.length === 0 ? <p className="empty-state">No sales for this period.</p> : salesTrend.map((item) => <div className="bar-column" key={item.date}><div className="bar-value">{peso(item.totalSales)}</div><div className="bar sales-bar" style={{ height: `${Math.max(5, Math.abs(item.totalSales || 0) / maxSales * 145)}px` }} /><small>{item.date.slice(5)}</small></div>)}</div></div>
            <div className="panel dashboard-chart-panel"><div className="chart-heading"><div><span className="chart-label">Profitability</span><h3>Profit Trend</h3></div><span className="chart-legend profit-legend">Profit</span></div><div className="bar-chart dashboard-chart" aria-label="Profit trend chart">{profitTrend.length === 0 ? <p className="empty-state">No profit data for this period.</p> : profitTrend.map((item) => <div className="bar-column" key={item.date}><div className="bar-value">{peso(item.profit)}</div><div className={`bar ${item.profit < 0 ? "loss-bar" : "profit-bar"}`} style={{ height: `${Math.max(5, Math.abs(item.profit || 0) / maxProfit * 145)}px` }} /><small>{item.date.slice(5)}</small></div>)}</div></div>
          </div>

          <div className="dashboard-content-grid">
            <div className="panel dashboard-panel"><div className="list-toolbar"><div><p className="eyebrow">Latest activity</p><h2>Recent Transactions</h2></div><button className="text-button" type="button" onClick={() => goTo("/sales")}>View All →</button></div>{data.recentSales?.length ? <div className="table-wrapper dashboard-table-wrapper"><table><thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Total Sales</th><th>Profit</th></tr></thead><tbody>{data.recentSales.map((sale) => <tr key={sale._id}><td>{formatDate(sale.date)}</td><td><strong>{sale.productName}</strong></td><td>{sale.quantity}</td><td>{peso(sale.totalSales)}</td><td className={sale.profit < 0 ? "negative-value" : "positive-value"}>{peso(sale.profit)}</td></tr>)}</tbody></table></div> : <p className="empty-state">No transactions recorded yet.</p>}</div>
            <div className="panel dashboard-panel"><div className="list-toolbar"><div><p className="eyebrow">Product performance</p><h2>Top-Selling Products</h2></div><button className="text-button" type="button" onClick={() => goTo("/reports")}>Reports →</button></div>{data.topSellingProducts?.length ? <ol className="ranked-list">{data.topSellingProducts.slice(0, 5).map((item, index) => <li key={`${item.productId}-${item.productName}`}><span className="rank-number">{index + 1}</span><div><strong>{item.productName}</strong><span>{item.quantitySold} sold</span></div><b>{peso(item.totalSales)}</b></li>)}</ol> : <p className="empty-state">No product sales yet.</p>}</div>
          </div>

          <div className="dashboard-bottom-grid">
            <div className="panel dashboard-panel"><div className="list-toolbar"><div><p className="eyebrow">Inventory overview</p><h2>Stock Health</h2></div><button className="text-button" type="button" onClick={() => goTo("/inventory")}>Inventory →</button></div><div className="inventory-overview"><div><span>Total Products</span><strong>{inventory.totalProducts || 0}</strong></div><div><span>Total Stock</span><strong>{inventory.totalStock || 0}</strong></div><div className="warning-stat"><span>Low Stock</span><strong>{inventory.lowStockCount || 0}</strong></div><div className="danger-stat"><span>Out of Stock</span><strong>{inventory.outOfStockCount || 0}</strong></div></div><h3 className="subsection-title">Low Stock Alerts</h3>{inventory.lowStockProducts?.length ? <ul className="low-stock-list">{inventory.lowStockProducts.slice(0, 5).map((item) => <li key={item._id}><strong>{displayProduct(item)}</strong><span>{item.stock} left</span></li>)}</ul> : <p className="muted">All products are sufficiently stocked.</p>}</div>
            <div className="panel dashboard-panel"><div className="list-toolbar"><div><p className="eyebrow">Profit performance</p><h2>Most Profitable Products</h2></div><button className="text-button" type="button" onClick={() => goTo("/reports")}>View Reports →</button></div>{data.mostProfitableProducts?.length ? <ol className="ranked-list profitable-list">{data.mostProfitableProducts.slice(0, 5).map((item, index) => <li key={`${item.productId}-${item.productName}`}><span className="rank-number">{index + 1}</span><div><strong>{item.productName}</strong><span>{item.quantitySold} sold · {percent(item.profitMargin)}</span></div><b className="positive-value">{peso(item.totalProfit)}</b></li>)}</ol> : <p className="empty-state">No profit data yet.</p>}</div>
          </div>
        </>
      )}
    </section>
  );
}

export default Dashboard;
