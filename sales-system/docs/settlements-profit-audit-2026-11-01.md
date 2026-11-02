# Settlements & Profit functionality audit

Audit date: 2026-11-01 (Asia/Taipei)

Overall assessment: conditionally usable for PHP statement accounting after the fixes below; not certified as a complete cash-payout reconciliation or business net-profit ledger. Automated financial and synchronization checks pass. Live TikTok/Atlas behavior and browser interactions remain unverified.

## Scope, evidence, and safety

Reviewed the settlement page, reports, dashboard, product profitability, date filter, sync progress, frontend services, finance controllers/routes, sync worker, API client/signature/token refresh, cache, money helpers, historical cost service, related schemas/indexes, and existing tests. No AGENTS.md was found in the workspace inventory.

All database tests used a fresh mongodb-memory-server database. Upstream TikTok responses were mocked. No production .env was loaded by tests, no real financial record was changed, and no real sync was triggered during this audit. Existing unrelated workspace changes were retained. Tests insert/update/delete only disposable fixture documents.

Evidence: `backend/tests/tiktokSettlement.test.js`, `backend/tests/tiktokEarningReconciliation.test.js`, `backend/tests/tiktokSync.integration.test.js`, `backend/tests/tiktokSyncWorker.test.js`, `backend/tests/dashboard.test.js`, `backend/tests/syncData.test.js`, `backend/tests/tiktok.test.js`, and `backend/tests/tiktokProductMetrics.test.js`.

Final backend command: `npm.cmd test` — **124 passed / 0 failed** (100 tests at audit start, 24 additional cases).
Frontend command: `npm.cmd run build -- --outDir .audit-build` — passed. A sandbox filesystem-resolution failure on the first build was resolved by running the same build with approved elevated execution. The temporary output directory avoided overwriting the existing dist build.

No browser surfaces were available through computer-use inventory. Browser clicks, CSV downloads, keyboard accessibility, visual rendering, and mobile layout were NOT tested. A successful build is not evidence of those behaviors.

## Data flow

1. Admin finance sync calls POST /api/tiktok/finance/sync; authentication and admin authorization precede queueSync("settlements"). Sync Now/Force Full Refresh also use the persistent job queue.
2. A unique shop/type activeKey coalesces concurrent requests. The worker claims a job, obtains the service-level shop lease, and executes syncTikTokSettlements.
3. The service imports the withdrawals ledger, discovers statements, revisits incomplete statements and unmatched-earning lookback windows, then fetches every statement transaction page.
4. Local orders provide historical cost snapshots. Get Transactions by Order supplies statement-specific SKU quantities. Only that order-finance response is cached; statement discovery and statement transaction pages are fetched directly.
5. Monetary values are converted to integer cents. Finance transactions and settlements are upserted under shop-specific unique identities. A complete response marks corrected-away rows noncurrent without deleting them. Failed corrections leave the statement and its linked earnings unconfirmed.
6. Earnings link heuristically to one matching-currency, matching-amount statement inside the date window. Confirmed earnings copy the statement cost/profit; ledger credits are not added to statement profit.
7. Read controllers return PHP lists, totals, and details. Product profitability additionally requires a reconciled parent statement. Frontend renders records and exports statement data; reports keep manual sales separate. Dashboard combines channels, using confirmed settlement revenue for its profit-margin denominator.

## Financial interpretation and verification

Formula retained: **confirmed settlement profit = actual statement settlement amount − applicable historical product capital**. Fee, tax, shipping, refund and adjustment components already incorporated by TikTok are not deducted again. An example test uses settlement 445.00 and capital 125.55 and expects profit 319.45 despite separately supplied fee/shipping/adjustment fields.

This is contribution profit after TikTok deductions, not full business net profit: external advertising, packaging, off-platform freight, overhead and other expenses are not modeled. Bank payment status is also distinct from cost reconciliation; a statement can be reconciled while its payment is PROCESSING or FAILED. Such statement profit is not proof of bank receipt. The page now states these limits.

`revenue_amount` is settlement revenue, potentially after discounts/refunds; the UI no longer calls it gross sales. True pre-discount gross sales require a deliberate revenue-breakdown definition and are not provided by the existing overview contract. Revenue/shipping/supplementary breakdowns are now retained for future reconciliation; supplementary values are not added to settlement again.

Confirmed cost behavior: multi-product quantities; zero/missing capital; negative/zero profit; explicit returned-goods cost reversal; refund without goods-return evidence retains the original capital loss; same-SKU lines with different historical costs use a complete-quantity allocation, otherwise remain unknown. SKU refund rows are not charged as new positive capital. Multiple ORDER transactions for one order/statement remain unconfirmed because statement-level SKU data cannot safely be assigned to each transaction.

