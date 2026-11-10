import test from "node:test";
import assert from "node:assert/strict";
import { peso, confirmedProfitLabel, financePreset, validFinanceRange, reconciliationLabel, paymentLabel, syncPresentation, filteredFinanceRows, financePage, financeCsv } from "../../frontend/src/utils/financePresentation.js";

test("finance summary distinguishes unknown profit, no data and confirmed zero", () => {
  assert.equal(confirmedProfitLabel({ statementCount: 0, netProfit: 0 }), "No Data");
  assert.equal(confirmedProfitLabel({ statementCount: 3, reconciledStatementCount: 0, netProfit: 0 }), "Unconfirmed");
  assert.equal(confirmedProfitLabel({ statementCount: 3, reconciledStatementCount: 1, netProfit: 0 }), peso(0));
  assert.equal(peso(null), "Unconfirmed");
});

test("finance presets use Manila dates across UTC midnight and month boundaries", () => {
  const clock = new Date("2026-10-31T17:00:00Z");
  assert.equal(financePreset("today", clock).from, "2026-11-01");
  assert.equal(financePreset("last7", clock).from, "2026-10-26");
  assert.equal(financePreset("last30", clock).from, "2026-10-03");
  assert.equal(financePreset("thisMonth", clock).from, "2026-11-01");
  assert.equal(financePreset("lastMonth", clock).to, "2026-10-31");
  assert.equal(validFinanceRange({ from: "2024-02-29", to: "2024-03-01" }), true);
  for (const range of [{ from: "2026-02-29", to: "2026-03-01" }, { from: "2026-11-02", to: "2026-11-01" }, { from: "invalid", to: "2026-11-01" }]) assert.equal(validFinanceRange(range), false);
});

test("compact sync status derives only from actual job state", () => {
  assert.equal(syncPresentation([], null).label, "Not synchronized");
  assert.equal(syncPresentation([], "2026-11-01").label, "Up to date");
  const wait = syncPresentation([{ status: "pending", stage: "Waiting for previous sync lease" }], "2026-11-01");
  assert.equal(wait.label, "Waiting to retry"); assert.match(wait.message, /Another synchronization is finishing/);
  assert.equal(wait.active, true);
  assert.equal(syncPresentation([{ status: "running", stage: "Importing" }]).label, "Syncing");
  assert.equal(syncPresentation([{ status: "failed" }], "2026-11-01").label, "Failed");
  assert.equal(syncPresentation([{ status: "completed" }]).label, "Up to date");
});

test("reconciliation and payout presentation do not confuse settled funds with a bank transfer", () => {
  assert.equal(reconciliationLabel("awaiting_transactions"), "Awaiting Settlement Data");
  assert.equal(reconciliationLabel("awaiting_order"), "Awaiting Order Data");
  assert.equal(reconciliationLabel("unmatchable"), "Needs Review");
  assert.equal(paymentLabel("SETTLED"), "Settled in TikTok");
  assert.equal(paymentLabel("PAID"), "Bank payout completed");
  assert.equal(paymentLabel(undefined), "Payment not confirmed");
});

test("finance search and global sorting preserve source rows and keep unknown profit last", () => {
  const source = [{ _id: "1", statementId: "alpha", netSettlementMinor: "99", calculatedProfitMinor: "999999", reconciliationStatus: "awaiting_reconciliation" }, { _id: "2", statementId: "beta", netSettlementMinor: "100", calculatedProfitMinor: "100", reconciliationStatus: "reconciled" }];
  assert.equal(filteredFinanceRows(source, "statements", "", "amount_desc")[0]._id, "2");
  assert.equal(filteredFinanceRows(source, "statements", "", "profit_desc")[0]._id, "2");
  assert.equal(filteredFinanceRows(source, "statements", "awaiting reconciliation").length, 1);
  assert.equal(source[0]._id, "1");
  const earnings = [{ _id: "e", type: "WITHDRAW", transactionId: "123456", amountMinor: "200" }];
  assert.equal(filteredFinanceRows(earnings, "earnings", "withdrawal").length, 1);
  assert.equal(filteredFinanceRows(earnings, "earnings", "123456").length, 1);
});

