# Suggested TikTok Price — implementation and verification

Implemented an advisory price recommendation per TikTok product/SKU. Nothing is published to TikTok. This feature does not change settlement reconciliation, realized profit, financial transactions, order capital snapshots or current listing prices.

## Financial model

Default target settlement profit margin is 25%, with a strictly greater than 20% minimum. Settings can raise the minimum (20–99%) and change the target (minimum through 99.99%). All pricing arithmetic uses integer cents and exact BigInt rational numbers; floating point is used only for presentation.

The model is:

```
S = (P × (1 − sellerDiscountRate) − fixedSellerDiscount) × retention − fixedCharge
profit = S − currentCapital − operatingExpense
margin = profit / S
```

With no fixed charges or discounts, this reduces to the requested formula:

```
P = (capital + operatingExpense) / [(1 − deductionRate) × (1 − targetMargin)]
```

The solver first determines the required settlement cents, solves for price, rounds the selling price upward to the configured increment, rounds estimated settlement downward to cents, and verifies both margin inequalities with exact integer comparisons. When target equals minimum, an additional basis point is required so a displayed 20.00% is not offered as exceeding 20%. Zero total costs still require a positive settlement. Unsupported or excessive prices return an unavailable state, never Infinity, NaN or a fabricated zero profit.

Example: PHP 100 capital, 10% deductions, no other expenses, 25% target gives **PHP 148.16**. PHP 148.15 would produce PHP 133.33 after conservatively rounding settlement to cents, slightly below 25% margin. The calculator therefore advances one cent. PHP 148.16 yields estimated settlement PHP 133.34 and profit PHP 33.34.

Manual projections can include a fixed charge per unit, a seller discount percentage, and an additional fixed seller discount. Discounts apply before the assumed percentage deduction; the fixed charge applies afterward. Expenses should contain only costs not already deducted by TikTok.

## Historical-data qualification

Historical pricing is separate from existing confirmed product profitability metrics. It uses only the connected shop's current transactions and reconciled statements, matched to the exact product/SKU and currency. It rejects cancelled/returned/sample orders, mixed variants, absent or malformed original item prices, zero/negative revenue or settlement, subsidies greater than original item price, separate adjustments/refunds, multiple current transactions for an order, and missing confirmed transaction profit.

Pricing samples are restricted to **single-unit orders**. Unknown per-order fixed fees cannot safely be divided across historical basket quantities and reused as a future unit charge. Existing multi-unit confirmed-profit metrics remain unchanged.

At least three eligible orders, distinct original prices, and a price spread of at least PHP 1 and 5% are required. The service fits an affine model, `settlement = originalPrice × retention − fixedCharge`, using the lowest and highest reference prices and validates every sample within one settlement cent per unit. Retention must be positive and no greater than one; fixed charges cannot be negative. Inconsistent/nonlinear deductions fail qualification. The fixed component is adjusted conservatively to cover all samples, then rounded upward to cents for projection.

These components are **inferred estimates**, not an official TikTok fee schedule. The all-in historical reduction is measured against original order item prices and therefore includes the effects of observed seller discounts, promotions, shipping and deductions. It is not added again as a separate fee. The drawer distinguishes this observed effective ratio from the fitted percentage and fixed components, and warns that new promotions or subsidies may behave differently. Extrapolation outside observed prices produces an additional warning.

History is fetched in one bounded batch for the displayed variants: up to 2,000 recent candidate orders, with at most 100 eligible samples per variant. A sparse variant may consequently have insufficient sampled data even if older records exist. No TikTok API calls are made by the calculator and no pricing estimate is stored in financial records. Historical recommendations are recalculated from MongoDB on each product fetch or drawer request; no stale pricing cache was added.

When history is insufficient or unstable, the app shows **Insufficient Settlement Data** unless a fallback rate has been explicitly configured. There is no default invented TikTok fee. A saved fallback or drawer override is prominently labeled **Manual assumption**. Future nonlinear fees cannot be guaranteed by this affine model; the warning remains visible even when historical samples fit.