Integer cents are used for finance aggregation and margin arithmetic before conversion to display numbers. Float display values are not accumulated for Earnings or daily-profit totals anymore. The global legacy toMinor helper still tolerates invalid values, but finance normalization now rejects malformed/overprecision required amounts and malformed supplied components instead of confirming zero. Other subsystems using the permissive helper were not rewritten.

## Findings and disposition

Paths below are relative to sales-system. Severity describes potential impact before mitigation, not a claim that every issue remains present.

| Component | Status | Issue | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Earnings KPI | Fixed; integration tested | backend/controllers/tiktokSettlementController.js, earnings: summing all ledger rows counted withdrawals/reversals/failed or processing credits as earnings and used floating-point sums. | High | Now sums integer minor units of successful PHP SETTLE credits only. Ledger rows remain visible separately. |
| Historical statement refresh | Fixed; interrupted-page test | backend/services/tiktokSettlementService.js, importStatement: transaction pages could change while old parent/earning profit remained confirmed after a later failure. | Critical | Invalidate existing statement and linked earning confirmation before correction writes; restore confirmation only after complete aggregation. |
| Corrected-away source rows | Fixed; correction test | importStatement plus detail/product queries: upstream removal left old DB rows in current details even though new header totals excluded them. | High | Preserve rows with isCurrent=false after complete, nonmismatched refresh; filter current details, retry selection, and product metrics. No deletion. |
| Duplicate capital allocation | Mitigated; integration tested; exact allocation unsupported | importStatement/signedCost: more than one ORDER row for the same order/statement reused the whole SKU cost pool. | Critical | Detect ambiguity and withhold capital/profit rather than double charge COGS. Implement authoritative transaction-to-SKU allocation before supporting these cases as confirmed. |
| Multiple same-SKU order lines | Fixed; unit tested | signedCost used only the first line's historical cost. | High | Use complete weighted line costs when all quantities can be allocated; partial allocations with differing costs remain unknown. |
| Mixed sale/refund SKU rows | Fixed; unit tested | signedCost used the overall transaction revenue sign for every SKU, charging refund quantity as new positive capital. | High | Use each SKU's signed revenue when present; reverse capital only with explicit returned-goods evidence. |
| Malformed finance money | Fixed at finance import; unit tested | normalizeFinanceTransaction/normalizeEarning: permissive toMinor turned invalid values into zero and truncated excess precision. | High | Validate core PHP amounts and supplied components at the finance boundary; fail safely with 502. |
| Missing advertised statement rows | Fixed; integration tested | importStatement relied on pagination ending and could confirm incomplete data when total_count said more records existed. | High | Compare advertised total_count with unique imported IDs; reject missing transaction IDs and incomplete responses. |
| Order-linked adjustments | Fixed; unit tested | normalizeFinanceTransaction marked non-ORDER adjustments awaiting_order even though they require no product capital. | Medium | Require a local order for ORDER capital calculation only; preserve signed adjustment settlement. |
| Currency matching and PHP totals | Fixed; integration tested | reconcileTikTokEarnings matched equal cents without checking currency; summaries could mix currencies rendered as pesos. | High | Match currencies and scope PHP-only finance lists/overview/dashboard. Other-currency records remain stored. |
| Shop isolation | Fixed in finance controllers; integration tested | settlementDetail/earningDetail/transactions/syncStatus omitted active-shop scope; equal statement IDs across shops mixed detail rows. | High | Scope identities and queries by active shop; malformed/foreign detail IDs return 404. |
| Daily profit | Fixed; integration tested | dailyProfit grouped by UTC calendar day and summed display floats. | Medium | Group using Manila business days and aggregate minor-unit BigInts. |
| Request dates and page validation | Fixed; integration tested | controller dates silently substituted defaults for malformed values; queueSync accepted impossible dates; transaction page accepted fractions. | Medium | Reject invalid supplied dates, check real calendar dates before conversion, default dates in shop timezone, and require positive integer pages. |
| Dashboard profit and margin | Fixed; helper tested | settlementTotals included stale profit on unconfirmed rows; dashboard margin divided confirmed profit by confirmed plus unconfirmed settlement revenue. | High | Filter profit to reconciled statements and use the same population's revenue as denominator, including prior-period comparison. Finance reads are scoped to active shop/PHP. |
| Product profitability | Fixed; aggregation tested | productMetricsPipeline trusted transaction status even when parent statement was incomplete/mismatched. | High | Require reconciled parent statement and current transaction. Multi-variant attribution remains intentionally excluded. |
| Gross-sales label | Fixed; build checked | DailySettlements.jsx and Reports.jsx called settlement revenue gross revenue despite discounts/refunds. | Medium | Label settlement revenue; preserve backend response compatibility. Reconstruct true gross from explicit components only as a separate metric. |
| Frontend out-of-order loads | Fixed in code; build only | DailySettlements load and Reports loadReport could display old-range results after a faster new-range request. | Medium | Request sequence guards reject stale responses; settlement loading state clears prior-range data and suppresses misleading empty/zero content while loading. Browser race test remains outstanding. |
| Component audit trail | Fixed; normalization/build tested indirectly | FinanceTransaction discarded revenue, shipping, and supplementary breakdowns needed to investigate subsidies/deductions. | Medium | Persist Mixed breakdowns alongside original amounts; never add reference components to settlement again. |
| Documentation | Corrected; source compared | docs/tiktok-finance-sync.md said the statements endpoint was unused, contradicting actual discovery code; refund recovery text omitted return evidence requirement. | Medium | Document current endpoint dependency and conservative refund policy; validate endpoint lifecycle in Partner Center. |
| Earning-to-statement linkage | Open; matching/ambiguity behavior tested | reconcileTikTokEarnings uses amount/date uniqueness rather than authoritative transaction identity. Equal amounts can still be coincidental; one payout may represent several statements. | High | Obtain an authoritative shop-supported linkage or reviewed reconciliation mapping. Do not sum arbitrary statement subsets to force a match. |
| Concurrent cost edits versus import | Open; code-level risk, race not reproduced here | setHistoricalOrderLineCost/markOrderFinanceDirty and importStatement do not share a transaction/revision guard. An import holding an older order snapshot may reconfirm it after an edit invalidates finance. | High | Add a cost-revision compare-and-swap or transactional publication of cost version and confirmed statement. Until then avoid editing historical costs during finance sync; resync after edits. |
| Lease loss within a large statement | Open; between-statement behavior tested | Service checks leaseLost between statements, but importStatement performs multiple page writes without an owner fence at each publication. Job heartbeat also ignores matchedCount. | High | Introduce owner/revision fencing at writes and abort checks between pages, coordinated with job and service leases. Do not assume heartbeat tests prove distributed exactly-once execution. |
| Reserve funds and cash payouts | Open; schema inspected, no reserve/payout reconciliation fixture | normalizeFinanceTransaction treats non-ORDER cash movements as zero-capital adjustments. Reserve withholding/release and payable amounts have no dedicated accounting classification. | High | Validate reserve versus settlement/payable semantics against real sanitized source examples before claiming operating profit or bank-payout reconciliation. |
| Financial expenses outside TikTok | Unsupported; explicitly disclosed | No external-expense ledger is linked to settlement profit. | Medium | Add explicitly scoped external expenses once, with audit trail and allocation rules, or continue labeling this as settlement contribution profit. |
| Statement discovery lifecycle | Unverified live | syncTikTokSettlements depends on /finance/202309/statements; current generic docs were not fully readable. Bundled schema contains it but is not lifecycle proof. | High | Verify app/PH-market support in Partner Center. No speculative endpoint migration made. |
| Repeated broad discovery | Open performance limitation; code inspected | Old unmatched earnings push discoveryStart far into history; completed statements in that interval can be reimported repeatedly. | Medium | Merge bounded unmatched windows, retain discovery metadata, and distinguish newly changed statements without suppressing corrections. Benchmark against representative production-size fixtures. |
| Lists and overview scaling | Open performance limitation; no large-data load test | listFinanceSettlements/listTikTokEarnings return entire selected ranges; overview materializes rows in Node; large statement imports retain all normalized rows in a Map. | Medium | Add API/UI pagination and database integer/Decimal128 aggregation, with consistent export contracts. Existing indexed reads and 250-write batches reduce but do not eliminate scaling risks. |
| Settlement table controls | Not implemented | DailySettlements.jsx has fixed date ordering and scrollable tables, without search, sort controls, or settlement/earnings pagination. Backend transactions alone has 50-row pagination. | Low | Implement if required; do not describe scrollbars as pagination. |
| PDF export | Not implemented | Settlement pages provide client-generated CSV only. | Low | Add a deliberate PDF workflow if required. CSV browser download and content inspection are still untested. |
| Accessibility and mobile | Not browser tested | Drawer focuses close and supports Escape, but has no explicit focus trap; responsive CSS exists but is not rendering evidence. | Medium | Run keyboard, screen-reader and 375px/768px/desktop browser checks; add a focus trap if tests confirm background focus leakage. |

