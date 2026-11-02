# TikTok Product Inventory redesign — 2026-11-01

Implemented in the existing React page and TikTok product API, using existing authentication, sync progress, variant-cost history and reconciled product metrics. No production fixture data, database migration, live synchronization or financial record edits were performed.

## UI

- Seven desktop columns: Product / Variant, Seller SKU, TikTok Price, Stock, Capital Cost, Profit Margin and Status.
- 52px thumbnails, two-line product titles, variant descriptions, SKU copy buttons, PHP formatting and configured low-stock threshold.
- Sticky header and a flexible table within the panel. At 760px and below, table rows become compact two-column cards with field labels; all details remain available.
- Product identity opens a right drawer with average final settlement/unit, confirmed historical settlement profit/unit, margin, eligible units, IDs and last sync time. Missing values have explicit unavailable/unconfirmed states.
- Drawer includes focus entry/return, Tab wrapping, Escape and outside-click closing.
- Inline cost editing includes Save/Cancel, decimal validation, pending state, duplicate-request guard, and success/error messages. No silent historical-cost recalculation is introduced.
- Skeleton/empty/error states; 10/25/50/100 rows per page. Search and filter changes reset pagination.

## API and finance

Search matches title, Seller SKU and variant names/values with escaped literal input. Active/inactive/out-of-stock classification is shared in meaning between list filters and UI: archived/nonactive listings are inactive; otherwise zero stock is out of stock. Active recognizes ACTIVE and ACTIVATE.

All products includes archived listings as inactive. Missing capital, profitable and unprofitable filters operate on the full matching catalog. Profitable means eligible historical settledProfit > 0; unprofitable means < 0. Zero-profit and unknown variants are excluded from both sign filters. Filters never use listed prices as profit evidence.

Name, decimal listed price, stock, decimal capital cost, confirmed margin and last-sync ordering are applied before slicing pages. Missing values sort last. Margin filters/sorts require computing eligible metrics for all matching variants; ordinary catalog sorts use Mongo pagination. Very large catalogs may need a materialized profitability index to avoid expensive all-candidate metrics queries.

The existing optional metrics date range is preserved. averageSettlementProfit is added from summed historical profit divided by eligible settled units; it is not average settlement minus today's catalog capital. Existing exclusions remain: multi-variant orders, nonpositive sales, refunds, adjustments, noncurrent transactions and unreconciled parent statements.

Cost edits use the existing transaction that closes the prior cost interval, appends an audit-history row and saves current capital. Historical order snapshots and confirmed statement profit remain unchanged. Correct historical costs explicitly through the existing order-cost workflow, which invalidates affected finance for reconciliation. Backend validation now rejects numeric inputs with excess decimal precision as well as invalid strings.

## Verification

- `npm.cmd test`: **130 passed, 0 failed**.
- New integration cases cover variant/SKU literal search, inactive/active/zero-stock/missing-cost filters, numeric ordering, page boundaries/clamping, globally ordered confirmed profitability and null margins.
- New disposable replica-set transaction test verifies capital persistence, effective-date history, idempotent saves, input validation and preservation of historical snapshots/profit.
- Existing route loading, product/order/finance synchronization, token refresh, cache, settlement and historical reconciliation tests pass.
- Frontend production build passed into temporary .audit-build output; existing dist was preserved.
- Computer-use inventory had no browser/app surfaces. Desktop/tablet/mobile rendering, drawer interactions, keyboard behavior, clipboard access and actual UI Save/Cancel clicks were **not browser-tested**. CSS breakpoints and component behavior were reviewed; a successful build does not prove those interactions. Live TikTok was not called during this redesign.

## Files

Modified:
- frontend/src/pages/TikTokProducts.jsx
- frontend/src/services/tiktokService.js (extended catalog options; removed unused retired mapping call)
- backend/controllers/tiktokProductController.js
- backend/services/tiktokProductMetricsService.js
- backend/services/tiktokVariantCostService.js
- backend/tests/tiktokSync.integration.test.js

Added:
- frontend/src/pages/TikTokProducts.css
- backend/tests/tiktokCatalogCosts.integration.test.js
- docs/tiktok-product-inventory-redesign-2026-11-01.md

Restart backend and rebuild/deploy frontend through the usual workflow to activate these changes. Prior audit limitations around authoritative payout matching and concurrent historical edits remain separate from this UI change.