## UI and settings

- Product Inventory has a Suggested Price column with projected margin, difference from the listing price, model source, and View Pricing Breakdown action. Confirmed Margin remains the existing historical metric.
- The drawer shows product/variant identity, current capital and listed price, confirmed historical margin, sampled actual settlement data, editable target, manual assumptions, projected settlement/profit, and the calculation. It supports loading, validation, retry, missing-cost and insufficient-history states; stale calculations are hidden while recalculating.
- Settings → General → Pricing Preferences saves minimum/target margins, optional fallback deduction percentage, upward price increment, and PHP per-unit expenses in MongoDB. A blank fallback saves as null. All five preferences are validated and saved together to prevent partial updates from creating an inconsistent minimum/target pair.
- Administrators save shop preferences. Authenticated staff can read and calculate recommendations. Drawer overrides are temporary, read-only query parameters.
- PHP-only projections preserve the existing PHP capital-cost contract; other currencies receive an explicit unavailable message, without assumed conversion.

## Files changed or added

| File | Change |
| --- | --- |
| `backend/services/tiktokPricingMath.js` | Exact arithmetic, preference validation, affine history qualification and price solver |
| `backend/services/tiktokPricingService.js` | Bounded MongoDB history attribution per variant, no financial writes |
| `backend/models/SystemSettings.js` | Additive pricing preference fields and defaults |
| `backend/controllers/settingsController.js` | Authorized validated pricing preference persistence |
| `backend/controllers/tiktokProductController.js` | Enrich displayed product rows and expose a read-only pricing handler |
| `backend/routes/tiktokRoutes.js` | GET `/products/:id/pricing` |
| `frontend/src/pages/TikTokProducts.jsx` | Suggested Price column and drawer action |
| `frontend/src/components/PricingDrawer.jsx` | Pricing breakdown and temporary scenario inputs |
| `frontend/src/components/PricingDrawer.css` | Theme-aware responsive drawer and column styling |
| `frontend/src/pages/Settings.jsx` | General pricing preferences and optional null-rate serialization |
| `frontend/src/utils/settingsPresentation.js` | Pricing defaults, drafts and field validation |
| `frontend/src/services/tiktokService.js` | Read-only pricing request |
| `backend/tests/tiktokPricing.test.js` | Critical financial-model and sample-attribution tests |
| `backend/tests/tiktokPricing.integration.test.js` | Real disposable MongoDB, authenticated routes, persistence and financial-integrity checks |
| `frontend/tests/pricing.spec.js` | Browser pricing and preference tests using mocked APIs |
| `docs/suggested-tiktok-pricing-2026-11-01.md` | Implementation record |

No files were deleted. Existing unrelated working-tree changes were preserved. No destructive migration or production-data mutation was run.

## Verification

| Check | Result |
| --- | --- |
| Backend suite | 171 passed, including 12 new pricing unit tests and 4 new integration tests |
| Browser suite | 17 passed: 7 pricing tests plus 10 existing theme/responsive tests |
| Frontend theme unit tests | 5 passed |
| Production frontend build | Passed |
| Frontend undefined-reference scan | Passed |
| Live TikTok fee changes, promotions or price publication | Not tested; no publication capability was added |

Financial tests cover capital values, deduction extremes, zero cost, missing capital, nonpositive settlements, exact cent arithmetic, increments, fixed fees, seller discounts, expenses, impossible targets, strict minimum margins, nonlinear histories, variant isolation, historical corrections and statement mismatches. Integration tests verify that calculation and list/detail requests leave orders, transactions, settlements and listing prices byte-for-byte equivalent as returned from MongoDB. All database tests use a disposable local MongoDB; browser tests intercept API traffic and never access production financial records.

Browser verification covers light/dark appearance, desktop/mobile drawer interaction, changed target margins, manual assumptions and invalid rates, missing/insufficient data, saved settings after reload, and clearing the fallback rate. Production TikTok synchronization was not triggered by this task; its existing regression suite passed.
