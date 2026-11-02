# TikTok synchronization performance work

## Phase 1: baseline review

- Orders: update-time search already exists; first run covers 30 days only. Each detail batch performs one lookup and one write per order. No repeated-token or missing-detail guard.
- Products: every run searches the entire catalog and fetches details sequentially; writes every variant individually. Global archival logic must never run against an incremental subset. Local capital costs are separate from synced fields.
- Finance: imports withdrawals sequentially, scans a 60-day order lookback, refreshes orders in batches of three, discovers statements only through orders, and writes each transaction individually. Historical orders outside that window can be missed.
- Metrics: loads complete matching order and transaction histories into Node.
- Existing database uniqueness: orders (shopId, orderId), variants (shopId, productId, skuId), earnings and transactions (shopId, transactionId), settlements (shopId, statementId).
- Existing safeguards: encrypted OAuth tokens, shared refresh promise, API timeouts/retries, per-shop leases, historical cost snapshots. Preserve these.
- Deployment: Express and MongoDB Atlas; no Redis dependency or configuration. Use a durable Mongo queue rather than introducing an unconfigured external service.

## API schema evidence

Bundled tts-openapi-guide OAS inspected for order, product, finance. Existing versions remain pinned for this performance change (no schema migration). Order search supports update_time_ge/update_time_lt; product search supports update_time_ge/update_time_le. Finance statements support statement_time_ge/statement_time_lt, not update-time filtering, so keep an overlap plus explicit unresolved-statement rechecks.

Official version searches found no verified replacement for these capabilities; pages for Search Products and Get Statements return a JavaScript shell in the browsing tool, so field-level support is based on the bundled schema rather than assumed online content.

- https://partner.tiktokshop.com/docv2/page/get-order-list-202309
- https://partner.tiktokshop.com/docv2/page/search-products-202502
- https://partner.tiktokshop.com/docv2/page/get-statements-202309
- https://partner.tiktokshop.com/docv2/page/new-version-v202501-for-statement-transactions-and-order-statement-transactions


## Phase 2: incremental synchronization

Files: backend/services/syncDataService.js; tiktokOrderService.js; tiktokProductService.js; tiktokSettlementService.js; backend/models/TikTokShop.js.

- Separate orderCheckpoint, productCheckpoint and financeCheckpoint track successfully covered API ranges; last*SyncAt tracks the time a successful run finished. These are deliberately separate from historical date selections.
- A first unbounded run imports all available history, rather than the previous 30/90-day defaults. Existing installations begin with a new full baseline because their old timestamps do not prove complete historical coverage.
- Subsequent order runs query update time, so old orders updated recently are included. Completed/cancelled orders with an identical source update timestamp skip redundant detail requests. Pending local orders are rechecked in batches.
- Products query updated records with a five-minute overlap by default. Every 24 hours an unbounded run checks the whole catalog, including stock/status reconciliation. Incremental results never trigger shop-wide archival. Complete details can archive variants removed from that product only. Frozen/deleted summaries update status without overwriting missing prices or costs.
- Finance discovers statements directly with documented statement-time filters, rather than checking every order just to find statement IDs. Recheck all unresolved statements, incomplete transactions and processing payments, even outside the current range. Recheck old non-final earnings; a weekly full finance pass detects historical corrections beyond the overlap.
- Checkpoints are saved only after every page, data write and reconciliation succeeds, with a lease-owner guard. Explicit date ranges do not advance global checkpoints. Force Full Refresh ignores date filters.

Validation: initial history import, updated old orders, duplicate pages, repeated pagination, missing detail records, delayed statements, pending records and checkpoint preservation on failure are covered by real temporary-Mongo integration tests.

## Phase 3: short-lived finance cache

Files: backend/services/financeCacheService.js; tiktokSettlementService.js; tiktokVariantCostService.js.

Three-minute cache, configurable from two to five minutes. Keys include shop, endpoint and canonical query. Identical requests share an in-flight promise; failed requests are not cached. Successful syncs invalidate in-memory entries for that shop. Fresh persisted order-finance snapshots are reused only if they contain the requested statement. Pending/incomplete statements and forced refreshes bypass the cache. A newly discovered second statement refreshes a snapshot used by an earlier statement if necessary. Invalidation prevents an older in-flight response repopulating stale entries. Cache entries and per-sync finance maps are bounded.

Historical capital-cost edits mark affected transactions, statements and earnings unconfirmed, invalidate finance caches, and leave them available for the next reconciliation. Existing costs and audit history remain intact.

Validation: expiry, canonical keys, shop/query isolation, coalescing, invalidation races, delayed statement discovery, pending-cache bypass and forced refresh are tested.

## Phase 4: bulk database operations

Files: backend/services/syncDataService.js; tiktokOrderService.js; tiktokProductService.js; tiktokSettlementService.js; backend/models/TikTokOrder.js.

