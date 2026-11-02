import test from "node:test";
import assert from "node:assert/strict";
import Earning from "../models/TikTokEarning.js";
import FinanceTransaction from "../models/TikTokFinanceTransaction.js";
import Settlement from "../models/TikTokSettlement.js";
import { reconcileTikTokEarnings } from "../services/tiktokSettlementService.js";

for (const count of [0, 2]) {
  test(`reconciliation clears stale links and profit when ${count} statements match`, async t => {
    const earning = { transactionDate: new Date("2026-10-30"), amountMinor: "10000", linkedSettlementIds: ["old"], capitalCostMinor: "1000", profitMinor: "9000", orderCount: 2, adjustmentCount: 1, save: async () => {} };
    let page = 0;
    t.mock.method(Earning, "find", () => ({ sort: () => ({ limit: () => ({ lean: async () => page++ ? [] : [earning] }) }) }));
    t.mock.method(FinanceTransaction, "aggregate", async () => []);
    t.mock.method(Earning, "bulkWrite", async operations => { for (const op of operations) { Object.assign(earning, op.updateOne.update.$set); for (const key of Object.keys(op.updateOne.update.$unset || {})) delete earning[key]; } return { matchedCount: operations.length }; });
    t.mock.method(Settlement, "find", () => ({ lean: async () => Array.from({ length: count }, () => ({ _id: "candidate", netSettlementMinor: "10000", settlementDate: new Date("2026-10-29") })) }));
    assert.equal(await reconcileTikTokEarnings({ shopId: "shop" }, new Date("2026-10-01"), new Date("2026-10-31")), 0);
    assert.equal(earning.reconciliationStatus, count ? "ambiguous" : "awaiting_transactions");
    assert.deepEqual(earning.linkedSettlementIds, []);
    assert.equal(earning.capitalCostMinor, undefined);
    assert.equal(earning.profitMinor, undefined);
    assert.equal(earning.orderCount, 0);
    assert.equal(earning.adjustmentCount, 0);
  });
}
