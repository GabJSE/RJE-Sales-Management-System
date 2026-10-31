# TikTok daily settlement synchronization

TikTok orders are stored separately from manually entered RJE sales. The importer never invokes manual sale logic, changes stock, creates inventory movements, or overwrites RJE prices.

Required Partner Center scopes are `seller.authorization.info`, `seller.order.info`, and `seller.finance.info`. Reauthorize the shop after adding a scope.

The integration uses Get Order List (`/order/202309/orders/search`), Get Transactions by Order (`/finance/202501/orders/{order_id}/statement_transactions`), Get Statements (`/finance/202309/statements`), and Get Transactions by Statement (`/finance/202501/statements/{statement_id}/statement_transactions`). Statement transaction IDs are unique import keys. Signed TikTok amounts are stored as returned, and statement records are the only records added to daily totals.

Capital cost is snapshotted from the mapped RJE product at import. Unknown costs are excluded from confirmed profit and visibly marked. Later product cost changes do not rewrite snapshots.

Set `TIKTOK_SETTLEMENT_SYNC_ENABLED=true` and `TIKTOK_SETTLEMENT_SYNC_INTERVAL_HOURS=24` for the in-process scheduler. A MongoDB lease prevents overlapping scheduled and manual runs.
