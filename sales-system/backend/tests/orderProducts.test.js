import test from "node:test";
import assert from "node:assert/strict";
import { uniqueOrderLines } from "../services/orderLineIdentity.js";
import { orderProducts } from "../../frontend/src/utils/orderProducts.js";
const line = (overrides = {}) => ({ lineItemId: "l1", productId: "p1", skuId: "s1", productName: "Same name", quantity: 1, salePrice: "10.00", ...overrides });
test("single product and explicit multi-unit quantity", () => {
  assert.equal(orderProducts([line()])[0].quantity, 1);
  assert.equal(orderProducts([line({ quantity: 3 })])[0].quantity, 3);
});
test("distinct purchased line IDs group by variant without losing units", () => {
  const lines = [line(), line({ lineItemId: "l2" }), line({ lineItemId: "l3" })];
  assert.equal(uniqueOrderLines(lines).length, 3);
  assert.equal(orderProducts(lines)[0].quantity, 3);
});
test("same names with different variants and products remain separate", () => {
  assert.equal(orderProducts([line(), line({ skuId: "s2" }), line({ productId: "p2" })]).length, 3);
  assert.equal(orderProducts([line({ skuId: null }), line({ skuId: null })]).length, 2);
});
test("exact repeated API line IDs collapse; conflicting identities fail closed", () => {
  assert.equal(uniqueOrderLines([line(), line()]).length, 1);
  assert.throws(() => uniqueOrderLines([line(), line({ quantity: 2 })]), /Conflicting/);
  assert.equal(uniqueOrderLines([line({ lineItemId: null }), line({ lineItemId: null })]).length, 2);
});
test("different prices cannot be presented as one unit price", () => {
  assert.equal(orderProducts([line(), line({ lineItemId: "l2", salePrice: "12" })])[0].unitPrice, null);
});
test("multiple transactions, refunds and partial settlements retain original order quantities", () => {
  const lines = [line({ quantity: 3 })];
  for (const settlement of [100, 50, -20]) {
    const transaction = { settlement, linkedOrderId: { lines } };
    assert.equal(orderProducts(transaction.linkedOrderId.lines)[0].quantity, 3);
    assert.equal(transaction.settlement, settlement);
  }
});
