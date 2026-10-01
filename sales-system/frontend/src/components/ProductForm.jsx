import { useEffect, useState } from "react";

const emptyProduct = {
  name: "",
  brand: "",
  model: "",
  sku: "",
  category: "",
  capitalPrice: "",
  sellingPrice: "",
  stock: "",
};

function ProductForm({ product, onSubmit, onCancel, isSaving }) {
  const [form, setForm] = useState(emptyProduct);

  useEffect(() => {
    setForm(product ? { brand: "", model: "", ...product } : emptyProduct);
  }, [product]);

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({
      ...form,
      name: `${form.brand.trim()} ${form.category.trim()} ${form.model.trim()}`.trim(),
      capitalPrice: Number(form.capitalPrice),
      sellingPrice: Number(form.sellingPrice),
      stock: Number(form.stock),
    });
  };

  return (
    <form className="product-form" onSubmit={handleSubmit}>
      <div className="form-heading">
        <div>
          <p className="eyebrow">{product ? "Update inventory" : "New inventory item"}</p>
          <h2>{product ? "Edit product" : "Add product"}</h2>
        </div>
        {product && <button type="button" className="text-button" onClick={onCancel}>Cancel</button>}
      </div>
      <div className="form-grid">
        <label>Brand<input name="brand" value={form.brand} onChange={handleChange} required maxLength="60" placeholder="e.g. Yamaha" /></label>
        <label>Model<input name="model" value={form.model} onChange={handleChange} required maxLength="60" placeholder="e.g. NMAX 155" /></label>
      </div>
      <div className="form-grid">
        <label>SKU<input name="sku" value={form.sku} onChange={handleChange} required maxLength="50" placeholder="9003xxxx" /></label>
        <label>Category<input name="category" value={form.category} onChange={handleChange} required maxLength="80" placeholder="Engine Parts" /></label>
        <label>Capital price<input name="capitalPrice" type="number" min="0" step="0.01" value={form.capitalPrice} onChange={handleChange} required /></label>
        <label>Selling price<input name="sellingPrice" type="number" min="0" step="0.01" value={form.sellingPrice} onChange={handleChange} required /></label>
        <label>Stock quantity<input name="stock" type="number" min="0" step="1" value={form.stock} onChange={handleChange} required disabled={Boolean(product)} /></label>
      </div>
      <button className="primary-button" type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : product ? "Save changes" : "Add product"}
      </button>
    </form>
  );
}

export default ProductForm;