- Upserts use the existing unique shop/record compound identities. Batches contain at most 250 operations; financial pages are processed independently.
- Fetch existing order snapshots once per detail batch, not once per order. Product, earnings and finance writes compare owned business fields to skip unchanged documents. Finance snapshot writes and earnings reconciliation use bulk batches too.
- Order snapshots preserve previously entered capital costs. An optimistic version guard rejects a synchronization write if a manual cost edit changed that order concurrently. Manual saves also use optimistic concurrency; the API returns a reload/retry conflict if needed.
- Sync-owned product fields do not include capitalCostMinor, capitalCostEffectiveFrom, manual mappings or variant-cost history.
- Unordered batches retain successful records when another record fails. Errors carry record identities/codes into the persistent job's failedRecords log. No checkpoint advances; replayed upserts are safe.
- Unknown profits are explicitly unset rather than allowing an old known value to survive a failed reconciliation. Missing capital remains unconfirmed even if positive/negative unknown rows net to zero; the underlying money formulas are unchanged.

Validation: duplicate upserts, partial batch failures, idempotent retry, unchanged-record skipping, version conflicts and capital preservation are tested.

## Phase 5: durable jobs and UI

Files: backend/models/TikTokSyncJob.js; backend/services/tiktokSyncJobService.js; backend/controllers/tiktokSyncJobController.js; tiktokSyncController.js; backend/routes/tiktokRoutes.js; backend/server.js; schedule functions in the three sync services; webhook service/model; frontend/components/TikTokSyncProgress.jsx; frontend/services/tiktokSyncService.js; tiktokService.js; dashboardService.js; TikTokProducts.jsx; TikTokOrders.jsx; DailySettlements.jsx; Dashboard.jsx; Reports.jsx; design-system.css.

MongoDB is already the persistent deployment service; Redis is not configured. The queue therefore uses MongoDB atomic claims, a unique active shop/type key, expiring worker leases and heartbeats. Statuses are pending, running, completed and failed. Up to four attempts use exponential backoff, with the platform's longer Retry-After taking precedence. Terminal authorization failures stop retries. After restart, expired jobs are recovered; prior service leases are allowed to expire before recovery attempts proceed. Only one local worker runs a job at a time; API work is still globally limited to three in-flight requests per process. Multiple app instances share the durable queue/unique shop-type constraint, but the request cap/cooldown and single-flight cache are per process.

POST /api/tiktok/orders/sync, /products/sync and /finance/sync now return HTTP 202 with jobId and job. GET /api/tiktok/sync/jobs and /sync/jobs/:jobId expose safe progress and results. The frontend adapters poll jobs and preserve the existing promise/result behavior of existing page buttons. Sync All queues orders, products and finance. Scheduled and webhook work also enters the queue. Webhook acknowledgment waits for durable enqueue; duplicate failed enqueue attempts can be retried safely.

Progress panels show stage, counts/pages, duration, retry/error information, last successful time, Sync Now and confirmed Force Full Refresh controls. Navigation does not stop a job. Existing date-range sync buttons refresh that selected range; the new Sync Now uses global incremental coverage. The API process must remain running to process queued work; no external worker or Redis setup is needed. Run only the configured number of backend instances for the per-process request cap appropriate to your deployment.

Validation: concurrent enqueue uniqueness, 202 acceptance, retries, long platform pauses, expired-job recovery, service-lease waiting, webhook durability and terminal authorization failures are tested. Frontend production build passes. Actual process interruption/Atlas failover and authenticated browser interactions were not exercised; restart behavior was verified by persisting expired worker states and running the recovery code against temporary MongoDB.

## Phase 6: product metrics aggregation

Files: backend/services/tiktokProductMetricsService.js; backend/controllers/tiktokProductController.js; backend/models/TikTokOrder.js; TikTokFinanceTransaction.js; TikTokSettlement.js; TikTokEarning.js.

The Products endpoint now runs a Mongo aggregation filtered to the page's variant IDs, using an indexed equality lookup and Decimal128 minor-unit sums. Only grouped totals return to Node; the previous history-loading implementation remains as the test/benchmark reference. New indexes support SKU selection, update/status discovery, order/statement joins and reconciliation. Optional GET /api/tiktok/products?from=YYYY-MM-DD&to=YYYY-MM-DD filters metrics by statement date. No date range defaults were added to the product UI.

Existing margin semantics are preserved: positive reconciled sales from orders containing only the same variant and currency, with known historical capital. Multi-variant orders, refunds, zero/negative settlements and adjustments remain excluded from the product selling-price view; they remain in Finance's existing financial totals. Positive historical settled sales can remain in that view even if the order later changes status. The product margin is not a lifetime margin net of all later refund adjustments. Net margin remains (settlement - historical capital) / settlement, with truncation to two decimal percentage places. Returned totals also include settled revenue, historical capital, gross profit (revenue - capital) and net settled profit. No order-level payout is assigned in full to multiple variants.

Validation: optimized results are compared with the prior reference on a real MongoDB server, including mixed variants, refunds, losses, missing costs and date filters. Small-fixture cold aggregation time is higher than the original memory-based query; Node heap use is much lower. This is a memory/scalability improvement, not a claim that every small product query is faster.

