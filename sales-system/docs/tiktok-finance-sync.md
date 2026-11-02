# Phase 4 — TikTok finance and settlement automation

Missing-order finance imports use exponential retry delays from one minute up to one day. `TIKTOK_FINANCE_MAX_RETRIES` defaults to 10; exhausted statements and their missing-order transactions remain visible as `unmatchable`. A forced full sync or arrival of a matching local order resets the retry state. Statement dates are preserved on retries when TikTok omits its timestamps.

The Philippines integration currently calls these Finance Information APIs:

- `GET /finance/202501/orders/{order_id}/statement_transactions`
- `GET /finance/202501/statements/{statement_id}/statement_transactions`
- `GET /finance/202309/statements` for statement discovery
- `GET /finance/202309/withdrawals` for Seller Center Withdrawals History → Earnings

Statement discovery currently depends on `/finance/202309/statements`. Its current lifecycle and availability for this shop must be validated in Partner Center; the previous claim that this endpoint was not used was incorrect. Get Payments 202605 is documented as unavailable in SEA and is not a substitute for this Philippines shop.

All monetary calculations use signed integer cent values stored as strings. Original TikTok amount strings and fee/tax breakdowns are retained. Statement transaction IDs have a unique `(shopId, transactionId)` index, and statements have a unique `(shopId, statementId)` index.

Confirmed profit is `net settlement - historical capital cost`. Cost is allocated from the SKU-level order finance rows for that statement. Missing orders, mappings, or historical costs are never treated as zero; those transactions and statements remain awaiting reconciliation. Refunds reverse capital only when signed negative SKU/order revenue is accompanied by explicit evidence that goods were returned. The documented finance schema does not guarantee those return signals; absent evidence, refund capital recovery stays zero. Statement adjustments without an order have zero product capital and retain TikTok's signed settlement amount.

Finance synchronization never writes to manual sales, inventory movements, or product stock.

The Earnings view treats `SETTLE` as “Order settlement” and preserves the TikTok transaction ID, signed amount, currency, creation date, and processing status. These payout-ledger records are displayed separately from detailed statement profit so they are not counted twice.

PHP overview totals and lists exclude other currencies. The Earnings KPI includes only successful PHP SETTLE credits, rather than summing the whole withdrawals ledger. Multiple ORDER transactions for the same order and statement remain unconfirmed until capital can be allocated safely. Rows omitted by a complete corrected statement response are retained with isCurrent=false and excluded from current details and profitability.
