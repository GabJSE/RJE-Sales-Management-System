# RJE production deployment checklist

Date: 2026-11-11 (Asia/Taipei). Release status: **BLOCKED** pending the security audit findings and verification below. See `SECURITY_AUDIT.md` for evidence and limitations. Unchecked means unverified or incomplete, not necessarily absent. Record owner, evidence reference, date and approval for each gate; do not paste secrets.

## Approval and release control

- [ ] Owner has reviewed all audit findings and approved the precise fixes before implementation.
- [ ] Critical/High findings SEC-01 through SEC-05 are closed, or an accountable owner has explicitly accepted residual risk in writing.
- [ ] Medium/Low findings have owners and release decisions; no regression removes existing functionality or changes financial formulas.
- [ ] Release commit, rollback artifact, migration plan and responsible operator are recorded.

## Secrets and source hygiene

- [ ] Rotate committed database credentials, JWT signing key and seed admin password; invalidate old sessions and review access logs (SEC-01).
- [ ] Assess historical TikTok app secret/encryption-key exposure; revoke/re-authorize or migrate ciphertext where needed. Never replace the decryption key without a recovery/migration plan.
- [ ] Stop tracking real `.env` and generated dependencies after approval; preserve placeholder-only examples. Verify ignore rules do not merely hide already-tracked files.
- [ ] Scan full Git history, build artifacts, CI logs, container contexts and archives for secrets using redacted output.
- [ ] Store production secrets in restricted runtime secret storage; keep bootstrap passwords out after provisioning.
- [ ] Fail startup on missing/weak secrets, invalid expiry settings, non-HTTPS production endpoints or unexpected upstream hosts.

## Runtime, dependencies and ingress

- [ ] Patch Mongoose 8.24.4 to at least 8.24.7 on its supported branch and check all current advisories (SEC-02).
- [ ] Complete `npm.cmd audit --json` and `npm.cmd audit --omit=dev --json` in both projects with network access; review results and archive redacted evidence. Prior attempts failed, not passed.
- [ ] Update affected development tooling compatibly; use clean lockfile-based installs and record supported Node/npm versions.
- [ ] Build the frontend and serve only its static artifact; do not deploy Vite/nodemon or use `start-rje-system.bat` as the production service (SEC-03).
- [ ] Set `NODE_ENV=production`, production API/HTTPS callback/return URLs and exact allowed frontend origins; remove loopback production redirects.
- [ ] Terminate HTTPS at trusted ingress, restrict backend network access and configure precise proxy trust/IP forwarding.
- [ ] Verify Helmet/equivalent headers, frontend CSP, frame policy, HSTS, MIME protections and no-store sensitive responses (SEC-08).
- [ ] Run as a restricted service account under supervision; configure resource limits, timeouts, graceful shutdown and readiness distinct from liveness.
- [ ] Verify `.env`, `.git`, source files, maps with sensitive content, dependencies and backups cannot be downloaded from the deployment.

## Authentication, permissions and API validation

- [ ] Test unauthenticated requests return 401 and staff requests to every admin write route return 403; include users, costs, backfill, settings sections, sync, disconnect and CS replies.
- [ ] Test expired/forged/revoked tokens, disabled/deleted users, password reset/change, logout and logout-other-sessions.
- [ ] Confirm changing cached frontend role data cannot grant backend privileges.
- [ ] Approve staff access to financial/customer data explicitly; minimize response fields and define retention (SEC-13).
- [ ] Choose and validate browser-session storage/lifetime policy; add CSRF protection if adopting cookies (SEC-07).
- [ ] Apply consistent bootstrap password policy, strict boolean validation and concurrency-safe last-admin protection (SEC-15).
- [ ] Require scalar query values and reject nested operators/arrays, including finance `status`/`statementId` and review `product` (SEC-06).
- [ ] Enforce inbound budgets for login, reads, sync/backfill, all settings variants and webhooks; verify behavior across replicas/restarts and trusted ingress (SEC-09).
- [ ] Bound financial date ranges, expensive catalog metrics, pagination and backfills; verify acceptable performance with production-scale synthetic data (SEC-10).
- [ ] Verify malformed JSON/oversized requests receive safe 400/413 errors without stack traces or sensitive values.

## Atlas and recovery

