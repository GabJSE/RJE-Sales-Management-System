# TikTok automatic synchronization

The backend runs the synchronization schedules independently of React:

- Orders: every 5 minutes
- Products: every 15 minutes
- Settlements and finance: every hour

Each scheduler also performs a delayed catch-up run after backend startup. MongoDB leases prevent overlapping work across multiple backend instances. Deploy the backend as an always-on process; a sleeping or request-only serverless deployment cannot run in-process schedules while idle.

## Webhook configuration

Set the public HTTPS callback in the backend environment:

```env
TIKTOK_WEBHOOK_URL=https://your-public-backend.example.com/api/tiktok/webhooks
```

On startup, the backend registers the documented `ORDER_STATUS_CHANGE`, `PRODUCT_STATUS_CHANGE`, `PRODUCT_INFORMATION_CHANGE`, `PRODUCT_CREATION`, and `PRODUCT_CATEGORY_CHANGE` topics through `PUT /event/202309/webhooks`. The new Inventory Changed by Shop event (`type: 71`) is accepted by the receiver, but its subscription name is not present in the current Events API schema; enable it in Partner Center when it is offered for the app rather than guessing an event name.

Webhook deliveries are authenticated using the TikTok Shop `Authorization` HMAC over the exact raw body, deduplicated by `tts_notification_id`, and retained for 90 days. Events trigger an authoritative API reconciliation and never write inventory or capital costs directly from an event payload.

The callback must be publicly reachable. Localhost URLs are not valid; use the production backend URL or an active HTTPS tunnel during development.

## Environment controls

```env
TIKTOK_ORDER_SYNC_ENABLED=true
TIKTOK_ORDER_SYNC_INTERVAL_MINUTES=5
TIKTOK_PRODUCT_SYNC_ENABLED=true
TIKTOK_PRODUCT_SYNC_INTERVAL_MINUTES=15
TIKTOK_SETTLEMENT_SYNC_ENABLED=true
TIKTOK_SETTLEMENT_SYNC_INTERVAL_HOURS=1
```

Intervals are bounded to the minimum safe values above. Missing permissions fail only the affected synchronization and are visible in the corresponding sync log.
