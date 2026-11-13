# RJE Sales Management System — pre-deployment security audit

Date: 2026-11-11 (Asia/Taipei). Decision: **NOT READY for public deployment**.

This is a repository security review, not a certification or live penetration test. No application code, credentials, database records, or business rules were changed. Existing local changes to backend `.env` and `.env.example` were preserved. The initial audit created only the two reports. The owner subsequently approved SEC-01 repository cleanup and a redacted history scan; the progress entry below records those changes. Other fixes still require approval.

## Scope and assurance

Reviewed the frontend/backend source inventory, all route definitions, authentication and user administration, server middleware, database connection and schemas, TikTok OAuth/token/API/webhook boundaries, customer-service access, order/cost/settlement flows, frontend session/API handling, launcher, ignore rules and lockfiles. Repository-wide searches covered dangerous rendering, query construction, logging and security controls. Findings use named symbols where compressed source makes line references fragile. Dependency source and generated/vendor files were not exhaustively audited.

No production Atlas account, network rules, cloud IAM, TLS ingress, backup console, remote Git visibility, or Partner Center settings were available. Those remain verification gates, not asserted vulnerabilities. No live database connection, shop authorization, sync, restore, or outbound customer message was initiated. Secret checks emitted presence/classification only; credential validity was not tested. The initial history check was limited; the approved SEC-01 follow-up below expands local history coverage with explicit limits.

Severity reflects impact and access prerequisites: Critical = potential credential compromise; High = major integrity/availability or deployment exposure; Medium = bounded abuse or missing defense; Low = limited operational/security weakness. There are **1 Critical, 4 High, 9 Medium and 1 Low findings**. Several are deployment/control gaps rather than demonstrated exploits.

## Findings

### SEC-01 — Critical — Real-looking credentials committed to Git

**Files:** `sales-system/backend/.env`, root `.gitignore`, `sales-system/.gitignore`.

`git ls-files` confirms `.env` is tracked despite ignore patterns. HEAD contains non-placeholder-looking database connection, JWT secret and seed administrator password values. Six commits appear in that file's history. The working copy additionally contains non-placeholder-looking TikTok app secret and token encryption key; this review does not establish that those current values were committed. Repository visibility and credential validity are unknown. Repository, archive or build-context access may expose database access and administrator credentials. A JWT secret alone does not bypass the database user/active/version checks, but it can permit forged tokens for a known active user.

**Recommended fix:** Treat committed secrets as compromised; rotate database credentials, JWT signing secret and seed password, invalidate existing sessions, and review access logs. Assess TikTok secret/key history and rotate/re-authorize if exposed. Remove `.env` from tracking, retain a placeholder-only example, and enable secret scanning. Coordinate history cleanup and clone/cache handling after rotation. Encryption-key rotation must include decrypt/re-encrypt migration or reconnecting shops; replacing the key alone destroys access to existing ciphertext. Do not rewrite history or rotate credentials without approval.

### SEC-02 — High — Locked production Mongoose version has a published advisory

**Files:** `sales-system/backend/package.json`, `sales-system/backend/package-lock.json`; models with Mixed fields include `TikTokOrder.js`, `TikTokFinanceTransaction.js`, `TikTokReviewSettings.js`.

The lockfile resolves Mongoose **8.24.4**, in the affected range for GHSA-8332-j7wj-wjw4. The maintainer describes inherited-property traversal causing process-wide denial of service or shared schema-state changes. The 8.x patch starts at **8.24.7**. Vulnerable version presence is confirmed; a reachable exploit through this application's allowlisted controllers was not established. Mixed fields and external/imported records warrant careful review.

