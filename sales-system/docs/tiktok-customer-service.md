# TikTok Shop Customer Service

Implemented incrementally on 2026-11-02. Open **TikTok Shop → Customer Service** (`/tiktok/customer-service`). No production replies were sent during development. Automatic replies are disabled by default and cannot be enabled before successful read verification and a manual API reply confirmed in authoritative TikTok message history.

## Phase 1: authorization and API verification

**Live read-only metadata check:** the connected shop reports region `PH`, status `connected`, and granted scopes `seller.finance.info`, `seller.global_product.category.info`, `seller.global_product.info`, `seller.authorization.info`, `seller.product.basic`, `seller.order.info`. **`seller.customer_service` is missing.** Approval at app level is separate from authorization by the seller. Live Customer Service API calls remain blocked until reauthorization.

The existing signed OAuth state, code exchange, encrypted-token storage and token-refresh implementation are reused. Click **Reauthorize shop** after confirming the approved scope is enabled on the effective app/service in global Partner Center. The existing OAuth callback returns to Settings. Return to Customer Service and select **Verify access**. This checks the scope and performs Get Conversations; it does not send a message. Empty stored scopes mean unknown rather than confirmed denial, so an explicit read probe is allowed in that case. A nonempty scope list missing the permission is blocked. No invented OAuth `scope` parameter is added: seller grants come from the app/service authorization configured in Partner Center.

Verification and automation settings are isolated per shop and tied to the app key and authorization timestamp. Reconnecting resets read/manual verification and disables automation. Existing order/product/finance permissions and synchronization are unchanged.

| Capability | Selected method/path | Evidence / limitation |
| --- | --- | --- |
| List conversations | `GET /customer_service/202309/conversations` | Bundled OAS baseline. Page size 20, opaque page token, buyer participant `user_id`, `can_send_message`. |
| Read message history | `GET /customer_service/202309/conversations/{id}/messages` | Bundled OAS baseline. Page size 10, descending order, opaque page token. Does not mark messages read. |
| Get conversation by ID | `GET /customer_service/202601/conversations/{id}` | Bundled OAS and current official online reference; used to hydrate webhook-discovered conversations. |
| Manual/automatic text replies | `POST /customer_service/202606/conversations/{id}/messages` | Newer official online version, absent from bundled OAS. JSON-serialized `content`, type `TEXT`, sender role `CUSTOMER_SERVICE` for manual and `SYSTEM` for deterministic automation. |
| Mark read | `POST /customer_service/202309/conversations/{id}/messages/read` | Bundled OAS and official reference. Explicit user action. |
| Subscribe events | `PUT /event/202309/webhooks` | Official `NEW_MESSAGE` and `NEW_CONVERSATION` event types; requires `seller.authorization.info` in addition to messaging access. |
| Verify order ownership | `GET /order/202507/orders` | Existing order integration version; response `user_id` must equal buyer participant `user_id`. IM user IDs and nicknames cannot authorize order disclosure. |

Version discovery checked official Partner Center by operation name and version. No newer applicable list/history/read operation was established from publicly readable official results. Some docv2 pages only return a JavaScript shell; those schemas use the bundled OAS baseline and require successful runtime verification after reauthorization. There is **no silent version fallback**. Unsupported/retired versions fail visibly. Approval does not prove that every endpoint/version is enabled for a particular app or market.

Official references:

