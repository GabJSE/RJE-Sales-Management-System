import { useEffect, useMemo, useState } from "react";
import ProductForm from "../components/ProductForm.jsx";
import { createProduct, deleteProduct, getProducts, updateProduct } from "../services/productService.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { downloadExport } from "../services/exportService.js";

function Products() {
  const { formatCurrency: peso } = useSettings();
  const [products, setProducts] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportProducts = async () => { try { setIsExporting(true); await downloadExport("products?format=csv", "RJE_Products.csv"); } catch (error) { setNotice({ type: "error", text: error.message }); } finally { setIsExporting(false); } };

  const loadProducts = async () => {
    try {
      setIsLoading(true);
      setProducts(await getProducts());
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadProducts(); }, []);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      [product.name, product.brand, product.model, product.sku, product.category]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term))
    );
  }, [products, search]);

  const handleSubmit = async (product) => {
    try {
      setIsSaving(true);
      if (editingProduct) {
        await updateProduct(editingProduct._id, product);
        setNotice({ type: "success", text: "Product updated successfully." });
      } else {
        await createProduct(product);
        setNotice({ type: "success", text: "Product added successfully." });
      }
      setEditingProduct(null);
      await loadProducts();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (product) => {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    try {
      await deleteProduct(product._id);
      setNotice({ type: "success", text: "Product deleted successfully." });
      await loadProducts();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  };

  return (
    <section>
      <div className="page-header">
        <div><p className="eyebrow">Inventory management</p><h1>Products</h1><p className="muted">Manage your motorcycle parts catalog and current stock.</p></div><button className="primary-button report-export-button" onClick={exportProducts} disabled={isExporting}>{isExporting ? "Exporting..." : "Export CSV"}</button>
        <div className="stat-pill"><span>Total products</span><strong>{products.length}</strong></div>
      </div>
      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}<button onClick={() => setNotice({ type: "", text: "" })}>×</button></div>}
      <div className="products-layout">
        <ProductForm product={editingProduct} onSubmit={handleSubmit} onCancel={() => setEditingProduct(null)} isSaving={isSaving} />
        <div className="panel product-list-panel">
          <div className="list-toolbar"><div><p className="eyebrow">Catalog</p><h2>All products</h2></div><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, SKU, category" aria-label="Search products" /></div>
          {isLoading ? <p className="empty-state">Loading products...</p> : filteredProducts.length === 0 ? <p className="empty-state">{search ? "No products match your search." : "No products yet. Add your first product."}</p> : (
            <div className="table-wrapper"><table><thead><tr><th>Product</th><th>Category</th><th>Capital price</th><th>Selling price</th><th>Stock</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {filteredProducts.map((product) => <tr key={product._id}><td><strong>{product.brand ? `${product.brand} ${product.category || ""} ${product.model || ""}`.replace(/\s+/g, " ").trim() : product.name}</strong><small>{product.sku}</small></td><td>{product.category}</td><td>{peso(product.capitalPrice)}</td><td>{peso(product.sellingPrice)}</td><td><span className={`stock-badge ${product.stock <= 5 ? "low" : ""}`}>{product.stock}</span></td><td className="actions"><button className="icon-button" onClick={() => setEditingProduct(product)} aria-label={`Edit ${product.name}`}>Edit</button><button className="icon-button danger" onClick={() => handleDelete(product)} aria-label={`Delete ${product.name}`}>Delete</button></td></tr>)}
            </tbody></table></div>
          )}
        </div>
      </div>
    </section>
  );
}

export default Products;
