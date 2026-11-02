import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEarning, normalizeFinanceTransaction } from "../services/tiktokSettlementService.js";
import { toMinor } from "../services/money.js";
const context = overrides => ({ shopId: "shop", statementId: "statement", statementDate: new Date("2026-01-01T00:00:00Z"), currency: "PHP", order: { _id: "mongo-order", lines: [{ skuId: "sku-1", mappingStatus: "mapped", capitalCostSnapshot: 125.55 }] }, orderFinance: { sku_transactions: [{ sku_id: "sku-1", statement_id: "statement", quantity: 1 }] }, ...overrides });
const row = overrides => ({ id: "tx", type: "ORDER", order_id: "order", revenue_amount: "500.10", fee_tax_breakdown: { fee: { commission: "-25.01" }, tax: { pit_amount: "-2.50" } }, shipping_cost_amount: "-10", settlement_amount: "462.59", ...overrides });
test("minor-unit conversion avoids floating point arithmetic", () => { assert.equal(toMinor("100.10") + toMinor("0.20"), 10030n); });
test("normalizes Seller Center Earnings without losing transaction precision", () => { const result = normalizeEarning({ id: "3746599047283901707", amount: "2640.99", currency: "PHP", type: "SETTLE", status: "SUCCESS", create_time: 1793324066 }, "shop"); assert.equal(result.transactionId, "3746599047283901707"); assert.equal(result.amountMinor, "264099"); assert.equal(result.type, "SETTLE"); });
test("imports actual fees, taxes, settlement and historical capital", () => { const result = normalizeFinanceTransaction(row(), context()); assert.equal(result.feeMinor, "-2501"); assert.equal(result.taxMinor, "-250"); assert.equal(result.capitalCostMinor, "12555"); assert.equal(result.profitMinor, "33704"); assert.equal(result.reconciliationStatus, "reconciled"); });
test("uses TikTok's contributory fee-tax total without double-counting before-PIT references", () => { const result = normalizeFinanceTransaction(row({ fee_tax_amount: "-27.51", fee_tax_breakdown: { fee: { affiliate_commission_amount: "-25.01", affiliate_commission_amount_before_pit: "-25.01" }, tax: { pit_amount: "-2.50" } } }), context()); assert.equal(result.feeMinor, "-2501"); assert.equal(result.taxMinor, "-250"); });
test("supports multi-product capital cost", () => { const ctx = context({ order: { _id: "o", lines: [{ skuId: "a", mappingStatus: "mapped", capitalCostSnapshot: 10 }, { skuId: "b", mappingStatus: "mapped", capitalCostSnapshot: 20 }] }, orderFinance: { sku_transactions: [{ sku_id: "a", statement_id: "statement", quantity: 2 }, { sku_id: "b", statement_id: "statement", quantity: 3 }] } }); assert.equal(normalizeFinanceTransaction(row(), ctx).capitalCostMinor, "8000"); });
test("refund does not recover capital without an explicit goods return", () => { const result = normalizeFinanceTransaction(row({ revenue_amount: "-500", settlement_amount: "-480" }), context()); assert.equal(result.refundMinor, "50000"); assert.equal(result.capitalCostMinor, "0"); assert.equal(result.profitMinor, "-48000"); });
test("explicit goods return reverses capital impact", () => { const ctx = context({ orderFinance: { sku_transactions: [{ sku_id: "sku-1", statement_id: "statement", quantity: 1, return_quantity: 1 }] } }); const result = normalizeFinanceTransaction(row({ revenue_amount: "-500", settlement_amount: "-480" }), ctx); assert.equal(result.capitalCostMinor, "-12555"); assert.equal(result.profitMinor, "-35445"); });
test("zero-value order transaction does not require a capital snapshot", () => { const result = normalizeFinanceTransaction(row({ revenue_amount: "0", settlement_amount: "0" }), context({ order: { _id: "o", lines: [{ skuId: "sku-1" }] } })); assert.equal(result.capitalCostMinor, "0"); assert.equal(result.profitMinor, "0"); assert.equal(result.reconciliationStatus, "reconciled"); });
test("missing historical cost remains unreconciled instead of zero", () => { const result = normalizeFinanceTransaction(row(), context({ order: { _id: "o", lines: [{ skuId: "sku-1", mappingStatus: "unmatched" }] } })); assert.equal(result.capitalCostMinor, undefined); assert.equal(result.profitMinor, undefined); assert.equal(result.reconciliationStatus, "awaiting_cost"); });
test("statement adjustments require no product capital", () => { const result = normalizeFinanceTransaction(row({ type: "SHIPPING_FEE_ADJUSTMENT", order_id: undefined, revenue_amount: "0", settlement_amount: "-5" }), context({ order: null, orderFinance: null })); assert.equal(result.capitalCostMinor, "0"); assert.equal(result.profitMinor, "-500"); });