- [Get Conversations](https://partner.tiktokshop.com/docv2/page/get-conversations-202309)
- [Get Conversation Messages](https://partner.tiktokshop.com/docv2/page/get-conversation-messages-202309)
- [Get Conversation](https://partner.tiktokshop.com/docv2/page/get-conversation-202601)
- [Send Message 202606](https://partner.tiktokshop.com/docv2/page/send-message-202606)
- [Mark Buyer Messages as Read](https://partner.tiktokshop.com/docv2/page/mark-buyer-messages-as-read-202309)
- [Official Events topic catalog](https://partner.tiktokshop.com/docv2/page/delete-webhook-for-an-event-202309)
- [New Message](https://partner.tiktokshop.com/docv2/page/66143486ef8a1202dc323258)
- [New Conversation](https://partner.tiktokshop.com/docv2/page/6614330bfe9fdc02e002abfd)
- [API versioning](https://partner.tiktokshop.com/docv2/page/api-versioning)

## Phase 2: messaging, history and delivery safety

Set `TIKTOK_CS_WEBHOOK_BASE_URL` on the backend to the public HTTPS URL ending in `/api/tiktok/customer-service/webhooks`. From Automation settings choose **Register message webhooks**. Registered topic-specific URLs end in `/message` and `/conversation`. Existing order/product callbacks are untouched. Topic context comes from the registered URL; the integration does not guess numeric event mappings. These routes verify HMAC over the exact raw body before accepting notifications, check shop ownership, deduplicate notification IDs and persist work before acknowledging. They store only routing identifiers from the callback and retrieve authoritative messages asynchronously.

Collections:

- `tiktokcsconversations`: buyer context, unread count, eligibility, human/automatic mode, handoff reason and conversation lease.
- `tiktokcsmessages`: visible flag, text/card identifiers, sender, original message ID/index and timestamps; unique shop/conversation/message key.
- `tiktokcsoutbounds`: stable client key, source, actor, inbound message ID for automation, delivery state, platform message ID and resolution audit.
- `tiktokcssettings`: FAQ/automation configuration, authorization-bound verification, webhook metadata and recovery polling checkpoint.
- `tiktokcsjobs`: durable, coalesced per-conversation work with renewable leases and retry backoff.
- `tiktokcsevents`: deduplicated webhook routing records with 90-day TTL.

The worker runs every five seconds and survives restarts through MongoDB. Recovery inbox polling starts only after read access is verified, paginates at 30-second intervals, and waits five minutes between complete scans. API failures back off; existing shared request concurrency and rate-limit scheduling are reused. Browser refreshes every 15 seconds read only local history. Use Sync inbox / Refresh messages for an immediate upstream read. Polling latency scales with inbox size and queue backlog.

Text sends use a persisted outbound intent and **exactly one outbound HTTP attempt**, including for 401, 429, network errors and 5xx. Existing integration retry defaults are unchanged. Retransmitting the same client key returns its original result without sending again; a key cannot be reused for different text. Concurrent sends use a MongoDB lease. Unknown outcomes and process crashes leave `unknown` / `sending` holds and pause automation. No automatic retry claims exactly-once network delivery.

Refresh message history after a successful manual send. Only an exact returned message ID, matching text, visible non-buyer message and current authorization unlock automation. Unknown results cannot be safely reconciled solely by matching text. After checking TikTok Shop directly, an admin may explicitly confirm a reply was **not** sent, or link the exact **delivered message ID** from synchronized history. Both actions require a three-minute wait, record the resolving agent, and never resend. Linking validates shop/conversation, outgoing text, time proximity and uniqueness; it never automatically guesses based on text. Hover over a history timestamp to see its message ID.

Visible history supports local pagination plus explicit retrieval of older remote messages. Unsupported media/cards are identified with a prompt to view them in TikTok Shop. Sending media, initiating unsolicited conversations, native agent transfer, Seller Center assistant configuration and complete Seller Center feature parity are not implemented. Human queue/assignment is local to RJE, not a claim of native TikTok agent transfer.

## Phase 3: automation

1. Successfully verify access, sync a conversation, send a manual reply and refresh until its delivery is confirmed.
2. Configure FAQ keywords and both English and Tagalog answers. Ambiguous matches escalate. Local language detection is conservative and heuristic; it is not machine translation.
3. Optionally enable product and order replies. Product answers require a single exact SKU or buyer product-card context, active PHP listing and a sync within 15 minutes. Multiple variants, stale/missing data and fit/compatibility questions escalate. Prices/stock are described as synchronized values, not checkout guarantees.
4. Order questions require an order ID or buyer order-card context, `seller.order.info`, a live official order-detail read and an exact buyer ID match. Only status is returned, never recipient PII or guessed delivery dates.
5. Enable global automation explicitly and switch existing conversations to **Automatic** individually. New conversations discovered while enabled may enter Automatic. Manual sending / Take over pauses that conversation. Refunds, complaints, unsupported media, complex or unmatched requests move to the human queue without making refund promises or changing orders.

Only recent buyer messages created after automation was enabled are eligible. Historical imports are not bulk-replied. Agent replies detected in Seller Center pause RJE automation. Immediately before sending, the system refreshes messages, rechecks mode/settings and confirms the buyer message is still newest. A unique inbound-message reply key prevents replay after duplicate events or crashes. External agents can still reply in the interval after the final read; the official API does not provide a cross-platform atomic send lock.

This phase uses deterministic answers only. No AI provider is configured and no customer data is exported to an AI service.

## Phase 4: dashboard and permissions

The page includes inbox search, human/automatic filters, chat/history, manual replies, read markers, delivery holds, automation controls, bilingual FAQ editing and webhook registration. It inherits the existing theme palette, supports light/dark modes, and switches between inbox and chat on mobile.

Authenticated users can read shop history. All upstream reads initiated by a user, sends, handoff mutations, settings and registration require an administrator, consistent with existing TikTok write controls. Do not use shared or unauthenticated accounts for customer history. Include the new collections in full MongoDB backups and apply your approved retention/deletion procedures to customer-message records; only webhook routing records expire automatically.

## Policies and rollout checks

Follow the [Philippine Customer Communication Policy](https://seller-ph.tiktok.com/university/essay?knowledge_id=1487789288998658&lang=en), applicable developer/data-use terms and TikTok moderation. Replies must stay factual and on-platform: no unsolicited marketing, off-platform payment/contact redirection, review manipulation, pressure to cancel, harassment or unauthorized disclosure. Local validation blocks common redirection/review-pressure patterns and enforces the 2,000-character limit. Pattern checks cannot establish full policy compliance; merchants must review FAQ wording and human replies. The platform remains authoritative on conversation eligibility, messaging windows, moderation and quotas.

After reauthorization, verify in this order:

1. Settings reports `seller.customer_service`; Verify access returns a successful conversation read.
2. Retrieve a permitted test conversation and messages; confirm pagination and read markers.
3. Send one manual test reply, check TikTok receipt and synchronize its message ID back into RJE.
4. Register both message topics and verify signature rejection, correct-shop delivery and duplicate callbacks in the deployed environment.
5. Confirm background recovery/worker operation while the dashboard is closed.
6. Review bilingual FAQs and product/order permission coverage. Enable automation only for a controlled conversation, then test human takeover, duplicate callbacks and escalation.

Automated validation uses isolated MongoDB and mocked official API responses, including idempotency, uncertain sends, ownership, pagination, authorization reset, bilingual FAQ routing, signatures and webhook isolation. UI tests use mocked local API responses only. These tests do not establish live TikTok access or message delivery. Validation: 210 backend tests, 5 frontend unit tests, 7 Customer Service browser tests (desktop/mobile, light/dark, permission and delivery holds), and a successful production frontend build. Screenshots were visually inspected.

## Optional delivered-order follow-up

In **Customer Service → Automation settings → Delivered-order follow-up**, choose Tagalog or English and enable **Send a delivered-order follow-up**. It is off by default and requires verified read access, a confirmed manual reply, global automation, `seller.customer_service` and `seller.order.info`. Reauthorization disables it. Disabling global automation also disables this feature. No production follow-up was sent or enabled during implementation.

The fixed neutral message invites an **honest review** without requesting a particular rating, offering incentives or adding repeated reminders. The approved Tagalog wording is:

> Salamat po sa pag-order sa RJE! Na-deliver na ang inyong order. Maaari po kayong mag-iwan ng honest review sa TikTok Shop tungkol sa inyong experience. Kung may concern, message lang po kayo rito.

The background worker checks the existing synchronized order feed once a minute and processes one follow-up per scan. Eligible records must be `DELIVERED`, have a real delivery timestamp after explicit activation, and be within seven days of delivery. Old deliveries are never bulk-messaged, and sample orders are excluded. The worker re-reads official order details and matches its buyer `user_id` to exactly one synchronized chat. That existing chat must allow sending and be in Automatic mode. Human-held chats, buyer concerns, unavailable/ambiguous chats, unverified delivery status and missing permissions prevent sending. It does not create or reopen conversations. This means it will **not message every delivered order** if there is no eligible existing chat.

`tiktokcsdeliveryfollowups` records a unique shop/order processing outcome. Delivery messages use the existing outbound ledger with source `delivery` and a stable order-specific key. Duplicate order updates, concurrent workers, restarts and uncertain responses cannot automatically resend the same follow-up. Pre-send read failures can defer up to five times; once an outbound attempt exists, it is never replayed. An agent’s explicit delivery resolution updates the follow-up outcome as well. Recent sent/skipped/rejected/unknown results appear in Automation settings; accepted message IDs are subsequently retrieved into normal chat history.

Tests cover default-off behavior, no historical backfill, duplicate discovery/restart recovery, buyer mismatch, live-status mismatch, human takeover, complaint escalation, uncertain send outcomes and authorization reset. Final live delivery remains a deployment check after permissions and manual messaging are verified. Neutral wording does not bypass TikTok eligibility, moderation, applicable messaging restrictions or review policies.
