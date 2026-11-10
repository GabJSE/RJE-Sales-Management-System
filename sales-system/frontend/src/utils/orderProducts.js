// Group within one original order; never merge by product name or seller SKU.
export function orderProducts(lines = []) {
  const groups = new Map();
  lines.forEach((line, index) => {
    const key = line.skuId ? JSON.stringify([line.productId || "", line.skuId]) : `line:${index}`;
    if (!groups.has(key)) groups.set(key, { key, name: line.productName || "TikTok product", skuId: line.skuId, variant: line.skuName || line.sellerSku || line.skuId, quantity: 0, prices: new Set(), currency: line.currency, lineIds: [] });
    const group = groups.get(key);
    const quantity = Number(line.quantity ?? 1);
    group.quantity += Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : 0;
    group.prices.add(line.salePrice == null ? null : String(line.salePrice));
    if (line.lineItemId) group.lineIds.push(line.lineItemId);
  });
  return [...groups.values()].map(({ prices, ...group }) => ({ ...group, unitPrice: prices.size === 1 && !prices.has(null) ? [...prices][0] : null }));
}