## Phase 7: API scheduling and telemetry

Files: backend/services/tiktokRequestScheduler.js; tiktokApiService.js; syncTelemetry.js; tiktokSyncJobService.js.

The global per-process cap stays at three requests across sync types. Shared cooldowns slow other requests after rate limiting. Short retries retain timeouts and existing sanitized API errors; longer Retry-After pauses return the job to the queue. Encrypted credentials, valid-token reuse and the existing shared OAuth refresh promise remain unchanged. Job results record actual API sends, cache hits, bulk-write batches/records, duration and heap delta. The benchmark counts all Mongoose database commands separately.

Validation: request signing, expiration/refresh, rate limits, shared cooldown, timeouts/network failures, cap of three and credential-safe errors pass existing and new tests.

## Phase 8: reproducible validation and measured results

Files: backend/tests/syncData.test.js; tiktokSync.integration.test.js; tiktok.test.js; tiktokEarningReconciliation.test.js; backend/scripts/benchmarkTikTokSync.js; backend/package.json; package-lock.json; .gitignore; docs/tiktok-sync-benchmark.json.

- 72 tests pass with zero skips, including 22 integration scenarios against a temporary MongoDB instance. No .env is loaded by the test or benchmark; no Atlas connection or real TikTok requests are used.
- Frontend production build passes. Generated build artifacts were isolated from the tracked dist directory.
- Development-only mongodb-memory-server provides isolated database tests. Fresh development installs need access to download its MongoDB binary; production uses the existing Atlas connection and does not need that package.
- Run from backend: npm test and npm run benchmark:tiktok. Set BENCHMARK_RECORDS to change the fixture size (100 to 10000). Tests do not perform a live TikTok benchmark.

Latest controlled fixture: 500 orders, 10 settled orders, 2 ms simulated API latency, local temporary MongoDB. Baselines reproduce the prior per-record order persistence and broad finance order-discovery loops. The finance baseline conservatively uses the current statement writer. Memory numbers sample Node heap increase, not MongoDB server memory or total RSS. Timings are fixture-dependent and are not a live-service SLA.

| Scenario | API requests | DB commands | Duration ms | Sampled peak Node heap increase MiB |
| --- | ---: | ---: | ---: | ---: |
| orders: previous per-record write pattern | 15 | 1035 | 1051 | 17.90 |
| orders: optimized full import | 15 | 62 | 399 | 15.22 |
| orders: optimized incremental (10 updated records) | 2 | 14 | 49 | 3.09 |
| finance: previous broad order discovery (three concurrent) | 502 | 1007 | 2646 | 15.33 |
| finance: optimized statement discovery (cold cache) | 13 | 29 | 128 | 4.07 |
| finance: optimized immediate repeat (short cache) | 3 | 18 | 56 | 2.86 |
| metrics: previous history loaded into Node | 0 | 2 | 18 | 8.91 |
| metrics: optimized Mongo aggregation | 0 | 1 | 40 | 0.20 |

Metric outputs are asserted equal between the reference and optimized runs before the report is written. API and database command reductions are the main reproducible findings; timing and heap samples vary across runs. Full benchmark data is stored in tiktok-sync-benchmark.json.

## Configuration and rollout

New optional defaults in backend/.env.example:

- TIKTOK_SYNC_OVERLAP_SECONDS=300
- TIKTOK_FINANCE_OVERLAP_DAYS=2
- TIKTOK_FINANCE_CACHE_SECONDS=180 (clamped to 120?300)
- TIKTOK_PRODUCT_FULL_REFRESH_HOURS=24
- TIKTOK_FINANCE_FULL_REFRESH_DAYS=7

Restart the backend and refresh/rebuild the frontend. Mongoose creates the additive indexes and queue collection; no existing data is deleted or rewritten as a migration. If your deployment disables autoIndex, create the declared indexes through your normal database deployment process before enabling the worker. New checkpoint fields require one complete baseline; it can take longer than later incremental runs. Existing manual date ranges still work but do not establish complete global coverage. After a crash, recovery may wait for a prior order/product/finance service lease to expire (up to 15 minutes / 2 minutes / 30 minutes respectively).

The Mongo queue persists pending work, but the Node API process must be up to execute it. Queue delivery is at least once: operations must remain idempotent. For multiple backend replicas, configure an appropriate deployment-wide request limit or a shared scheduler before increasing worker count; the implemented cap of three is process-local. Financial matching still requires exactly one same-amount statement in the existing date window; performance changes do not resolve ambiguous earning-to-statement matches automatically.

## Full-history zero timestamp correction

Live read-only diagnostics confirmed TikTok rejects create_time_ge=0 with code 36009004. Full-history runs now omit zero lower-bound parameters for withdrawals, statements and orders, allowing the documented earliest-available default. Both corrected Finance list endpoints returned successful live responses. API failures now retain safe endpoint, field and opaque request-ID diagnostics in jobs, without forwarding raw upstream messages or credentials. Regression coverage guards against zero date parameters.