test("CSV exports selected rows and dates with quoted cells and no unconfirmed profit presented as zero", () => {
  const range = { from: "2026-11-01", to: "2026-11-02" };
  const csv = financeCsv([{ statementId: 'id,"quoted"', settlementDate: "2026-11-01T00:00:00Z", netSettlement: 10, calculatedProfit: 0, reconciliationStatus: "awaiting_reconciliation", sourceTotals: { paymentStatus: "SETTLED" } }], "statements", range);
  assert.match(csv, /"id,""quoted"""/); assert.match(csv, /"Unconfirmed"/); assert.match(csv, /"2026-11-01","2026-11-02"/); assert.match(csv, /"Settled in TikTok"/);
  assert.ok(!csv.includes("awaiting_reconciliation"));
  const ledger = financeCsv([{ type: "WITHDRAW", status: "SUCCESS", transactionId: "e", amount: 10 }], "earnings", range);
  assert.match(ledger, /"Withdrawal"/); assert.ok(!ledger.includes("Net settlement"));
});

test("table pagination follows global filtering/sorting and exports all matching pages", () => {
  const rows = Array.from({length:35}, (_, i) => ({ _id: String(i), statementId: i % 2 ? "include" : "other", netSettlementMinor: String(i), reconciliationStatus: "reconciled" }));
  const selected = filteredFinanceRows(rows, "statements", "include", "amount_desc");
  const first = financePage(selected, 1, 10); const second = financePage(selected, 2, 10);
  assert.equal(first.pages, 2); assert.equal(first.rows[0].netSettlementMinor, "33");
  assert.equal(second.rows.length, 7); assert.equal(financePage(selected, 99, 10).page, 2);
  assert.equal(financeCsv(selected, "statements", {from:"2026-11-01",to:"2026-11-01"}).split("\r\n").length, 18);
});

 test("withdrawal display and export exclude all other activity without changing amounts or source records", async () => {
 const { withdrawalRows, withdrawalDestination } = await import("../../frontend/src/utils/financePresentation.js");
 const rows = ["SETTLE", "WITHDRAW", "TRANSFER", "REVERSE", "UNKNOWN"].map((type, i) => ({ _id: String(i), transactionId: "374659904728390170" + i, type, amountMinor: "-12345", amount: -123.45, status: "SUCCESS" }));
 const before = structuredClone(rows);
 const selected = withdrawalRows(rows);
 assert.deepEqual(selected, [rows[1]]); assert.equal(selected[0].amountMinor, "-12345");
 const csv = financeCsv(rows, "withdrawals", { from: "2026-11-01", to: "2026-11-02" });
 assert.equal(csv.split("\r\n").length, 2); assert.ok(csv.includes(rows[1].transactionId)); assert.ok(csv.includes("-123.45")); assert.ok(!csv.includes(rows[0].transactionId));
 assert.equal(withdrawalDestination(rows[1]), "Not available"); assert.equal(withdrawalDestination({destination:"Bank ?1234"}), "Bank ?1234");
 assert.deepEqual(rows, before);
 });

test("zero transaction toggle retains unknown, unconfirmed and nonzero financial amounts", async () => {
 const { isZeroFinanceTransaction } = await import("../../frontend/src/utils/financePresentation.js");
 const statement = { reconciliationStatus: "reconciled" };
 const zero = { reconciliationStatus: "reconciled", settlement: 0, capitalCost: 0, profit: 0 };
 assert.equal(isZeroFinanceTransaction(zero, statement), true);
 for (const field of ["settlement", "capitalCost", "profit"]) {
 for (const value of [null, undefined, "", 0.01, -0.01]) assert.equal(isZeroFinanceTransaction({...zero, [field]:value}, statement), false);
 }
 assert.equal(isZeroFinanceTransaction({...zero, reconciliationStatus:"awaiting_cost"}, statement), false);
 assert.equal(isZeroFinanceTransaction(zero, {reconciliationStatus:"awaiting_transactions"}), false);
});
