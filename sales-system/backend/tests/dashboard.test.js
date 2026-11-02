import test from "node:test";
import assert from "node:assert/strict";
import { dashboardMath } from "../controllers/dashboardController.js";

test("dashboard uses Philippine business-day boundaries", () => {
  const range = dashboardMath.getDateRange("2026-10-01", "2026-10-31");
  assert.equal(range.start.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(range.endExclusive.toISOString(), "2026-10-31T16:00:00.000Z");
});

test("dashboard previous period is equal length and immediately preceding", () => {
  const current = dashboardMath.getDateRange("2026-10-01", "2026-10-31");
  const previous = dashboardMath.previousRange(current);
  assert.equal(previous.endExclusive.toISOString(), current.start.toISOString());
  assert.equal(previous.endExclusive - previous.start, current.endExclusive - current.start);
});

test("dashboard comparisons do not fabricate change without a baseline", () => {
  assert.equal(dashboardMath.change(100, 0), null);
  assert.equal(dashboardMath.change(120, 100), 20);
  assert.equal(dashboardMath.margin(25, 100), 25);
});

test("dashboard ignores stale pending profit and uses confirmed revenue for margin", () => {
  const result = dashboardMath.settlementTotals([
    { netSettlementMinor: "8000", calculatedProfitMinor: "6000", reconciliationStatus: "reconciled" },
    { netSettlementMinor: "12000", calculatedProfitMinor: "9999", reconciliationStatus: "awaiting_reconciliation" },
  ]);
  assert.equal(result.confirmedProfit, 60); assert.equal(result.netSettlement, 200);
  assert.equal(result.reconciledNetSettlement, 80); assert.equal(result.profitMargin, 75);
});