- [ ] Inspect Atlas network allowlist/private connectivity; reject unrestricted public database ingress unless explicitly justified.
- [ ] Verify TLS certificate checking, dedicated application database role, separate operational/admin identities and MFA.
- [ ] Confirm unique indexes and TTL indexes exist and work for shops/orders/transactions, sync active keys, OAuth states, webhook IDs and revoked tokens.
- [ ] Enable and verify supported Atlas backups/PITR, encryption, retention, deletion protection and restricted backup access (SEC-05).
- [ ] Securely preserve encryption keys separately from database dumps and document recovery permissions.
- [ ] Restore a complete backup to an isolated environment with workers/messages disabled; verify data, indexes, authentication and financial reconciliation.
- [ ] Record measured recovery time/data loss against approved RTO/RPO and retain restore-drill evidence.

## TikTok Shop

- [ ] Verify Partner Center app identity, minimum scopes, exact HTTPS redirect URI and webhook addresses without recording credentials.
- [ ] Test OAuth state missing/invalid/expired/reused cases; recheck initiating active-admin identity at callback.
- [ ] Verify encrypted token storage, tamper rejection, fresh IVs, expiry handling, refresh and key recovery; test concurrent refresh across deployment replicas.
- [ ] Validate webhook HMAC against an independent official fixture, exact raw bytes, malformed signatures, topic/schema restrictions and shop/seller identity (SEC-11).
- [ ] Verify freshness/deduplication policy against provider retries, including delayed/replayed notifications and retention expiry.
- [ ] Ensure access logs, tracing and outbound proxies redact OAuth codes, token-request query strings, secrets, authorization headers and signed URLs.
- [ ] Verify disconnect/reconnect, stale shop jobs and lease-loss behavior without sending customer messages or mutating production data during tests.

## Financial integrity and synchronization

- [ ] Make historical cost, audit and finance invalidation durable/atomic; prove crash/concurrent-edit recovery (SEC-04).
- [ ] Confirm historical snapshot preservation, exact minor-unit calculations, refund/return handling and missing-cost reconciliation stay unchanged.
- [ ] Verify duplicate sync/webhooks do not duplicate orders, costs, transactions, earnings or settlements.
- [ ] Test lease expiry, worker crashes, ownership loss, bounded retries, upstream 429/5xx and safe checkpoint recovery on an isolated database.
- [ ] Verify partial statement imports cannot appear as confirmed profit; compare synthetic expected totals to returned reports.
- [ ] Run database integration suites against disposable data only; never load production `.env` into tests.

## Logging, monitoring and final sign-off

- [ ] Add restricted structured logs, secret/PII redaction, request IDs and retention policy; audit login failures and privileged changes (SEC-12).
- [ ] Alert on authentication spikes, 403/429/5xx rates, webhook signature failures, stale syncs, failed reconciliation and backup failures.
- [ ] Document incident ownership, key rotation, restore and rollback procedures; test health/readiness and restart behavior.
- [ ] Run frontend build/browser checks, built-asset secret scan, backend unit/integration tests and deployed TLS/header/CORS/cache verification.
- [ ] Attach release evidence and record approver/date before enabling public traffic and automatic outbound workers.

Completed during audit: repository review, redacted tracked-secret verification, offline query-cast check and 54 passing selected existing tests. Full dependency scanning, live infrastructure and recovery checks remain pending. No application fixes were implemented. Approved SEC-01 repository hygiene is recorded below.

## SEC-01 approved cleanup evidence ? 2026-11-11

**SEC-01 remains OPEN; release remains BLOCKED.**

- [x] Owner approved SEC-01 repository cleanup/redacted history scan only.
- [x] Removed backend `.env` from the Git index with `git rm --cached`; local file preserved byte-for-byte.
- [x] Added root environment ignore rules, retained example exceptions, and removed obsolete nested ignore entry.
- [x] Sanitized backend example database URI; sensitive example values are empty/placeholders. Frontend example unchanged.
- [x] Scanned locally available refs/first-party text objects with redacted output; recorded scope and findings in `SECURITY_AUDIT.md`.
- [x] Verified index removal/ignore behavior and examples; reran 54 selected tests, all passing.
- [ ] Rotate committed database/JWT/seed credentials, invalidate sessions and verify exposure containment.
- [ ] Investigate local Git object matching current TikTok secret/key; committed-tree exposure was not established. Obtain separate approval before rotation/migration.
- [ ] Review historical credentialed examples, remote clones/logs/artifacts and access records.
- [ ] Commit/review the sanitized cleanup; coordinate any history rewriting separately.

No credentials or keys were overwritten, no production database operations occurred, and application functionality was unchanged. Generated dependency cleanup, external rotation, full artifact/CI scanning and SEC-02 onward remain pending. The original combined environment/dependency cleanup and full-history/artifact checklist items remain unchecked because those broader tasks are incomplete.
