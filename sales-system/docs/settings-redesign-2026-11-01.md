# Settings redesign and security improvements — 2026-11-01

Implemented in the existing General / TikTok Shop Integration / Security tabs. No separate demo, second settings collection or legacy manual-sales workflow was added. No live account password, TikTok connection, stock quantity or financial record was changed during validation.

## General

Business information is fetched from MongoDB on entry. Forms remain unavailable when saved settings cannot be loaded; they never submit fallback placeholders as saved business data. Settings requests use response sequence guards. Each section tracks its own saved baseline, validates changes, prevents duplicate submissions and preserves drafts on error. Saving one section updates only that section's draft/baseline rather than erasing other unsaved edits.

Business name, address length, optional business email and Philippine contact-number format are checked server-side. Client-side inline messages cover the business fields and stock threshold, with server field errors preserved. Phone normalization accepts mobile 09/+639 forms and landlines with country/area prefixes. Format validation is not verification that a phone number or email account exists.

Currency symbols are derived from currency codes; manual symbol entry is removed. Changing the default currency does not exchange or relabel TikTok amounts. Finance summaries remain PHP and order/listing amounts retain source-currency behavior. Date formatting supports all three existing formats and valid display timezones. Shared context formatting now applies to finance views, sync times, order/listing details, reviews, reports, dashboard activity and backups. Calendar controls format civil dates according to preference without shifting their accounting day. Financial filters/grouping and date-bound CSV exports retain their Asia/Manila business-date contract. Dashboard's saved year period now works, and weekly frontend grouping no longer relies on the browser's timezone.

TikTok Stock Alerts preserves the existing `inventory` API section for compatibility; it has no manual inventory-model dependency. The 0–100,000 integer threshold and boolean enabled flag persist. The dashboard suppresses low-stock alerts when disabled; synchronized stock stays visible and unchanged. Out-of-stock inventory information/critical alerts remain separate. Preview uses up to ten synchronized lowest-stock active variants and labels its scope rather than claiming a full-shop total.

## Integration

The connection card shows actual shop identity/region, Connected / Disconnected / Expired / Needs Attention, available or last-reported scopes, access/refresh expiry metadata and last successful sync timestamps. Expired access alone is not treated as failed authorization because the backend already supports refresh. Expired refresh authorization is displayed as expired. Unknown values remain unavailable.

Admin-only Connect, Reauthorize, Disconnect and Refresh Shop Information actions reuse existing endpoints. Staff can refresh/read status but cannot mutate the connection. Disconnect requires confirmation and preserves order/cost/finance records. Orders / Products / Finance controls reuse TikTokSyncProgress and persistent queues, with readable states and last-success times. There is no second scheduler or simulated progress.

Status responses remain an explicit allowlist. Only expiry dates were added; access/refresh values, shop cipher, app secrets and encryption keys are not returned.

## Security

- Existing bcrypt hashing is retained at cost 12 for new password changes/resets.
- New passwords use a minimum 15-character passphrase and a maximum 72 UTF-8 bytes. Existing passwords can still sign in. Current-password verification and rejection of unchanged new passwords remain server-enforced.
- Profile email is validated; current account details remain separate from business information.
- Successful login records actual lastLoginAt. Current-token issued/expiry metadata comes from the verified JWT, not invented device history.
- Signed JWTs now have unique identifiers and a per-user tokenVersion. Password changes atomically verify the old hash and increment the version; they return a replacement current token and invalidate earlier tokens. Admin resets also atomically increment the target version. Login checks the verified password hash again when publishing its result, avoiding issuance against a concurrently reset hash.
- Sign Out Other Sessions increments tokenVersion and supplies a replacement current-browser token. All earlier tokens fail subsequent authentication checks.
- Logout stores only a SHA-256 digest of the presented JWT in the new RevokedAuthToken collection, with a TTL at signed expiry. It revokes the presented token without terminating distinct-token sessions. Raw tokens are not stored in this revocation collection.
- JWT verification explicitly allows HS256. Versionless earlier tokens remain compatible at version zero until revoked, expired or superseded.
- Backend authentication/admin role checks remain enforced on settings and integration mutations.
- Sensitive actions have bounded process-local rate limits: login, password/profile updates, session rotation, admin password resets, settings writes, OAuth authorization and disconnect. 429 responses include Retry-After. These are not a distributed limiter; deployments with several instances should add a shared/gateway limiter and configure trusted proxy handling for their topology.

Password policy references: [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) recommends a stronger minimum in the absence of MFA; [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) describes bcrypt's input-length considerations. The UI describes length requirements rather than falsely claiming a breached-password check. No MFA or breach-screening service was introduced.

