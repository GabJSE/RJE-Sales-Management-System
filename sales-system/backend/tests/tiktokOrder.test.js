import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTikTokOrder } from "../services/tiktokOrderService.js";

const order = overrides => ({
  id: "123", status: "AWAITING_SHIPMENT", create_time: 1700000000, update_time: 1700000100,
  payment: { currency: "PHP", total_amount: "199.50", sub_total: "180.00" },
  line_items: [{ id: "line-1", product_id: "product-1", sku_id: "sku-1", seller_sku: "ABC", product_name: "Brake pad", currency: "PHP", sale_price: "180.00" }],
  ...overrides,
});

test("normalizes order money as strings and timestamps as UTC dates", () => {
  const result = normalizeTikTokOrder(order(), [], new Map());
  assert.equal(result.totalAmount, "199.50"); assert.equal(result.lines[0].salePrice, "180.00");
  assert.equal(result.createdAtTikTok.toISOString(), "2023-11-14T22:13:20.000Z");
});

test("supports multiple line items and maps by TikTok SKU", () => {
  const source = order({ line_items: [...order().line_items, { id: "line-2", sku_id: "sku-2", seller_sku: "XYZ", product_name: "Cable" }] });
  const result = normalizeTikTokOrder(source, [{ tiktokProductId: "product-1", tiktokSkuId: "sku-1" }], [{ tiktokProductId: "product-1", tiktokSkuId: "sku-1", costMinor: "8000", effectiveFrom: new Date("2020-01-01") }]);
  assert.equal(result.lines.length, 2); assert.equal(result.lines[0].mappingStatus, "mapped"); assert.equal(result.lines[0].capitalCostSnapshot, 80); assert.equal(result.lines[1].mappingStatus, "unmatched");
});

test("seller SKU text is not used as variant identity", () => {
  const result = normalizeTikTokOrder(order(), [], new Map([["ABC", { _id: "rje-1", capitalPrice: 75 }]]));
  assert.equal(result.lines[0].mappingSource, "none"); assert.equal(result.lines[0].capitalCostSnapshot, undefined);
});

test("preserves historical cost and appends status history only on change", () => {
  const existing = { shopId: "shop", lines: [{ lineItemId: "line-1", rjeProductId: "rje-old", capitalCostSnapshot: 60, mappingStatus: "mapped", mappingSource: "seller_sku" }], statusHistory: [{ status: "AWAITING_SHIPMENT", observedAt: new Date(1700000100000) }] };
  const unchanged = normalizeTikTokOrder(order(), [], new Map([["ABC", { _id: "rje-new", capitalPrice: 99 }]]), existing);
  assert.equal(unchanged.lines[0].capitalCostSnapshot, 60); assert.equal(unchanged.statusHistory.length, 1);
  const changed = normalizeTikTokOrder(order({ status: "IN_TRANSIT", update_time: 1700000200 }), [], new Map(), existing);
  assert.equal(changed.statusHistory.length, 2); assert.equal(changed.statusHistory[1].status, "IN_TRANSIT");
});
