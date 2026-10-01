import { useEffect, useMemo, useState } from "react";
import { getProducts } from "../services/productService.js";
import { createSale, deleteSale, getSales, updateSale } from "../services/saleService.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { downloadExport } from "../services/exportService.js";

const emptyForm = { date: new Date().toISOString().slice(0, 10), productId: "", quantity: "1", tiktokFees: "0", withholdingTax: "0" };
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
  const [productSearch, setProductSearch] = useState("");
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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
    const totalSales = quantity * sellingPrice;
    const totalCapital = quantity * capitalPrice;
    const netSales = totalSales - tiktokFees - withholdingTax;
    const profit = netSales - totalCapital;
    return { totalSales, totalCapital, netSales, profit, profitMargin: netSales === 0 ? 0 : (profit / netSales) * 100 };
  }, [quantity, sellingPrice, capitalPrice, tiktokFees, withholdingTax]);

  const handleChange = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    const isWithholdingOnly = !form.productId;
    if (!isWithholdingOnly && (!Number.isInteger(quantity) || quantity <= 0)) return setNotice({ type: "error", text: "Quantity must be a whole number greater than zero." });
    if (isWithholdingOnly && withholdingTax <= 0) return setNotice({ type: "error", text: "Select a product or enter a withholding tax amount." });
    if (tiktokFees < 0) return setNotice({ type: "error", text: "TikTok fees cannot be negative." });
    if (withholdingTax < 0) return setNotice({ type: "error", text: "Withholding tax cannot be negative." });
    try {
      setIsSaving(true);
      const payload = { date: form.date, quantity: isWithholdingOnly ? 0 : quantity, tiktokFees, withholdingTax };
      if (editingSale) await updateSale(editingSale._id, payload);
      else await createSale({ ...payload, productId: form.productId });
      setNotice({ type: "success", text: editingSale ? "Sale updated successfully." : "Sale added successfully." });
      setEditingSale(null);
      setForm(emptyForm);
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
      <div className="page-header"><div><p className="eyebrow">Revenue tracking</p><h1>Sales</h1><p className="muted">Record sales and track profitability using historical prices.</p></div><div className="sales-header-actions"><button className="primary-button header-button" type="button" onClick={() => { setEditingSale(null); setForm(emptyForm); setProductSearch(""); }}>+ Add sale</button><button className="text-button" type="button" onClick={exportSales} disabled={isExporting}>{isExporting ? "Exporting..." : "Export CSV"}</button><div className="stat-pill"><span>Total sales</span><strong>{sales.length}</strong></div></div></div>
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}<button onClick={() => setNotice({ type: "", text: "" })}>×</button></div>}
      <div className="sales-layout">
        <form className="product-form" onSubmit={handleSubmit}>
          <div className="form-heading"><div><p className="eyebrow">{editingSale ? "Update sale" : "New transaction"}</p><h2>{editingSale ? "Edit sale" : "Add sale"}</h2></div>{editingSale && <button type="button" className="text-button" onClick={() => { setEditingSale(null); setForm(emptyForm); }}>Cancel</button>}</div>
          <label>Date<input name="date" type="date" value={form.date} onChange={handleChange} required /></label>
          <label>Product (optional for withholding tax)
            <div className="product-search">
              <input
                value={productSearch}
                onChange={(event) => {
                  setProductSearch(event.target.value);
                  if (editingSale) return;
                  setForm((current) => ({ ...current, productId: "" }));
                }}
                placeholder="Search added products..."
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
          {form.productId && <div className="price-preview"><span>Selling price<strong>{peso(sellingPrice)}</strong></span><span>Capital price<strong>{peso(capitalPrice)}</strong></span></div>}
          <div className="form-grid"><label>Quantity<input name="quantity" type="number" min="0" step="1" value={form.quantity} onChange={handleChange} required /></label><label>TikTok fees<input name="tiktokFees" type="number" min="0" step="0.01" value={form.tiktokFees} onChange={handleChange} required disabled={!settings.allowManualTikTokFee} /></label><label>Withholding tax<input name="withholdingTax" type="number" min="0" step="0.01" value={form.withholdingTax} onChange={handleChange} required /></label></div>
          <div className="calculation-preview"><p className="eyebrow">Calculation preview</p><div><span>Total sales</span><strong>{peso(preview.totalSales)}</strong></div><div><span>Total capital</span><strong>{peso(preview.totalCapital)}</strong></div><div><span>Net sales</span><strong>{peso(preview.netSales)}</strong></div><div><span>Profit</span><strong>{peso(preview.profit)}</strong></div><div><span>Profit margin</span><strong>{percent(preview.profitMargin)}</strong></div></div>
          <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editingSale ? "Save changes" : "Add transaction"}</button>
        </form>
        <div className="panel product-list-panel"><div className="list-toolbar"><div><p className="eyebrow">Transaction history</p><h2>All sales</h2></div></div>{isLoading ? <p className="empty-state">Loading sales...</p> : sales.length === 0 ? <p className="empty-state">No sales yet. Add your first sale.</p> : <div className="table-wrapper"><table><thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Selling price</th><th>Capital price</th><th>TikTok fees</th><th>Withholding tax</th><th>Total sales</th><th>Net sales</th><th>Profit</th><th>Margin</th><th>Actions</th></tr></thead><tbody>{sales.map((sale) => { const product = products.find((item) => item._id === sale.productId); return <tr key={sale._id}><td>{new Date(sale.date).toLocaleDateString("en-PH")}</td><td><strong>{product ? productDisplayName(product) : sale.productName}</strong></td><td>{sale.quantity}</td><td>{peso(sale.sellingPrice)}</td><td>{peso(sale.capitalPrice)}</td><td>{peso(sale.tiktokFees)}</td><td>{peso(sale.withholdingTax || 0)}</td><td>{peso(sale.totalSales)}</td><td>{peso(sale.netSales)}</td><td>{peso(sale.profit)}</td><td>{percent(sale.profitMargin)}</td><td className="actions"><button className="icon-button" onClick={() => editSale(sale)}>Edit</button><button className="icon-button danger" onClick={() => handleDelete(sale)}>Delete</button></td></tr>; })}</tbody></table></div>}</div>
      </div>
    </section>
  );
}

export default Sales;
