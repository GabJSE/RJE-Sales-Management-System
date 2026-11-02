# Manual sales retirement ? 2026-11-01

The application is now TikTok-focused. Manual sales forms, CRUD APIs, catalog/inventory mutation APIs, legacy export/report APIs and fee-entry controls are removed. Dashboard contains only TikTok settlement and order activity. Reports now reads the same finance overview and statement endpoints as Settlements & Profit and exports TikTok statements.

Financial definition: PHP actual settlement totals; profit = reconciled settlement minus historical product capital, before external expenses. Margin uses the same reconciled population as profit. Unsettled orders count as order activity only. Daily trends use Manila business dates. Known capital may be partial while statements remain unconfirmed.

Dependency decisions:

- Product, Sale and InventoryMovement schemas remain for historical data access and offline migration compatibility. No runtime sales/inventory CRUD routes remain.
- Removed unused reconcileMappings, stockReconciliationCandidates and synchronizeMappedStock helpers and the legacy product-mapping endpoint. Active product sync did not call these helpers.
- TikTok orders/listings no longer populate retired Product references. Stored IDs and capital snapshots are preserved.
- Retained money utilities, authentication, settings, reviews, sync, finance, TikTok variant cost history and historical cost correction.
- Retained old fee fields in the historical settings schema but removed their UI, defaults and update whitelist. No stored field was unset.
- Backup metadata lists TikTok collections alongside preserved historical collections. It performs no backup/restore or collection writes.
- Old /sales and /inventory browser paths fall back to Dashboard; /products remains an alias for TikTok listings. Removed API paths have no handlers. /reports continues as a TikTok frontend page; its old manual backend API is retired.

Validation:

- Backend: npm.cmd test ? **126 passed, 0 failed**. Replaced two tests of removed legacy helpers with four integration regressions for TikTok-only summaries, pending-order profit exclusion, variant costs without legacy mappings, and order details preserving snapshots.
- Regression data includes a historical manual-sale fixture with a large profit; dashboard never queries it, its values do not affect KPIs, and the fixture remains unchanged.
- Dashboard KPIs match financeOverview on identical date/shop/currency populations, including pending and foreign-shop fixtures.
- Existing order/product/finance synchronization, refund, quantities, missing-cost, retry, cache, idempotency and historical cost correction tests pass against disposable MongoDB instances with mocked TikTok responses.
- Relative module-import scan: no missing imports in backend or frontend source.
- Frontend production build passed using temporary .audit-build output; production dist was not replaced.
- Responsive dashboard/report grids and scrollable tables retain existing mobile media queries. Browser/mobile visual interaction was **not tested** because no browser was connected. No claim of live TikTok validation is made.

No production database was contacted during this implementation. No historical collection or financial record was deleted or modified. No destructive database migration was created or executed. Existing unrelated working-tree changes were preserved.

Deployment requires the normal backend restart and frontend deployment; this change does not restart the running production application.

## Modified files

- README.md
- sales-system/backend/controllers/dashboardController.js
- sales-system/backend/controllers/settingsController.js
- sales-system/backend/controllers/tiktokProductController.js
- sales-system/backend/controllers/tiktokOrderController.js
- sales-system/backend/controllers/backupController.js
- sales-system/backend/routes/tiktokRoutes.js
- sales-system/backend/server.js
- sales-system/backend/services/tiktokProductService.js
- sales-system/backend/tests/tiktok.test.js
- sales-system/backend/tests/tiktokSync.integration.test.js
- sales-system/frontend/src/App.jsx
- sales-system/frontend/src/components/Sidebar.jsx
- sales-system/frontend/src/context/SettingsContext.jsx
- sales-system/frontend/src/design-system.css
- sales-system/frontend/src/pages/DailySettlements.jsx
- sales-system/frontend/src/pages/Dashboard.jsx
- sales-system/frontend/src/pages/Reports.jsx
- sales-system/frontend/src/pages/Settings.jsx
- sales-system/frontend/src/services/tiktokService.js

## Removed source files

- sales-system/backend/controllers/saleController.js
- sales-system/backend/controllers/reportController.js
- sales-system/backend/controllers/inventoryController.js
- sales-system/backend/controllers/productController.js
- sales-system/backend/controllers/exportController.js
- sales-system/backend/routes/saleRoutes.js
- sales-system/backend/routes/reportRoutes.js
- sales-system/backend/routes/inventoryRoutes.js
- sales-system/backend/routes/productRoutes.js
- sales-system/backend/routes/exportRoutes.js
- sales-system/frontend/src/pages/Sales.jsx
- sales-system/frontend/src/pages/Products.jsx
- sales-system/frontend/src/pages/Inventory.jsx
- sales-system/frontend/src/components/ProductForm.jsx
- sales-system/frontend/src/services/saleService.js
- sales-system/frontend/src/services/reportService.js
- sales-system/frontend/src/services/productService.js
- sales-system/frontend/src/services/inventoryService.js
- sales-system/frontend/src/services/exportService.js

## Added documentation

- sales-system/docs/manual-sales-removal-2026-11-01.md (this report)
- sales-system/docs/manual-sales-removed-files.json (machine-readable removal manifest)

The earlier settlements-profit audit is a historical snapshot before this retirement. Its notes about manual-channel reporting no longer describe the current application. Its separate payout-linkage, reserve-accounting, concurrency, and live/browser verification limitations remain applicable.