## Unsaved changes and navigation

Dirty forms trigger a Save Changes / Discard Changes / Cancel dialog for tab switches, sidebar navigation, app logout and browser history navigation handled by App. Save Changes persists dirty sections in sequence and proceeds only on success. Discard resets only local drafts. Failed saves preserve input. Duplicate save requests are guarded by a synchronous lock. The modal traps focus and blocks Escape cancellation while a save is in flight.

Close/refresh uses the browser's native beforeunload warning only when dirty. Browsers control this warning and cannot show custom Save/Discard/Cancel buttons in it. Back/forward navigation is deferred in the app; cancel restores the prior URL. No claim of browser-tested history/focus behavior is made.

## Verification

- **155 backend tests passed, 0 failed** (16 new settings/security/presentation cases compared with the prior 139-test suite).
- Real HTTP tests mount the existing auth/settings/integration routes against a disposable MongoDB instance and verify persistence, no unrelated-value replacement, field errors, staff restrictions, alerts without stock writes, sanitized status, queued actions and fixture-only disconnect.
- Password tests verify current-password rejection, bcrypt persistence, earlier-token invalidation, replacement-token validity, digest-only logout revocation, other-session invalidation, real login/expiry metadata, rate limiting, profile validation and admin-reset isolation.
- Pure frontend helper tests cover drafts/dirty detection, all date formats and timezone rollover, original currency formatting without numeric conversion, phone/email/threshold errors, password length limits, connection health and deferred navigation events.
- Existing finance calculations, historical capital, token refresh, all sync flows, queues/retries, route imports and audit regressions pass.
- Frontend production build passed with temporary `.audit-build` output; the existing dist build was not replaced.
- Babel scope scan found no undefined frontend identifier references; targeted whitespace checks passed.
- Browser/app inventory was empty. Actual Save/Cancel clicks, tab/keyboard behavior, OAuth redirects, confirmation dialogs, beforeunload/back behavior, and **375px / 768px / desktop visual layouts were not browser-tested**. Responsive CSS is implemented and build-checked; that is not visual verification.
- No production TikTok disconnect, password reset, stock update or finance import was triggered by the tests. Upstream sync behavior remains covered by isolated/mocked existing tests.

## Files changed

Backend modified:
- controllers/settingsController.js
- controllers/authController.js
- controllers/userController.js
- controllers/tiktokController.js
- controllers/dashboardController.js
- controllers/tiktokProductController.js
- middleware/auth.js
- models/User.js
- routes/authRoutes.js
- routes/settingsRoutes.js
- routes/userRoutes.js
- routes/tiktokRoutes.js

Backend added:
- services/settingsValidation.js
- middleware/sensitiveLimit.js
- models/RevokedAuthToken.js
- tests/settings.integration.test.js
- tests/settingsPresentation.test.js

Frontend modified:
- src/App.jsx
- src/context/AuthContext.jsx
- src/context/SettingsContext.jsx
- src/services/api.js
- src/services/settingsService.js
- src/components/DateRangeFilter.jsx
- src/components/TikTokSyncProgress.jsx
- src/components/FinanceSyncStatus.jsx
- src/pages/Settings.jsx
- src/pages/TikTokSettings.jsx
- src/pages/Dashboard.jsx
- src/pages/Reports.jsx
- src/pages/DailySettlements.jsx
- src/pages/TikTokProducts.jsx
- src/pages/TikTokOrders.jsx
- src/pages/TikTokReviews.jsx
- src/pages/Backup.jsx
- src/pages/Users.jsx

Frontend added:
- src/pages/Settings.css
- src/utils/settingsPresentation.js
- src/utils/navigation.js

Documentation added:
- docs/settings-redesign-2026-11-01.md

No source files or historical collections were deleted. Existing unrelated workspace edits were retained.

## Deployment and remaining limits

Deploy/restart the backend before deploying the new frontend. User metadata fields are additive; no destructive migration is required. MongoDB must allow the new revocation collection and its digest/TTL indexes. The production frontend bundle must be built/deployed through the normal workflow.

Device/session lists, IP/location history, MFA, email verification, password recovery by email and breached-password screening are not implemented or fabricated. Current session authentication still uses the existing localStorage bearer-token architecture; this change does not migrate to HttpOnly cookies. Rate limiting is process-local. As with ordinary request authentication, revocation does not cancel an already-authorized in-flight operation or an existing background sync. Browser QA and production deployment verification remain outstanding.
