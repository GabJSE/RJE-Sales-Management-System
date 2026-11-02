import PricingDrawer from "../components/PricingDrawer.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
﻿import TikTokSyncProgress, { useSyncCompletion } from "../components/TikTokSyncProgress.jsx";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Image as ImageIcon, PackageSearch, Pencil, RefreshCw, Search, X } from "lucide-react";
import { getTikTokProducts, syncTikTokProducts, updateTikTokVariantCosts } from "../services/tiktokService.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./TikTokProducts.css";

const money = value => value == null || value === "" || !Number.isFinite(Number(value)) ? "Not available" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value));
const listed = row => row.currency && row.currency !== "PHP" ? "Not available in PHP" : money(row.price);
const settlementMoney = (row, value) => row.currency && row.currency !== "PHP" ? "Not available in PHP" : money(value);
const variant = row => row.variations?.map(item => `${item.name}: ${item.value}`).join(" · ") || "Default variant";
const status = row => row.archivedAt || !["ACTIVE", "ACTIVATE"].includes(row.status) ? "Inactive" : row.stock === 0 ? "Out of stock" : "Active";
const margin = row => row.settlementProfitMargin == null ? "Unconfirmed" : `${row.settlementProfitMargin.toFixed(2)}%`;
function ProductImage({ row }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [row.imageUrl]);
  return row.imageUrl && !failed ? <img className="pc-image" src={row.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)}/> : <span className="pc-image pc-image-fallback" aria-label="Product image unavailable"><ImageIcon size={22}/></span>;
}
function ProductDrawer({ row, onClose, copy }) {
  const { formatDateTime: date } = useSettings();
  const root = useRef(null); const close = useRef(null); const closeAction = useRef(onClose); closeAction.current = onClose;
  useEffect(() => {
    const previous = document.activeElement; close.current?.focus(); document.body.classList.add("dialog-open");
    const key = event => {
      if (event.key === "Escape") closeAction.current();
      if (event.key !== "Tab") return;
      const controls = [...root.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]')];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.classList.remove("dialog-open"); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="pc-drawer-layer" onMouseDown={event => event.target === event.currentTarget && onClose()}><aside className="pc-drawer" ref={root} role="dialog" aria-modal="true" aria-labelledby="pc-drawer-title"><header><div><p className="eyebrow">Product details</p><h2 id="pc-drawer-title">{row.title || "Untitled listing"}</h2></div><button className="pc-icon-button" ref={close} onClick={onClose} aria-label="Close product details"><X size={20}/></button></header><div className="pc-drawer-body"><div className="pc-drawer-product"><ProductImage row={row}/><div><strong>{variant(row)}</strong><span className={`pc-status ${status(row) === "Active" ? "active" : "inactive"}`}>{status(row)}</span></div></div><dl>{[["Seller SKU", <span>{row.sellerSku || "Not available"}{row.sellerSku && <button className="pc-copy" onClick={() => copy(row.sellerSku)} aria-label="Copy Seller SKU"><Copy size={14}/></button>}</span>], ["TikTok listed price", listed(row)], ["Available TikTok stock", row.stock ?? "Not available"], ["Capital cost per unit", row.capitalCost == null ? "Missing capital cost" : money(row.capitalCost)], ["Average final settlement / unit", row.averageSettlementPrice == null ? "No settlement data" : settlementMoney(row, row.averageSettlementPrice)], ["Confirmed settlement profit / unit", row.averageSettlementProfit == null ? "Unconfirmed" : settlementMoney(row, row.averageSettlementProfit)], ["Confirmed profit margin", margin(row)], ["Eligible settled units", row.settledUnits || 0], ["Last synchronized", date(row.lastSyncedAt)], ["Product ID", row.tiktokProductId], ["Variant ID", row.tiktokSkuId]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="pc-finance-note"><strong>About these financial metrics</strong><p>Based on imported, reconciled positive sales containing only this variant. Multi-variant orders, refunds and adjustments are excluded. Profit uses historical order capital, not today's catalog cost or listed price.</p></div></div></aside></div>;
}

export default function TikTokProducts() {
  const { user } = useAuth(); const admin = user?.role === "admin";
  const [data, setData] = useState({ products: [], pages: 1, total: 0 }); const [search, setSearch] = useState(""); const [filter, setFilter] = useState("all"); const [sort, setSort] = useState("title_asc"); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true); const [syncing, setSyncing] = useState(false); const [notice, setNotice] = useState(null); const [selected, setSelected] = useState(null); const [editing, setEditing] = useState(null); const [draft, setDraft] = useState(""); const [saving, setSaving] = useState(false); const [costError, setCostError] = useState(""); const [pricingRow, setPricingRow] = useState(null);
  const sequence = useRef(0); const savingLock = useRef(false);
  const load = async () => {
    const current = ++sequence.current; setLoading(true);
    try {
      const result = await getTikTokProducts(search, page, false, sort, { filter, pageSize });
      if (current !== sequence.current) return;
      setData(result); if (result.page !== page) setPage(result.page);
      setSelected(previous => previous ? result.products.find(row => row._id === previous._id) || previous : null);
    } catch (error) { if (current === sequence.current) { setData({ products: [], pages: 1, total: 0 }); setNotice({ type: "error", text: error.message }); } }
    finally { if (current === sequence.current) setLoading(false); }
  };
  useEffect(() => { const timer = setTimeout(load, 250); return () => { clearTimeout(timer); sequence.current++; }; }, [search, filter, sort, page, pageSize]);
  useSyncCompletion("products", load); useSyncCompletion("settlements", load);
  const sync = async () => { setSyncing(true); setNotice(null); try { const result = await syncTikTokProducts(); setNotice({ type: "success", text: `Synchronized ${result.count || 0} TikTok variants.` }); await load(); } catch (error) { setNotice({ type: "error", text: error.message }); } finally { setSyncing(false); } };
  const copy = async sku => { try { await navigator.clipboard.writeText(sku); setNotice({ type: "success", text: "Seller SKU copied." }); } catch { setNotice({ type: "error", text: "Clipboard is unavailable. Select and copy the displayed SKU." }); } };
  const startEditing = row => { setEditing(row._id); setDraft(row.capitalCost == null ? "" : String(row.capitalCost)); setCostError(""); };
  const save = async row => {
    if (savingLock.current) return;
    if (!/^\d+(\.\d{1,2})?$/.test(draft.trim())) { setCostError("Enter a non-negative PHP amount with up to two decimal places."); return; }
    savingLock.current = true; setSaving(true); setCostError(""); setNotice(null);
    try {
      await updateTikTokVariantCosts([{ variantId: row._id, cost: draft.trim() }], "Product inventory capital cost update");
      setSelected(previous => previous?._id === row._id ? { ...previous, capitalCost: Number(draft) } : previous);
      setEditing(null); setNotice({ type: "success", text: "Capital cost saved for future orders. Existing order snapshots and confirmed profits were preserved." }); await load();
    } catch (error) { setCostError(error.message); }
    finally { savingLock.current = false; setSaving(false); }
  };
  const resetPage = setter => event => { setter(event.target.value); setPage(1); setEditing(null); };
  const costCell = row => editing === row._id ? <form className="pc-cost-form" onSubmit={event => { event.preventDefault(); save(row); }}><label><span className="sr-only">Capital cost for {row.title} {row.sellerSku}</span><span aria-hidden="true">₱</span><input autoFocus type="number" inputMode="decimal" min="0" step="0.01" value={draft} onChange={event => setDraft(event.target.value)} disabled={saving} aria-invalid={Boolean(costError)} aria-describedby={costError ? `cost-error-${row._id}` : undefined}/></label><div><button type="submit" disabled={saving} aria-label={`Save capital cost for ${row.sellerSku || row.title}`}><Check size={15}/>{saving ? "Saving…" : "Save"}</button><button type="button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button></div>{costError && <small id={`cost-error-${row._id}`} role="alert">{costError}</small>}</form> : admin ? <button className={`pc-edit-cost ${row.capitalCost == null ? "missing" : ""}`} onClick={() => startEditing(row)} disabled={saving} aria-label={`Edit capital cost for ${row.sellerSku || row.title}`}><span>{row.capitalCost == null ? "Add cost" : money(row.capitalCost)}</span><Pencil size={13}/></button> : <span>{row.capitalCost == null ? "Missing" : money(row.capitalCost)}</span>;
  return <section className="product-catalog"><div className="page-header"><div className="standard-page-title"><p className="eyebrow">TikTok Shop / Catalog</p><h1>Product Inventory</h1><p className="muted">Your TikTok listings, stock and capital costs in one place.</p></div>{admin && <button className="primary-button header-button" disabled={syncing || saving} onClick={sync}><RefreshCw size={16}/>{syncing ? "Synchronizing…" : "Sync products"}</button>}</div>
    {notice && <div className={`notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={16}/></button></div>}
    <TikTokSyncProgress type="products"/>
    <div className="panel pc-panel"><div className="pc-toolbar"><label className="pc-search"><Search size={17}/><span className="sr-only">Search products, Seller SKU or variant</span><input type="search" placeholder="Search products, SKU or variant…" value={search} onChange={resetPage(setSearch)} disabled={saving}/></label><label>Show<select value={filter} onChange={resetPage(setFilter)} disabled={saving}><option value="all">All products</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="out_of_stock">Out of stock</option><option value="missing_cost">Missing capital cost</option><option value="profitable">Profitable (confirmed)</option><option value="unprofitable">Unprofitable (confirmed)</option></select></label><label>Sort by<select value={sort} onChange={resetPage(setSort)} disabled={saving}>{[["title_asc", "Name: A–Z"], ["title_desc", "Name: Z–A"], ["price_asc", "Price: low–high"], ["price_desc", "Price: high–low"], ["stock_asc", "Stock: low–high"], ["stock_desc", "Stock: high–low"], ["capital_asc", "Capital: low–high"], ["capital_desc", "Capital: high–low"], ["margin_desc", "Margin: high–low"], ["margin_asc", "Margin: low–high"], ["synced_desc", "Recently synchronized"], ["synced_asc", "Oldest synchronized"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="pc-results"><span><strong>{data.total || 0}</strong> variants</span><span>Stock from TikTok · Capital maintained in RJE</span></div>
      <div className="pc-table-wrap" aria-busy={loading}><table className="pc-table"><caption className="sr-only">TikTok product inventory, confirmed settlement margins and advisory pricing</caption><thead><tr>{["Product / Variant", "Seller SKU", "TikTok Price", "Stock", "Capital Cost", "Confirmed Margin", "Suggested Price", "Status"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{loading ? Array.from({ length: 5 }, (_, index) => <tr className="pc-skeleton-row" key={index}><td colSpan="8"><span className="pc-skeleton"/></td></tr>) : data.products.map(row => <tr key={row._id}><td><button className="pc-product" onClick={() => setSelected(row)} aria-label={`View ${row.title}, ${variant(row)}`}><ProductImage row={row}/><span><strong>{row.title || "Untitled listing"}</strong><small>{variant(row)}</small></span></button></td><td data-label="Seller SKU"><div className="pc-sku"><span>{row.sellerSku || "Not available"}</span>{row.sellerSku && <button onClick={() => copy(row.sellerSku)} className="pc-copy" aria-label={`Copy SKU ${row.sellerSku}`}><Copy size={14}/></button>}</div></td><td data-label="TikTok Price">{listed(row)}</td><td data-label="Stock"><span className={row.stock === 0 ? "pc-stock-zero" : data.enableLowStockAlerts !== false && row.stock != null && row.stock <= (data.lowStockThreshold ?? 5) ? "pc-stock-low" : ""}>{row.stock ?? "Not available"}</span>{data.enableLowStockAlerts !== false && row.stock > 0 && row.stock <= (data.lowStockThreshold ?? 5) && <small className="pc-stock-caption">Low stock</small>}</td><td data-label="Capital Cost">{costCell(row)}</td><td data-label="Confirmed Margin"><span className={row.settlementProfitMargin == null ? "pc-unconfirmed" : row.settlementProfitMargin < 0 ? "pc-loss" : "pc-confirmed"}>{margin(row)}</span></td><td data-label="Suggested Price"><button className="pc-pricing-action" aria-label={`View pricing breakdown for ${row.sellerSku || row.title}`} onClick={() => setPricingRow(row)}><strong>{row.pricing?.status === "ready" ? money(row.pricing.suggestedPrice) : row.capitalCost == null ? "Set Capital Cost" : row.pricing?.message || "Insufficient Settlement Data"}</strong>{row.pricing?.status === "ready" && <><small>Est. margin {row.pricing.estimatedMargin.toFixed(2)}%</small><small>{row.pricing.differenceFromCurrent == null ? "Current price unavailable" : `${Number(row.pricing.differenceFromCurrent) >= 0 ? "+" : ""}${money(row.pricing.differenceFromCurrent)} vs listed`}</small><small>{row.pricing.source === "manual_assumption" ? "Assumed deductions" : "Historical estimate"}</small></>}<span>View Pricing Breakdown</span></button></td><td data-label="Status"><span className={`pc-status ${status(row) === "Active" ? "active" : "inactive"}`}>{status(row)}</span></td></tr>)}</tbody></table>
        {loading && <span className="sr-only" role="status">Loading product inventory…</span>}
        {!loading && !data.products.length && <div className="pc-empty"><PackageSearch size={30}/><h2>No matching products</h2><p>Try a different search or filter, or sync your TikTok listings.</p><button onClick={() => { setSearch(""); setFilter("all"); setPage(1); }}>Clear search and filters</button></div>}
      </div>
      <footer className="pc-pagination"><label>Rows per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); setEditing(null); }} disabled={saving || loading}>{[10, 25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label><span>Page {data.page || page} of {data.pages || 1}</span><div><button aria-label="Previous page" disabled={saving || loading || page <= 1} onClick={() => { setPage(value => value - 1); setEditing(null); }}><ChevronLeft size={17}/></button><button aria-label="Next page" disabled={saving || loading || page >= data.pages} onClick={() => { setPage(value => value + 1); setEditing(null); }}><ChevronRight size={17}/></button></div></footer>
    </div><p className="pc-page-note">Confirmed margins use eligible reconciled settlements. Suggested prices and estimated margins are advisory projections; no TikTok prices are changed.</p>
    {pricingRow && <PricingDrawer key={pricingRow._id} row={pricingRow} onClose={() => setPricingRow(null)}/>}
    {selected && <ProductDrawer row={selected} onClose={() => setSelected(null)} copy={copy}/>}
  </section>;
}