**Recommended fix:** Upgrade to a maintained patched release, review all intervening advisories, reject dangerous object keys at untrusted boundaries, and run integration regressions against an isolated database. [Maintainer advisory](https://github.com/Automattic/mongoose/security/advisories/GHSA-8332-j7wj-wjw4).

### SEC-03 — High — Launcher runs network-accessible development infrastructure

**Files:** `start-rje-system.bat`; `sales-system/frontend/vite.config.js` (`server.host`); `sales-system/backend/server.js` (`host`); backend `.env`.

Launcher starts nodemon and Vite development mode. Vite binds all interfaces (`host: true`), and Express defaults/currently binds `0.0.0.0`. No production TLS termination, firewall policy or supervised deployment is defined in the reviewed configuration. Current `NODE_ENV` is unset and the frontend OAuth return URL points to loopback HTTP. Public exposure depends on external network controls; LAN binding alone does not prove internet access.

**Recommended fix:** Build and serve static frontend assets behind HTTPS; run the backend with production mode under a restricted service account and supervisor; expose only trusted ingress. Keep development services private. Set production CORS and HTTPS callback/return URLs, and verify the deployed service has no development routes/source exposure.

### SEC-04 — High — Historical cost changes and audit/reconciliation updates are not atomic

**File:** `sales-system/backend/services/tiktokVariantCostService.js` (`setHistoricalOrderLineCost`, `backfillMissingOrderCosts`, `markOrderFinanceDirty`).

Historical override creates an audit record, saves the order, then invalidates transaction/settlement/earning figures through separate writes. An optimistic-concurrency failure can leave a recorded override unapplied; a later failure can leave changed cost snapshots with stale confirmed profit. Backfill saves orders before inserting audit records and marking finance dirty, so partial failure can leave unaudited changes; retry skips snapshots already filled. Admin access is required; this is an integrity risk, not demonstrated privilege escalation. Catalog cost changes already use transactions.

**Recommended fix:** Use bounded transactions or a durable, idempotent operation/outbox to commit cost/audit/invalidation together, retaining existing calculation rules. Add failure-injection and concurrent-edit tests. Do not silently change historical costing policy.

### SEC-05 — High — Backup/recovery readiness is unproven

**File:** `sales-system/backend/controllers/backupController.js` (`getBackupInfo`).

Endpoint explicitly reports `automatedBackupsSupported: false` and `MANUAL_REQUIRED`; it supplies instructions and stored history, not evidence of a working backup. Atlas backup configuration was unavailable. Encryption keys, revocation/state records and all collections must be covered by a recovery plan; the UI's collection list is not a complete recovery manifest.

**Recommended fix:** Verify Atlas scheduled backups/PITR for the deployed tier, restricted encrypted storage and retention. Back up token-decryption keys separately under stronger access controls. Restore the full database into isolation and prove login, financial reconciliation, indexes and recovery objectives. Keep restored workers/outbound messaging disabled until reviewed. This finding can be closed with infrastructure evidence without adding application backup code.

### SEC-06 — Medium — Authenticated MongoDB query-operator injection

**Files:** `sales-system/backend/controllers/tiktokSettlementController.js` (`transactions`), `sales-system/backend/controllers/tiktokReviewController.js` (`listReviews`); `config/database.js`.

Financial `status` and `statementId`, and review `product`, are assigned from Express query values directly to filters. Extended query parsing permits objects such as `statementId[$ne]=excluded`. An offline cast using the actual finance model preserved `$ne` and `$regex`; `sanitizeFilter` is not enabled. Authentication and fixed shop predicates remain in place: this is filter manipulation/expensive querying, not a confirmed cross-shop leak, write injection or authentication bypass.

**Recommended fix:** Require scalar strings, enum-check status and validate identifier lengths/formats; reject nested/array query values. Consider `sanitizeFilter` as defense in depth while explicitly trusting legitimate server-generated operators. Verify ordinary filtering remains unchanged.

### SEC-07 — Medium — Browser bearer sessions persist in localStorage

**Files:** `sales-system/frontend/src/context/AuthContext.jsx`, `src/services/api.js`; backend `middleware/auth.js`.

JWTs remain readable by any script running on the frontend origin and persist across browser restarts; default lifetime is one day. No direct dangerous HTML rendering sink was identified in searched React source, so this is an XSS-impact/control finding, not proof of stored XSS. Editing the cached user role does not bypass backend role checks.

**Recommended fix:** Agree on a session design: HttpOnly/Secure/SameSite cookies with CSRF protection, or short-lived in-memory access tokens with a protected renewal mechanism. Add CSP and avoid persistent tokens on shared devices. Current bearer headers are not automatically attached cross-site by browsers, so absence of CSRF middleware alone is not an identified bearer-route vulnerability.

### SEC-08 — Medium — Missing security headers and sensitive-response cache policy

**File:** `sales-system/backend/server.js`; frontend hosting configuration is absent.

No Helmet/security-header middleware, explicit CSP/frame policy, or `Cache-Control: no-store` for authentication/financial/PII responses was found. Express identification remains enabled. An ingress could supply headers, but none was verified.

**Recommended fix:** Add suitable Helmet headers and configure frontend-host CSP, frame restrictions, MIME protections and HTTPS HSTS. Mark sensitive API responses no-store. Test TikTok redirects, product images and UI assets with the chosen CSP.

### SEC-09 — Medium — Rate limiting is local and incomplete

**Files:** `middleware/sensitiveLimit.js`, `server.js`, `routes/authRoutes.js`, `routes/settingsRoutes.js`, `routes/tiktokRoutes.js`.

Login has a real 10-attempt per-IP/15-minute limiter; it is not unprotected. Limits live in per-process Maps, reset on restart and differ across replicas. No explicit trusted-proxy configuration exists; behind ingress, users may share one IP bucket. Most reads, webhooks, backfill and sync triggers lack inbound limits. `PUT /api/settings/:section` bypasses the limiter on the equivalent root settings update. Outbound TikTok scheduling and active-job deduplication help but do not bound incoming load.

**Recommended fix:** Define trusted proxy hops, shared login/IP/account limits and route-specific budgets, including heavy admin operations and signature-invalid webhooks. Preserve legitimate provider retries; do not blindly trust forwarded IP headers.

### SEC-10 — Medium — Financial and catalog reads can perform unbounded work

**Files:** `controllers/tiktokProductController.js` (`list`), `controllers/tiktokSettlementController.js`, `services/tiktokSettlementService.js`, `services/tiktokVariantCostService.js`.

Margin sorting/profit filters load all matching variants and compute metrics before pagination. Financial date ranges have no maximum span, settlement/earning detail can return all transactions, and backfill loads the entire shop's orders. Staff can invoke heavy read paths repeatedly. Pagination on other endpoints does not bound these internal operations.

**Recommended fix:** Add query execution budgets, bounded ranges/result sizes, cursor pagination and precomputed/paged aggregates; batch admin backfills with resumable progress. Retain existing totals and business semantics.

### SEC-11 — Medium — Replay freshness is not checked on webhook notifications

**Files:** `services/tiktokWebhookService.js`, `services/tiktokCustomerService.js` (`acceptCSWebhook`); `models/TikTokWebhookEvent.js`, `models/TikTokCustomerService.js`.

Raw-body HMAC uses constant-time comparison; notification IDs are deduplicated and webhook contents trigger authoritative sync instead of directly setting order/financial state. However, signatures have no enforced event-age window. Dedup records expire after 90 days, so a captured valid notification may be accepted again afterward. Main webhooks also allow absent `shop_id` without validating `seller_open_id` against the connected identity. Forging HMAC still requires the secret; these are bounded replay/identity-validation gaps, not unauthenticated arbitrary writes.

**Recommended fix:** Confirm provider retry/timestamp semantics and enforce a compatible freshness policy, strict supported-topic/payload validation and explicit shop/seller identity matching. Retain sufficient deduplication history and test delayed legitimate retries. Verify signatures against an official provider fixture; current tests derive expected HMAC locally and are not independent protocol validation.

### SEC-12 — Medium — Logs and security audit trail need production controls

**Files:** `server.js` (global error handler/startup), `controllers/userController.js`, `controllers/authController.js`, `services/tiktokOrderService.js`, `services/tiktokSettlementService.js`.

Global `console.error(error)` logs arbitrary exception objects; startup and scheduler paths log raw error messages. Driver errors can contain record values/connection diagnostics. Upstream TikTok API errors are deliberately sanitized, a positive control. No centralized redacted audit trail for login failures, role/status changes, password resets or disconnect was found; financial/review histories provide only partial coverage. Storage access/retention/alerts are unknown.

**Recommended fix:** Structured allowlisted logging with secret/PII redaction, correlation IDs, restricted retention and alerts. Add actor/action/target/outcome audit events for security actions without logging passwords, bearer headers, OAuth codes or signed/token-request URLs. Configure ingress/proxy tracing to redact token query parameters.

### SEC-13 — Medium — Broad staff access to financial and customer data

**Files:** `routes/tiktokRoutes.js`, `routes/tiktokCustomerServiceRoutes.js`, `controllers/tiktokOrderController.js` (`getOrder`), `controllers/tiktokSettlementController.js`, `services/tiktokCustomerService.js` (`getHistory`).

Any active staff account can read settlements, earnings, capital costs, full order detail (recipient locality/tracking) and customer conversation history. Write operations are admin restricted. This matches route comments and may be intentional; no narrower permissions policy was supplied. Full-document/spread responses expose internal fields beyond a minimal view.

**Recommended fix:** Obtain explicit owner sign-off on a data-access matrix; add narrower finance/support permissions and response projections if needed, with retention rules for customer information. Do not remove staff functionality without approval. Atlas encryption-at-rest and network access must be verified separately; plaintext application-readable financial fields alone are not proof of insecure database storage.

### SEC-14 — Medium — Dependency scan incomplete; affected development dependency present

**Files:** both `package.json`/`package-lock.json`; frontend lockfile resolves esbuild **0.21.5**, Vite **5.4.21**; backend resolves Express **4.22.3**, Mongoose **8.24.4**, MongoDB **7.7.0**, jsonwebtoken **9.0.3**.

Both `npm.cmd audit --json --ignore-scripts` attempts failed to reach the npm advisory bulk endpoint; no clean scan or vulnerability count is claimed. esbuild 0.21.5 falls in GHSA-67mh-4wv8-2f99 (patched >=0.25.0). That advisory concerns esbuild's own serve mode; its use through Vite does not by itself establish exploitability here. Vite 5.4.21 already includes the patch for GHSA-93m4-6634-74q7; do not report that particular advisory as affecting the locked version. These checks are not exhaustive. Tracked node_modules files also appear in Git despite ignores, complicating provenance.

**Recommended fix:** Re-run full and production-only dependency audits in network-enabled CI, review all current maintainer advisories, use compatible patched tooling and reproducible `npm ci` builds. Remove tracked generated dependencies after approval and install from lockfiles in CI. Never run a blanket forced audit upgrade without regression review. [esbuild maintainer advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99), [Vite patch advisory](https://github.com/vitejs/vite/security/advisories/GHSA-93m4-6634-74q7).

### SEC-15 — Low — Inconsistent bootstrap and administrative validation

**Files:** `scripts/seedAdmin.js`, `services/settingsValidation.js`, `controllers/userController.js`.

Seed requires only eight characters while normal password flows require 15 characters and cap bcrypt inputs at 72 UTF-8 bytes. Seed credentials persist in environment configuration. Status update uses `Boolean(value)`, so the string `"false"` becomes true. The last-active-admin count check and save are separate, allowing concurrent admin changes to defeat the guard and lock out administration. All user-management endpoints require admin; no staff-to-admin escalation was demonstrated.

**Recommended fix:** Reuse the normal password policy, remove bootstrap secrets after provisioning, reject nonboolean status values and make the last-admin invariant concurrency-safe. Consider MFA/step-up verification for privileged operations; neither is implemented in the reviewed login flow.

## Route authorization review

| Surface | Current boundary | Assessment |
| --- | --- | --- |
| `GET /api/health` | Public, minimal status | Expected; not database readiness |
| `POST /api/auth/login` | Public, local IP limit | SEC-09; no public registration |
| Auth profile/password/logout routes | Bearer authentication | Password requires current password; reset/change invalidate token versions; logout revokes token digest |
| `/api/users/*` | Authenticate + admin at router level | No missing staff restriction found; SEC-15 invariants |
| `/api/settings/*` | Authenticated reads; admin writes | Field allowlists; section limiter discrepancy |
| `/api/backups` | Authenticate + admin | Read-only instructions/history; SEC-05 |
| `/api/dashboard` | Global authentication before mount | Protected despite no router-local middleware |
| `/api/tiktok/callback` | Public; one-time, hashed, expiring OAuth state | Expected; initiating user is stored but callback does not recheck current active-admin status |
| TikTok/CS webhook POSTs | Public transport; raw-body HMAC | Expected; SEC-09/11 |
| TikTok finance/order/product/review/CS reads | Any authenticated active user | SEC-06/10/13 |
| TikTok sync, cost edits, disconnect, reviews, CS replies/settings | Admin checks | No unauthenticated write bypass found; SEC-04/09 |

OAuth state is 32 random bytes, stored hashed, expires in ten minutes and is atomically consumed. Rechecking the initiating user's current role/status at callback is recommended to close the short window after privilege removal. Tokens use AES-256-GCM, fresh 12-byte IVs, 32-byte keys, and default-hidden schema fields. Refresh coordination is process-local: exercise concurrent replicas before horizontal scaling, especially if refresh tokens rotate. Configuration URLs are environment-controlled, not user request input; enforce trusted HTTPS hosts and fail-fast secret/config validation at production startup. Missing/weak JWT secrets currently are not comprehensively validated before listening.

CORS uses an explicit origin list; absent Origin is allowed as normal for server clients/webhooks. CORS is not authentication. JSON parsing already has Express's default size limit (approximately 100 KB); absence of an explicit custom limit is not an unlimited-body vulnerability. Malformed JSON/oversized-body errors currently fall through `statusCode` handling assumptions and may become generic 500 responses because parser errors commonly use `status`; map parser failures to safe 400/413 responses.

## Database, financial and deployment verification gates

- Atlas permissions/network/TLS were not externally verified. Require an application-only database principal (no cluster administration), restricted ingress/private connectivity, TLS validation, least-privilege operator roles, MFA and access auditing. `mongoose.connect` relies on supplied URI/defaults; no disabled TLS verification was identified. Do not infer Atlas settings from the application stack declaration.
- Financial math uses integer minor units/BigInt; historical snapshots, shop-scoped uniqueness, active sync keys, leases, reconciliation status and checkpoints provide useful safeguards. Tested normalization preserves missing costs as unreconciled rather than zero. No payout/bank-transfer execution route was identified; settlement operations here import/reconcile data. Atomic failure risks remain SEC-04.
- Verify required unique/TTL indexes in deployed Atlas, including job active keys, notification IDs, OAuth-state expiry and revoked-token expiry. Schema declarations are not evidence indexes exist in production.
- Verify single-shop reconnection behavior, disconnect during jobs, lease loss and worker crash recovery on an isolated environment. Order lease heartbeat errors are swallowed; prove an old worker cannot continue writes after ownership loss. No live concurrent-worker fault test was performed.
- Do not serve repository root, backend files, `.env`, dumps, `.git` or dependencies as static content. Inspect built assets for secrets; only intended public `VITE_*` variables belong in the frontend. No frontend credential exposure was confirmed by the source checks; a production build artifact was not audited.

## Validation performed

54 selected existing tests passed with zero failures using:

```text
node --test tests/tiktokWebhook.test.js tests/routes.test.js tests/tiktok.test.js tests/tiktokSyncWorker.test.js tests/tiktokSettlement.test.js tests/tiktokOrder.test.js tests/tiktokCustomerService.test.js
```

These cover module loading, signature/raw-body behavior, API error redaction, retries, message non-replay, order/settlement normalization and money handling. They are primarily unit/mock tests, not proof of deployed authorization or provider compatibility. An isolated, no-database Mongoose filter-cast check confirmed SEC-06. Node runtime observed: v24.13.0. PowerShell initially blocked `npm.ps1`; using `npm.cmd` avoided changing execution policy, but registry requests still failed. No package installation, automatic fix or lockfile modification occurred.

Pending: complete registry dependency audit, isolated database integration/authorization negative tests, independent TikTok signature fixture, browser/header/TLS/cache checks, built-asset secret scan, full-history secret scan, Atlas/IAM review, restore drill and concurrency/failure tests. Passing current tests does not close these gates.

## Approval-ready remediation sequence

1. Approve SEC-01 credential containment and repository hygiene separately from any history rewrite/key migration.
2. Approve targeted dependency patches (SEC-02/14), strict query types (SEC-06), headers/cache policy (SEC-08), and consistent limiter/error handling (SEC-09).
3. Approve an isolated implementation plan for atomic historical cost writes (SEC-04), with failure tests and unchanged financial formulas.
4. Choose session/data-access policy and production hosting configuration; verify backups and infrastructure gates before release.

Only the approved SEC-01 repository cleanup has been applied; credential containment is incomplete. Deployment should remain blocked until Critical/High findings are resolved or supported by explicit owner risk acceptance and all production verification gates have evidence.

## SEC-01 remediation progress ? 2026-11-11

**Status: OPEN ? repository cleanup complete; credential rotation and exposure containment unverified.** Owner approved cleanup and redacted local history scanning only. No rotation, history rewrite, force-push, production database access or application changes were performed.

Changed root `.gitignore` to ignore `.env` and `.env.*` at all levels while retaining `.env.example`; removed an obsolete backslash path from `sales-system/.gitignore`. Ran `git rm --cached -- sales-system/backend/.env`, preserving the local file. Replaced the credentialed MongoDB URI in backend `.env.example` with an explicit placeholder and left app/service identity entries blank. Existing unrelated example settings were preserved. Frontend example required no changes. Example secrets are blank/placeholders; public service endpoints and ordinary local configuration defaults remain intentionally usable.

Verification: local `.env` byte comparison against a pre-change SHA-256 baseline passed (digest not recorded here). The index contains only its deletion for that path; the physical file remains present. Ignore checks cover backend `.env`, frontend `.env.production` and root `.env.local`; both examples remain trackable. Staged/example content was checked without displaying removed values. The same seven selected test files listed above passed again: **54 tests, zero failures**, without loading production environment or accessing a live database.

History evidence: non-shallow local repository; 23 commits enumerated through local refs. Six `.env` history entries (`5853c8ae1ba2`, `f7c65a8a93b2`, `e1d87cefaf00`, `936b5ee3e9ef`, `a71e6471b81d`, `e290ba0c9c21`) contain non-placeholder database/JWT/seed-password assignments. A broader heuristic/exact-match object scan examined 353 first-party text blobs; two binary/oversized blobs and vendor/build directories were excluded. Credentialed database URIs also occur in historical backend environment examples. README URI/key flags were reviewed as documentation placeholders, not confirmed credentials.

An object returned by the local Git object enumeration (`043a268e5d09`) matches current database/JWT/seed-password values and current TikTok app-secret/encryption-key values. A separate scan of all 23 commit trees found no occurrence of that blob. Therefore current TikTok values are confirmed present in a local Git object, but their inclusion in committed trees or remote history is **not established**. Treat them as potentially exposed pending investigation; do not replace the encryption key without migration/re-authorization planning. Scanning is heuristic, not proof of no other secrets. Remote-only refs, inaccessible repositories/clones, reflog-only/unreachable objects, CI logs, artifacts and external archives were not exhaustively inspected.

Remaining manual actions: rotate exposed database/JWT/seed credentials through approved systems, invalidate old sessions, review access logs, investigate local Git-object and historical-example distribution, assess TikTok credential/key containment, and provision deployment secrets outside Git. Coordinate any history rewrite separately after containment; historical objects/clones remain exposed after this index-only cleanup. No cleanup commit or push was made. Tracked generated dependencies were outside this SEC-01 approval and remain unchanged. SEC-02 through SEC-05 are untouched.
