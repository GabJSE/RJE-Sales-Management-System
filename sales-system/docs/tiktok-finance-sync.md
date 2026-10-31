# Phase 4 — TikTok finance and settlement automation

The Philippines integration uses supported Finance Information APIs:

- `GET /finance/202501/orders/{order_id}/statement_transactions`
- `GET /finance/202501/statements/{statement_id}/statement_transactions`
- `GET /finance/202309/withdrawals` for Seller Center Withdrawals History → Earnings

The retired `GET /finance/202309/statements` endpoint is not used. Because TikTok's newer Get Payments API is unavailable in SEA, statement IDs are discovered from finance data for Phase 3 orders already stored in RJE.

All monetary calculations use signed integer cent values stored as strings. Original TikTok amount strings and fee/tax breakdowns are retained. Statement transaction IDs have a unique `(shopId, transactionId)` index, and statements have a unique `(shopId, statementId)` index.

Confirmed profit is `net settlement - historical capital cost`. Cost is allocated from the SKU-level order finance rows for that statement. Missing orders, mappings, or historical costs are never treated as zero; those transactions and statements remain awaiting reconciliation. Refunds reverse capital only when TikTok reports signed negative order revenue. Statement adjustments without an order have zero product capital and retain TikTok's signed settlement amount.

Finance synchronization never writes to manual sales, inventory movements, or product stock.

The Earnings view treats `SETTLE` as “Order settlement” and preserves the TikTok transaction ID, signed amount, currency, creation date, and processing status. These payout-ledger records are displayed separately from detailed statement profit so they are not counted twice.
