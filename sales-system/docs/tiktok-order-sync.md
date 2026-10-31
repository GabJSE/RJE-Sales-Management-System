# Phase 3 — TikTok order synchronization

The order importer is read-only. It writes only to `tiktokorders` and `tiktokordersynclogs`; it never creates an RJE `Sale`, changes `Product.stock`, or creates an `InventoryMovement`.

Current official APIs used:

- Get Order List: `POST /order/202309/orders/search`
- Get Order Detail: `GET /order/202507/orders`
- Required scope: `seller.order.info`
- Required shop context: `shop_cipher` returned by Get Authorized Shops

Initial manual synchronization accepts a Philippine-local date range of up to 90 days. Scheduled synchronization runs incrementally from the last successful watermark with a five-minute overlap. The unique `(shopId, orderId)` index and upserts make overlapping imports idempotent.

Order money is retained as TikTok string values with its currency. TikTok timestamps are stored as UTC `Date` values and rendered in `Asia/Manila` time. Each TikTok order line is matched first by TikTok SKU mapping and then by a unique exact seller-SKU match. Missing and ambiguous matches remain visible and do not create products.

Environment settings:

```env
TIKTOK_ORDER_SYNC_ENABLED=true
TIKTOK_ORDER_SYNC_INTERVAL_MINUTES=15
```