## Scenario verification matrix

| Requested scenario | Result | Evidence / limits |
| --- | --- | --- |
| Fully paid and settled | Passed with mocks | Statement import, cost, profit, earnings reconciliation. No real bank verification. |
| Pending/processing | Partial verification | Ledger KPI excludes processing/failed credits; status retained. Reconciled statement profit is not equated to bank payment. Full bank-payout lifecycle not tested. |
| Partially refunded | Passed with modeled fixtures | Signed refund revenue, mixed SKU sale/refund, conservative no-return capital. Real return workflow not verified. |
| Fully refunded | Passed with modeled fixtures | Refund without return keeps capital loss; explicit returned goods reverses capital. Finance schema does not guarantee those return flags. |
| Multiple products | Passed | Different SKU costs and quantities; ambiguous transaction allocation stays unconfirmed. |
| Missing capital | Passed | Cost/profit remain unknown, including mixed-known cases. |
| Duplicate records | Passed | Unique indexes, repeated imports, overlapping page rows, idempotent correction imports. |
| Negative / zero profit | Passed | Signed settlements and capital subtraction tested. |
| API timeout/failure | Passed with mocks | Sanitized API failure, partial correction invalidation, checkpoint preservation, queue retry. |
| Date boundaries | Passed | Manila midnight, leap dates, impossible/reversed dates, today's discovery cutoff. Browser timezone presets not tested. |
| Repeated synchronization | Passed | Stable unique record counts, refreshed snapshots, full-refresh bypass, checkpoint rules. |
| Late adjustments | Passed | Paginated corrected statement adds new adjustment and recomputes totals once. Historical corrected-away rows retained as noncurrent. |
| Rate limit/token refresh | Passed with mocks | Existing request tests exercise retry limits, long Retry-After, one token refresh, signature handling. Live authorization not tested. |
| Force Full Refresh | Passed at service/queue level | Cache bypass and retry reset tested; browser confirmation and button behavior untested. |
| Frontend summaries/details/filters | Build passed; browser not tested | Backend/controller amounts checked; no DOM interaction or visual assertion. |
| CSV export | Source reviewed; download not tested | Uses statement rows, quotes cells, represents unknown profit as Unconfirmed; PDF absent. |
| Mobile responsiveness | Not tested | CSS media queries inspected only. |
| Production load / Atlas outage | Not tested live in this audit | Prior session reported DNS timeouts; no claim that this audit restored connectivity. |

