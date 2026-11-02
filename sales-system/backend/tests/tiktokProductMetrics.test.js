import test from "node:test";
import assert from "node:assert/strict";
import { summarizeProductSettlements } from "../services/tiktokProductMetricsService.js";
const product = { tiktokSkuId: "sku", tiktokProductId: "p", currency: "PHP" };
const order = { orderId: "o", lines: [{ skuId: "sku", productId: "p", quantity: 2 }] };
const transaction = { tiktokOrderId: "o", transactionType: "ORDER", reconciliationStatus: "reconciled", currency: "PHP", revenueMinor: "10000", settlementMinor: "8000", profitMinor: "3000" };
const metrics = (orders = [order], transactions = [transaction]) => summarizeProductSettlements([product], orders, transactions).get("sku");
test("settlement margin uses net payout and historical profit, with per-unit settlement", () => {
  assert.deepEqual(metrics(), { averageSettlementPrice: 40, settlementProfitMargin: 37.5, settledUnits: 2, settlementTransactionCount: 1 });
});
test("margin is weighted by payout across settlements", () => {
  const result = metrics([order], [transaction, { ...transaction, settlementMinor: "2000", profitMinor: "-1000" }]);
  assert.equal(result.settlementProfitMargin, 20);
  assert.equal(result.averageSettlementPrice, 25);
});
test("multi-variant orders cannot attribute an entire payout to one variant", () => {
  assert.equal(metrics([{ ...order, lines: [...order.lines, { skuId: "other", productId: "p", quantity: 1 }] }]).settlementProfitMargin, null);
});
test("missing costs, refunds, adjustments and other currencies are excluded", () => {
  for (const override of [{ profitMinor: null }, { reconciliationStatus: "awaiting_cost" }, { revenueMinor: "-10000" }, { settlementMinor: "0" }, { transactionType: "ADJUSTMENT" }, { currency: "USD" }]) {
    assert.equal(metrics([order], [{ ...transaction, ...override }]).averageSettlementPrice, null);
  }
});
