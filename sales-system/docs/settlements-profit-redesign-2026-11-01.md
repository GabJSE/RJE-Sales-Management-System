# Settlements & Profit redesign — 2026-11-01

Implemented directly in the existing React application. Backend monetary formulas and finance import rules were preserved; the only backend behavior change is job lease-wait handling and ownership checks. No real financial records or locks were edited, no live sync was triggered for testing, and no destructive operation was run.

## Page and financial presentation

- Compact header with title/subtitle, backend-reported last successful sync, Sync Finance and statement CSV export.
- Compact live job indicator: Up to date, Syncing, Waiting to retry, Failed or Not synchronized. Errors checking status are displayed as unavailable, not success. Progress uses backend records/pages/stage totals; no percentage is fabricated when a total is absent. Unreported record counts are labeled as unreported.
- Synchronization Details expands to show job state, current operation, attempts, counts, force-full action and recent finance run history. Force Full Refresh retains confirmation and concurrency protections.
- Four primary cards: Net Profit, Net Settlement, Settled Earnings and Unreconciled Amount. Secondary revenue/fee/tax/known-capital/margin/statement counts are expandable.
- Profit with no statement data is No Data; statements without confirmed reconciliation show Unconfirmed. Confirmed zero remains a real formatted zero. Partial reconciliation shows the confirmed statement count, not a claim that every statement is reconciled.
- All amount values come from existing backend fields. Withdrawals are not added to revenue, earnings credits are not combined with statements, and listed-price estimates are not used for actual profit. Known capital may be partial; Unreconciled Amount retains the existing backend calculation.
- PAID maps to Bank payout completed; PROCESSING maps to Payment processing; FAILED maps to Failed; SETTLED maps to Settled in TikTok. A reconciled statement is never presented as proof of bank receipt.

## Dates, tables, exports and drawers

Today, Last 7 Days, Last 30 Days and This Month use Asia/Manila calendar dates even when the browser is in another timezone. Custom Range reuses DateRangeFilter with an optional preset resolver, preserving its defaults for other pages. Invalid ranges are blocked. Applying a new range immediately invalidates old requests/data and closes old details. Reapplying the same range does not leave the page stuck loading.

Earnings & Withdrawals uses Date / Transaction / Amount / Status / Reconciliation / Action. Transaction IDs are searchable but appear in the drawer instead of as a table column. Settlement Statements uses Date / Statement ID / Orders / Net Settlement / Capital / Profit / Status / Action. Both tables have independent search, sorting and pagination. Filtering and sorting happen across the entire already-loaded selected-period result before pagination.

Header CSV export exports all filtered statement rows across pages. Earnings has its own Export action; it never adds ledger movements to settlement totals. CSV includes selected date bounds, Manila-formatted timestamps, readable statuses and escaped quoted cells. Unknown profit is exported as Unconfirmed, even if a stale source field contains zero. Spreadsheet download delivery has not been browser tested.

Drawers support immediate loading, request-error/retry states, latest-request guards, focus entry/return, Tab wrapping, Escape and backdrop closing. They show identifiers, dates, revenue/fee/tax/shipping/refund/adjustment details, known capital, confirmed profit, related order transaction capital, linked statements, payment status and sync time. Shipping is a read-only integer-cent sum of reported transaction shipping fields; it is not deducted again. Product/SKU cost allocation rules are unchanged.

CSS provides four desktop KPI columns, two at tablet width (including 768px), and one at mobile width (including 375px). Mobile tables become compact cards, drawers fill the screen, and key controls use touch-sized targets. Table headers are sticky on desktop. These are implemented CSS rules, not a claim of visual browser verification.

## Synchronization investigation and fixes

Read-only MongoDB diagnostic at **2026-11-01 21:06 Asia/Manila**:

- Latest finance job: pending, stage Waiting for previous sync lease, attempts 1/4.
- Service lease expiry: 21:22:31; queued next attempt: 21:22:32.
- Last successful finance sync: 20:32:02.
- The metadata check cannot prove whether the lease owner is actively working or abandoned. No lock was deleted or shortened.

Confirmed issue: runNextSyncJob previously deferred lease-waiting jobs until the entire observed lease expiry. Even when the prior worker released its lease early, the queued job could wait many unnecessary minutes.

Fix: lease waits schedule a check no later than 30 seconds. Already-pending lease-wait jobs with an older update timestamp are also eligible for a periodic recheck, even if their stored nextAttemptAt is far away. Every claim still reads the actual service lease and refuses to execute while it is valid; waiting does not consume an attempt. Rate-limit and other retry delays retain their existing scheduling.

Job heartbeat matchedCount is now checked. A worker that loses ownership cannot publish progress or completion as if it still owned the job; completion also verifies its conditional update matched. This does not introduce a distributed per-finance-row fencing system; the broader concurrency limitations from the prior audit remain separate.

Changes take effect when the running backend loads the new worker code. A genuinely active or abandoned but unexpired service lease remains protected until release/expiry. Development process restarts may leave those leases temporarily present; this change does not assume they are safe to remove.

## Verification

- `npm.cmd test`: **139 passed, 0 failed**.
- Added `financePresentation.test.js`: unknown/zero profit; Manila midnight/month/leap boundaries; invalid ranges; actual sync-state labels; bank-versus-settlement distinction; immutable global searching/sorting; pagination and all-page CSV export; CSV quoting/date bounds/unknown profit.
- Updated lease recovery regression to verify bounded checks, no overlap and no attempt exhaustion.
- Added integration tests for early release of old far-future lease-wait jobs and heartbeat ownership loss preventing completed publication.
- Existing financial integer-cent, refunds, quantities, missing costs, cost history, API retry/token refresh, duplicate prevention, full refresh and backend route-import tests pass against disposable databases and mocked upstream responses.
- `npm.cmd run build -- --outDir .audit-build`: passed. Temporary output avoided overwriting production dist.
- Computer-use inventory returned no app/browser surfaces. Actual clicks, keyboard focus behavior, automatic polling in a running browser, downloads, and visual rendering at **375px / 768px / desktop are NOT browser-tested**. Build success and unit tests do not prove those interactions.
- Read-only live sync metadata was inspected; live TikTok finance imports were not exercised and existing financial data was not modified for validation.

## Files

Modified:
- frontend/src/pages/DailySettlements.jsx
- frontend/src/components/DateRangeFilter.jsx (optional preset resolver; default behavior preserved)
- backend/services/tiktokSyncJobService.js
- backend/tests/tiktokSync.integration.test.js

Added:
- frontend/src/pages/DailySettlements.css
- frontend/src/components/FinanceSyncStatus.jsx
- frontend/src/utils/financePresentation.js
- backend/tests/financePresentation.test.js
- docs/settlements-profit-redesign-2026-11-01.md

## Remaining limits

Browser interaction and viewport QA still need a connected browser. Client-side filtering/pagination operates over current range results; very large historical ranges still need backend pagination/export design. Existing authoritative earning-linkage, reserve accounting, and concurrent historical-cost-edit limitations are not solved by this redesign. Missing TikTok statements remain unconfirmed; UI changes do not create or force financial links.