## API evidence and current limitations

The bundled OAS includes 202309 statement discovery/withdrawals, 202501 order/statement transactions, and 202507 unsettled transactions. Unsettled estimates are a separate capability and were not substituted for realized statement data.

Official [202501 transaction migration notice](https://partner.tiktokshop.com/docv2/page/new-version-v202501-for-statement-transactions-and-order-statement-transactions) supports the transaction shapes used here and distinguishes contributory from supplementary amounts. Official [Get Transactions by Order](https://partner.tiktokshop.com/docv2/page/get-transactions-by-order) documents statement-specific SKU quantities. The [September 2026 additive finance update](https://partner.tiktokshop.com/docv2/page/8he1k3et) still identifies 202501 as the impacted order/statement transaction version and adds fee/tax fields; Mixed schemas and aggregate fee_tax_amount tolerate these additions.

Official [Get Payments 202605](https://partner.tiktokshop.com/docv2/page/get-payments-202605) is newer than the bundled payments schema but remains documented as unavailable in SEA. It is not an applicable replacement for this PH integration. The current Get Statements and deprecation pages returned only a JavaScript shell or insufficient text, so this audit does not assert that endpoint is supported or retired for this shop. No live endpoint call was made.

## Recommended next work

First resolve authoritative earning linkage, cost-edit/import concurrency and reserve/payout semantics with sanitized fixtures and a controlled nonproduction shop. Validate statement discovery support before relying on live sync. Then run browser interaction/export/accessibility/mobile checks and representative-volume performance tests. Add search/pagination only with a matching export contract. Keep finance details visibly unconfirmed when authoritative cost allocation is unavailable.

Deployment: restart the backend for service/schema changes and rebuild/deploy the frontend through the normal workflow. No production backfill or real Force Full Refresh was run. Existing ambiguous or previously incorrect historical records require a deliberate post-deployment reconciliation; code changes alone do not rewrite them.