for (const quantity of [1.5, -1, Infinity, "invalid"]) {
  test(`invalid SKU quantity ${quantity} remains unknown without BigInt errors`, () => {
    const ctx = context({ orderFinance: { sku_transactions: [{ sku_id: "sku-1", statement_id: "statement", quantity }] } });
    const result = normalizeFinanceTransaction(row(), ctx);
    assert.equal(result.capitalCostKnown, false); assert.equal(result.capitalCostMinor, undefined);
  });
}

test("settlement profit subtracts capital once, without repeating fees, shipping or adjustments", () => {
  const result = normalizeFinanceTransaction(row({ revenue_amount: "500", fee_tax_amount: "-30", shipping_cost_amount: "-20", adjustment_amount: "-5", settlement_amount: "445", fee_tax_breakdown: { tax: { pit_amount: "-5" } } }), context());
  assert.equal(result.feeMinor, "-2500"); assert.equal(result.taxMinor, "-500");
  assert.equal(result.profitMinor, "31945");
});
for (const value of [undefined, "invalid", "NaN", "1.234", Infinity]) {
  test(`invalid required settlement amount ${value} cannot become confirmed zero`, () => {
    assert.throws(() => normalizeFinanceTransaction(row({ settlement_amount: value }), context()), error => error.statusCode === 502);
  });
}

test("same SKU on multiple order lines uses each historical cost for a complete quantity", () => {
  const ctx = context({ order: { lines: [{ skuId: "sku-1", quantity: 1, capitalCostMinorSnapshot: "1000" }, { skuId: "sku-1", quantity: 2, capitalCostMinorSnapshot: "2000" }] }, orderFinance: { sku_transactions: [{ sku_id: "sku-1", statement_id: "statement", quantity: 3 }] } });
  assert.equal(normalizeFinanceTransaction(row(), ctx).capitalCostMinor, "5000");
  ctx.orderFinance.sku_transactions[0].quantity = 1;
  assert.equal(normalizeFinanceTransaction(row(), ctx).capitalCostKnown, false);
});

test("order-linked adjustment requires no local order or product cost", () => {
  const result = normalizeFinanceTransaction(row({ type: "SHIPPING_FEE_ADJUSTMENT", settlement_amount: "-5" }), context({ order: null, orderFinance: null }));
  assert.equal(result.reconciliationStatus, "reconciled"); assert.equal(result.capitalCostMinor, "0"); assert.equal(result.profitMinor, "-500");
});
for (const [settlement, cost, profit] of [["0", 0, "0"], ["10", 20, "-1000"], ["20", 20, "0"], ["-5", 20, "-2500"]]) {
  test(`signed settlement ${settlement} and capital ${cost} produce profit ${profit}`, () => {
    const ctx = context(); ctx.order.lines[0].capitalCostSnapshot = cost;
    assert.equal(normalizeFinanceTransaction(row({ settlement_amount: settlement }), ctx).profitMinor, profit);
  });
}

test("mixed sale and refund SKU finance does not charge refund quantity as new capital", () => {
  const ctx = context({ order: { lines: [{ skuId: "sku-1", capitalCostMinorSnapshot: "1000" }] }, orderFinance: { sku_transactions: [{ sku_id: "sku-1", statement_id: "statement", quantity: 2, revenue_amount: "100" }, { sku_id: "sku-1", statement_id: "statement", quantity: 1, revenue_amount: "-50" }] } });
  assert.equal(normalizeFinanceTransaction(row({ revenue_amount: "50", settlement_amount: "40" }), ctx).capitalCostMinor, "2000");
});
