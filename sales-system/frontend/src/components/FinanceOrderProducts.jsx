import { orderProducts } from "../utils/orderProducts.js";

const money = (value, currency) => currency && Number.isFinite(Number(value)) ? new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value)) : `${value} (currency unavailable)`;
export default function FinanceOrderProducts({ transaction }) {
  const products = orderProducts(transaction.linkedOrderId?.lines);
  if (!products.length) return <strong>{transaction.tiktokOrderId ? "Product information unavailable" : "Statement adjustment"}</strong>;
  return <details className="sf-order-products"><summary><strong>{products.length} product variant{products.length === 1 ? "" : "s"} · {products.reduce((sum, item) => sum + item.quantity, 0)} units</strong><span>View original order products</span></summary><p>Original purchased quantities; refunds and partial settlements may cover fewer units. These item amounts are not settlement totals.</p><ul>{products.map(product => <li key={product.key}><strong>{product.name} × {product.quantity}</strong><span>{product.variant || "Variant unavailable"}</span>{product.skuId && <span>SKU ID: {product.skuId}</span>}{product.unitPrice != null && <span>Unit price: {money(product.unitPrice, product.currency)} · Item total: {money((Number(product.unitPrice) * product.quantity).toFixed(2), product.currency)}</span>}<small>Order lines: {product.lineIds.join(", ") || "IDs unavailable"}</small></li>)}</ul></details>;
}
