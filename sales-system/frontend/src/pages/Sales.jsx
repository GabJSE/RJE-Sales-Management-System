import { useEffect, useMemo, useState } from "react";
import { getProducts } from "../services/productService.js";
import { createSale, deleteSale, getSales, updateSale } from "../services/saleService.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { downloadExport } from "../services/exportService.js";

const emptyForm = { date: new Date().toISOString().slice(0, 10), productId: "", quantity: "1", tiktokFees: "0", withholdingTax: "0" };
const emptyAdditionalItem = () => ({ productId: "", quantity: "1", search: "" });
const percent = (value) => `${Number(value).toFixed(2)}%`;
const productDisplayName = (product) =>
  product.brand
    ? `${product.brand} ${product.category || ""} ${product.model || ""}`.replace(/\s+/g, " ").trim()
    : product.name;

function Sales() {
  const { settings, formatCurrency: peso, formatDate } = useSettings();
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [editingSale, setEditingSale] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [additionalItems, setAdditionalItems] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({ startDate: "", endDate: "", sortBy: "date", direction: "desc" });
  const exportSales = async () => { try { setIsExporting(true); const today = new Date().toISOString().slice(0, 10); await downloadExport(`sales?format=csv&startDate=2000-01-01&endDate=${today}`, `RJE_Sales_${today}.csv`); } catch (error) { setNotice({ type: "error", text: error.message }); } finally { setIsExporting(false); } };

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [loadedSales, loadedProducts] = await Promise.all([getSales(), getProducts()]);
      setSales(loadedSales);
      setProducts(loadedProducts);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (!editingSale) setForm((current) => ({ ...current, tiktokFees: String(settings.defaultTikTokFee) })); }, [settings.defaultTikTokFee]);

  const selectedProduct = products.find((product) => product._id === form.productId);
  const historicalProduct = editingSale && !selectedProduct ? editingSale : null;
  const filteredProducts = products.filter((product) =>
    productDisplayName(product).toLowerCase().includes(productSearch.trim().toLowerCase())
  );
  const sellingPrice = selectedProduct?.sellingPrice ?? historicalProduct?.sellingPrice ?? 0;
  const capitalPrice = selectedProduct?.capitalPrice ?? historicalProduct?.capitalPrice ?? 0;
  const quantity = Number(form.quantity) || 0;
  const tiktokFees = Number(form.tiktokFees) || 0;
  const withholdingTax = Number(form.withholdingTax) || 0;
  const preview = useMemo(() => {
    const itemValues = [
      { quantity, sellingPrice, capitalPrice },
      ...additionalItems.map((item) => {
        const product = products.find((candidate) => candidate._id === item.productId);
        return { quantity: Number(item.quantity) || 0, sellingPrice: product?.sellingPrice || 0, capitalPrice: product?.capitalPrice || 0 };
      }),
    ];
    const totalSales = itemValues.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0);
    const totalCapital = itemValues.reduce((sum, item) => sum + item.quantity * item.capitalPrice, 0);
    const netSales = totalSales - tiktokFees - withholdingTax;
    const profit = netSales - totalCapital;
    return { totalSales, totalCapital, netSales, profit, profitMargin: netSales === 0 ? 0 : (profit / netSales) * 100 };
  }, [quantity, sellingPrice, capitalPrice, tiktokFees, withholdingTax, additionalItems, products]);

  const transactionHistory = useMemo(() => {
    const startTimestamp = historyFilters.startDate ? new Date(`${historyFilters.startDate}T00:00:00`).getTime() : null;
    const endTimestamp = historyFilters.endDate ? new Date(`${historyFilters.endDate}T23:59:59.999`).getTime() : null;
    const getDateTimestamp = (sale) => {
      const timestamp = new Date(sale.date).getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    };
    const getProductName = (sale) => {
      if (sale.productName) return sale.productName;
      if (sale.items?.length) return sale.items.map((item) => item.productName || "").filter(Boolean).join(" ");
      return "";
    };
    const getNumericValue = (sale, field) => {
      if (field === "quantity") return Number(sale.totalQuantity ?? sale.quantity) || 0;
      return Number(sale[field]) || 0;
    };
    const filtered = sales.filter((sale) => {
      const timestamp = getDateTimestamp(sale);
      if (startTimestamp !== null && (timestamp === null || timestamp < startTimestamp)) return false;
      if (endTimestamp !== null && (timestamp === null || timestamp > endTimestamp)) return false;
      return true;
    });
    return filtered.sort((left, right) => {
      let comparison = 0;
      if (historyFilters.sortBy === "date") {
        const leftDate = getDateTimestamp(left);
        const rightDate = getDateTimestamp(right);
        if (leftDate === null && rightDate === null) comparison = 0;
        else if (leftDate === null) comparison = 1;
        else if (rightDate === null) comparison = -1;
        else comparison = leftDate - rightDate;
      } else if (historyFilters.sortBy === "productName") {
        comparison = getProductName(left).localeCompare(getProductName(right), undefined, { sensitivity: "base" });
      } else {
        comparison = getNumericValue(left, historyFilters.sortBy) - getNumericValue(right, historyFilters.sortBy);
      }
      return historyFilters.direction === "asc" ? comparison : -comparison;
    });
  }, [sales, historyFilters]);

  const updateHistoryFilter = (name, value) => setHistoryFilters((current) => ({ ...current, [name]: value }));
  const toggleHistorySort = (sortBy) => setHistoryFilters((current) => ({
    ...current,
    sortBy,
    direction: current.sortBy === sortBy && current.direction === "asc" ? "desc" : "asc",
  }));
  const clearHistoryFilters = () => setHistoryFilters({ startDate: "", endDate: "", sortBy: "date", direction: "desc" });

  const handleChange = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    const isWithholdingOnly = !form.productId && additionalItems.every((item) => !item.productId);
    if (form.productId && (!Number.isInteger(quantity) || quantity <= 0)) return setNotice({ type: "error", text: "Quantity must be a whole number greater than zero." });
    if (additionalItems.some((item) => !item.productId || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0)) return setNotice({ type: "error", text: "Select a product and enter a positive whole-number quantity for every added product." });
    const productIds = [form.productId, ...additionalItems.map((item) => item.productId)].filter(Boolean);
    if (new Set(productIds).size !== productIds.length) return setNotice({ type: "error", text: "The same product cannot be selected twice." });
    if (isWithholdingOnly && withholdingTax <= 0) return setNotice({ type: "error", text: "Select a product or enter a withholding tax amount." });
    if (tiktokFees < 0) return setNotice({ type: "error", text: "TikTok fees cannot be negative." });
    if (withholdingTax < 0) return setNotice({ type: "error", text: "Withholding tax cannot be negative." });
    try {
      setIsSaving(true);
      const itemInputs = [
        ...(form.productId ? [form] : []),
        ...additionalItems.filter((item) => item.productId),
      ];
      const items = itemInputs.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) }));
      const payload = { date: form.date, quantity: isWithholdingOnly ? 0 : quantity, tiktokFees, withholdingTax, ...(additionalItems.length > 0 ? { items } : {}) };
      if (editingSale) await updateSale(editingSale._id, payload);
      else await createSale({ ...payload, productId: form.productId });
      setNotice({ type: "success", text: editingSale ? "Sale updated successfully." : "Sale added successfully." });
      setEditingSale(null);
      setForm(emptyForm);
      setAdditionalItems([]);
      setProductSearch("");
      await loadData();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const editSale = (sale) => {
    setEditingSale(sale);
    setAdditionalItems([]);
    setAdditionalItems([]);
    setForm({ date: new Date(sale.date).toISOString().slice(0, 10), productId: sale.productId, quantity: String(sale.quantity), tiktokFees: String(sale.tiktokFees), withholdingTax: String(sale.withholdingTax || 0) });
    setProductSearch(sale.productName);
  };

  const handleDelete = async (sale) => {
    if (!window.confirm(`Delete sale for ${sale.productName}?`)) return;
    try { await deleteSale(sale._id); setNotice({ type: "success", text: "Sale deleted successfully." }); await loadData(); }
    catch (error) { setNotice({ type: "error", text: error.message }); }
  };

  return (
    <section>
      <div className="page-header"><div><p className="eyebrow">Revenue tracking</p><h1>Sales</h1><p className="muted">Record sales and track profitability using historical prices.</p></div><div className="sales-header-actions"><button className="primary-button header-button" type="button" onClick={() => { setEditingSale(null); setForm(emptyForm); setAdditionalItems([]); setProductSearch(""); }}>+ Add sale</button><button className="text-button" type="button" onClick={exportSales} disabled={isExporting}>{isExporting ? "Exporting..." : "Export CSV"}</button><div className="stat-pill"><span>Total sales</span><strong>{sales.length}</strong></div></div></div>
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}<button onClick={() => setNotice({ type: "", text: "" })}>×</button></div>}
      <div className="sales-layout">
        <form className="product-form" onSubmit={handleSubmit}>
          <div className="form-heading"><div><p className="eyebrow">{editingSale ? "Update sale" : "New transaction"}</p><h2>{editingSale ? "Edit sale" : "Add sale"}</h2></div>{editingSale && <button type="button" className="text-button" onClick={() => { setEditingSale(null); setForm(emptyForm); setAdditionalItems([]); }}>Cancel</button>}</div>
          <label className="date-field">Date<input name="date" type="date" value={form.date} onChange={handleChange} required /></label>
          <div className="transaction-items">
            <div className="items-header"><strong>Items ({[form.productId, ...additionalItems.map((item) => item.productId)].filter(Boolean).length})</strong><span>{[form.productId, ...additionalItems.map((item) => item.productId)].filter(Boolean).length} product{[form.productId, ...additionalItems.map((item) => item.productId)].filter(Boolean).length === 1 ? "" : "s"} · {quantity + additionalItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)} item{quantity + additionalItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) === 1 ? "" : "s"}</span></div>
            <div className="additional-sale-item">
            <div className="form-grid">
              <label>Product (optional for withholding tax)
                <div className="product-search">
                  <input
                    value={productSearch}
                    onChange={(event) => {
                      setProductSearch(event.target.value);
                      if (editingSale) return;
                      setForm((current) => ({ ...current, productId: "" }));
                    }}
                    placeholder="Search product..."
                    disabled={Boolean(editingSale)}
                    aria-label="Search products"
                  />
                  {!editingSale && productSearch && !form.productId && (
                    <div className="product-search-results">
                      {filteredProducts.length === 0 ? <span className="product-search-empty">No products found.</span> : filteredProducts.map((product) => (
                        <button
                          type="button"
                          key={product._id}
                          onClick={() => {
                            setForm((current) => ({ ...current, productId: product._id }));
                            setProductSearch(productDisplayName(product));
                          }}
                        >
                          {productDisplayName(product)}
                        </button>
                      ))}
                      </div>
                  )}
                </div>
              </label>
              <label>Quantity<input name="quantity" type="number" min="0" step="1" value={form.quantity} onChange={handleChange} required /></label>
            </div>
          </div>
          {additionalItems.map((item, index) => {
            const product = products.find((candidate) => candidate._id === item.productId);
            const selectedIds = [form.productId, ...additionalItems.map((current) => current.productId)];
            const itemQuantity = Number(item.quantity) || 0;
            const searchResults = products.filter((candidate) => {
              const matchesSearch = productDisplayName(candidate).toLowerCase().includes((item.search || "").trim().toLowerCase());
              return matchesSearch && (!selectedIds.includes(candidate._id) || candidate._id === item.productId);
            });
            return <div className="additional-sale-item" key={index}>
              <div className="form-grid">
                <label>Additional product
                  <div className="product-search">
                    <input
                      value={item.search || (product ? productDisplayName(product) : "")}
                      onChange={(event) => setAdditionalItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, search: event.target.value, productId: "" } : currentItem))}
                      placeholder="Search another product..."
                      aria-label={`Search additional product ${index + 1}`}
                      required
                    />
                    {!item.productId && item.search && <div className="product-search-results">
                      {searchResults.length === 0 ? <span className="product-search-empty">No products found.</span> : searchResults.map((candidate) => <button type="button" key={candidate._id} onClick={() => setAdditionalItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, productId: candidate._id, search: productDisplayName(candidate) } : currentItem))}>{productDisplayName(candidate)}</button>)}
                    </div>}
                  </div>
                </label>
                <label>Quantity<input type="number" min="1" step="1" value={item.quantity} onChange={(event) => setAdditionalItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, quantity: event.target.value } : currentItem))} required /></label>
              </div>
              <button type="button" className="text-button" onClick={() => setAdditionalItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove product</button>
            </div>;
          })}
            <button type="button" className="add-product-button" onClick={() => setAdditionalItems((current) => [...current, emptyAdditionalItem()])}>＋ <span>Add Product</span></button>
          </div>
          {form.productId && <div className="price-preview"><span>Selling price<strong>{peso(sellingPrice)}</strong></span><span>Capital price<strong>{peso(capitalPrice)}</strong></span></div>}
          <div className="form-grid"><label>TikTok fees<input name="tiktokFees" type="number" min="0" step="0.01" value={form.tiktokFees} onChange={handleChange} required disabled={!settings.allowManualTikTokFee} /></label><label>Withholding tax<input name="withholdingTax" type="number" min="0" step="0.01" value={form.withholdingTax} onChange={handleChange} required /></label></div>
          <div className="calculation-preview"><div className="summary-heading"><span>▣</span><strong>Calculation Preview</strong></div><div className="summary-grid"><div><span>Total products</span><strong>{[form.productId, ...additionalItems.map((item) => item.productId)].filter(Boolean).length}</strong></div><div><span>Net sales</span><strong>{peso(preview.netSales)}</strong></div><div><span>Total quantity</span><strong>{quantity + additionalItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}</strong></div><div><span>Profit</span><strong>{peso(preview.profit)}</strong></div><div><span>Total sales</span><strong>{peso(preview.totalSales)}</strong></div><div><span>Profit margin</span><strong>{percent(preview.profitMargin)}</strong></div><div><span>Total capital</span><strong>{peso(preview.totalCapital)}</strong></div></div></div>
          <button className="primary-button submit-transaction" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editingSale ? "Save changes" : "▣  Submit Transaction"}</button>
        </form>
        <div className="panel product-list-panel">
          <div className="list-toolbar">
            <div><p className="eyebrow">Transaction history</p><h2>All sales</h2></div>
            <strong className="history-count">{transactionHistory.length} of {sales.length} transactions</strong>
          </div>
          <div className="history-controls">
            <label>Start date<input type="date" value={historyFilters.startDate} onChange={(event) => updateHistoryFilter("startDate", event.target.value)} /></label>
            <label>End date<input type="date" value={historyFilters.endDate} onChange={(event) => updateHistoryFilter("endDate", event.target.value)} /></label>
            <label>Sort by<select value={historyFilters.sortBy} onChange={(event) => updateHistoryFilter("sortBy", event.target.value)}><option value="date">Date</option><option value="productName">Product name</option><option value="quantity">Quantity</option><option value="totalSales">Total sales</option><option value="netSales">Net sales</option><option value="profit">Profit</option></select></label>
            <button type="button" className="icon-button" onClick={() => toggleHistorySort(historyFilters.sortBy)}>{historyFilters.direction === "asc" ? "Ascending ↑" : "Descending ↓"}</button>
            <button type="button" className="text-button" onClick={clearHistoryFilters}>Clear filters</button>
          </div>
          {isLoading ? <p className="empty-state">Loading sales...</p> : sales.length === 0 ? <p className="empty-state">No sales yet. Add your first sale.</p> : transactionHistory.length === 0 ? <p className="empty-state">No transactions match the selected filters.</p> : <div className="table-wrapper history-table-wrapper"><table><thead><tr><th><button type="button" className="table-sort-button" onClick={() => toggleHistorySort("date")}>Date {historyFilters.sortBy === "date" && (historyFilters.direction === "asc" ? "↑" : "↓")}</button></th><th><button type="button" className="table-sort-button" onClick={() => toggleHistorySort("productName")}>Product {historyFilters.sortBy === "productName" && (historyFilters.direction === "asc" ? "↑" : "↓")}</button></th><th><button type="button" className="table-sort-button" onClick={() => toggleHistorySort("quantity")}>Qty {historyFilters.sortBy === "quantity" && (historyFilters.direction === "asc" ? "↑" : "↓")}</button></th><th>Selling price</th><th>Capital price</th><th>TikTok fees</th><th>Withholding tax</th><th><button type="button" className="table-sort-button" onClick={() => toggleHistorySort("totalSales")}>Total sales {historyFilters.sortBy === "totalSales" && (historyFilters.direction === "asc" ? "↑" : "↓")}</button></th><th><button type="button" className="table-sort-button" onClick={() => toggleHistorySort("netSales")}>Net sales {historyFilters.sortBy === "netSales" && (historyFilters.direction === "asc" ? "↑" : "↓")}</button></th><th><button type="button" className="table-sort-button" onClick={() => toggleHistorySort("profit")}>Profit {historyFilters.sortBy === "profit" && (historyFilters.direction === "asc" ? "↑" : "↓")}</button></th><th>Margin</th><th>Actions</th></tr></thead><tbody>{transactionHistory.map((sale) => { const product = products.find((item) => item._id === sale.productId); const timestamp = new Date(sale.date).getTime(); return <tr key={sale._id}><td>{Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("en-PH") : "—"}</td><td><strong>{product ? productDisplayName(product) : sale.productName || sale.items?.[0]?.productName || "—"}</strong></td><td>{sale.totalQuantity ?? sale.quantity ?? 0}</td><td>{peso(sale.sellingPrice)}</td><td>{peso(sale.capitalPrice)}</td><td>{peso(sale.tiktokFees)}</td><td>{peso(sale.withholdingTax || 0)}</td><td>{peso(sale.totalSales)}</td><td>{peso(sale.netSales)}</td><td>{peso(sale.profit)}</td><td>{percent(sale.profitMargin)}</td><td className="actions"><button className="icon-button" onClick={() => editSale(sale)}>Edit</button><button className="icon-button danger" onClick={() => handleDelete(sale)}>Delete</button></td></tr>; })}</tbody></table></div>}
        </div>
      </div>
    </section>
  );
}

export default Sales;
