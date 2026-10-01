import { useEffect, useState } from "react";
import { adjustStock, getInventory, getInventoryMovements, stockIn } from "../services/inventoryService.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { downloadExport } from "../services/exportService.js";

const emptyOperation = { productId: "", quantity: "", reason: "" };

function Inventory() {
  const { formatCurrency: peso, formatDate } = useSettings();
  const [inventory, setInventory] = useState({ summary: {}, products: [], lowStockThreshold: 5 });
  const [movements, setMovements] = useState([]);
  const [operation, setOperation] = useState(null);
  const [form, setForm] = useState(emptyOperation);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportInventory = async () => { try { setIsExporting(true); await downloadExport("inventory?format=csv", "RJE_Inventory.csv"); } catch (error) { setNotice({ type: "error", text: error.message }); } finally { setIsExporting(false); } };

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [loadedInventory, loadedMovements] = await Promise.all([getInventory(), getInventoryMovements()]);
      setInventory(loadedInventory);
      setMovements(loadedMovements);
    } catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setIsLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const submitOperation = async (event) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    if (!form.productId || !Number.isInteger(quantity) || quantity === 0 || (operation === "stock-in" && quantity < 0)) {
      setNotice({ type: "error", text: operation === "stock-in" ? "Enter a positive whole-number quantity." : "Enter a non-zero whole-number adjustment." });
      return;
    }
    try {
      setIsSaving(true);
      const data = { ...form, quantity };
      if (operation === "stock-in") await stockIn(data);
      else await adjustStock(data);
      setNotice({ type: "success", text: operation === "stock-in" ? "Stock added successfully." : "Stock adjusted successfully." });
      setOperation(null);
      setForm(emptyOperation);
      await loadData();
    } catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setIsSaving(false); }
  };

  const openOperation = (type, productId = "") => {
    setOperation(type);
    setForm({ ...emptyOperation, productId });
  };

  return (
    <section>
      <div className="page-header"><div><p className="eyebrow">Inventory management</p><h1>Inventory</h1><p className="muted">Track stock levels and inventory movements.</p></div><button className="primary-button report-export-button" onClick={exportInventory} disabled={isExporting}>{isExporting ? "Exporting..." : "Export CSV"}</button></div>
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}<button onClick={() => setNotice({ type: "", text: "" })}>×</button></div>}
      <div className="summary-grid">
        {[["Total products", inventory.summary.totalProducts || 0], ["Total stock units", inventory.summary.totalStock || 0], ["Low stock products", inventory.summary.lowStockProducts || 0], ["Out of stock", inventory.summary.outOfStockProducts || 0]].map(([label, value]) => <div className="summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      {operation && <form className="panel product-form" onSubmit={submitOperation}>
        <div className="form-heading"><div><p className="eyebrow">{operation === "stock-in" ? "Stock in" : "Stock adjustment"}</p><h2>{operation === "stock-in" ? "Add incoming stock" : "Adjust stock"}</h2></div><button type="button" className="text-button" onClick={() => setOperation(null)}>Cancel</button></div>
        <label>Product<select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} required><option value="">Select product</option>{inventory.products.map((product) => <option key={product._id} value={product._id}>{product.name} ({product.stock} available)</option>)}</select></label>
        <div className="form-grid"><label>{operation === "stock-in" ? "Quantity to add" : "Adjustment quantity"}<input type="number" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} placeholder={operation === "stock-in" ? "20" : "-3 or 3"} required /></label><label>Reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength="200" required /></label></div>
        <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save movement"}</button>
      </form>}
      <div className="panel product-list-panel"><div className="list-toolbar"><div><p className="eyebrow">Current stock</p><h2>Stock levels</h2></div><div className="sales-header-actions"><button className="primary-button" onClick={() => openOperation("stock-in")}>+ Stock in</button><button className="text-button" onClick={() => openOperation("adjustment")}>Adjust stock</button></div></div>
        {isLoading ? <p className="empty-state">Loading inventory...</p> : <div className="table-wrapper"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Capital price</th><th>Selling price</th><th>Current stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>{inventory.products.map((product) => { const status = product.stock === 0 ? "Out of stock" : product.stock <= inventory.lowStockThreshold ? "Low stock" : "In stock"; return <tr key={product._id}><td><strong>{product.name}</strong></td><td>{product.sku}</td><td>{product.category}</td><td>{peso(product.capitalPrice)}</td><td>{peso(product.sellingPrice)}</td><td>{product.stock}</td><td><span className={`stock-badge ${status !== "In stock" ? "low" : ""}`}>{status}</span></td><td><button className="icon-button" onClick={() => openOperation("stock-in", product._id)}>Stock in</button><button className="icon-button" onClick={() => openOperation("adjustment", product._id)}>Adjust</button></td></tr>; })}</tbody></table></div>}
      </div>
      <div className="panel report-table-panel"><div className="list-toolbar"><div><p className="eyebrow">Movement history</p><h2>Inventory movements</h2></div></div><div className="table-wrapper"><table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Quantity</th><th>Previous stock</th><th>New stock</th><th>Reason</th><th>Reference</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement._id}><td>{formatDate(movement.createdAt)}</td><td>{movement.productName}</td><td>{movement.type}</td><td>{movement.type === "STOCK_IN" || movement.type === "ADJUSTMENT_IN" || movement.type === "SALE_CANCELLATION" ? "+" : "-"}{movement.quantity}</td><td>{movement.previousStock}</td><td>{movement.newStock}</td><td>{movement.reason}</td><td>{movement.referenceId || "—"}</td></tr>)}</tbody></table></div></div>
    </section>
  );
}

export default Inventory;
