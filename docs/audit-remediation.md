# Codebase audit remediation

The paired frontend/backend changes address the 32 findings from the October 2026 audit. This table tracks code changes; it does not assert that production has been migrated or configured.

| Finding | Remediation                                                                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01     | RLS enabled and client table/function privileges revoked; server service-role access only. Apply the security migration.                           |
| A02     | No reset tokens or URLs in any forgot-password response.                                                                                           |
| A03     | All paid product/discovery/AI routes authenticate and reserve organization usage in the backend.                                                   |
| A04     | Database row locks serialize quota reservations; settlement is idempotent.                                                                         |
| A05     | Active/trialing status, configured price, and future period end required for Pro.                                                                  |
| A06     | Live membership and session-version checks; resets revoke sessions and API keys.                                                                   |
| A07     | Express async routes/middleware forward failures to the central error handler.                                                                     |
| A08     | One backend API contract; Vite and optional Vercel gateway forward every frontend API route.                                                       |
| A09     | Broken/deprecated PA-API adapters removed; supported provider fallback moved into the backend. Creators API remains unimplemented.                 |
| A10     | No mock/synthetic metrics or safe-risk assertions; unknown fields retain unavailable coverage.                                                     |
| A11     | Resend reset delivery; configuration and verified sender required.                                                                                 |
| A12     | Atomic reset token consumption, password change, session invalidation, and key revocation.                                                         |
| A13     | Checkout idempotency/reuse and billing portal; webhook current-state fetch, distributed lock, customer checks, and ordered/idempotent application. |
| A14     | Correct RedisStore API, separate prefixes, startup readiness, bounded commands, explicit trusted proxy hops, and production Redis requirement.     |
| A15     | Local serverless limiters removed; gateway drops spoofed forwarding headers and uses backend limits. Validate deployed proxy hops.                 |
| A16     | Reload hydrates saved products; legacy saved rows retain catalog details with unavailable metrics.                                                 |
| A17     | Price/rank history aligned by timestamp, with absent samples represented as null.                                                                  |
| A18     | Batch success/error records are discriminated; failures are displayed separately.                                                                  |
| A19     | Validate before reserve; refund failures; duplicate ASINs billed once.                                                                             |
| A20     | Unknown fees block calculator results; manual fees supported and referral overrides invalidated when sale price changes.                           |
| A21     | Latest Keepa unavailable markers preserved; timestamps retained. App adapters explicitly support US/USD and reject non-US configuration.           |
| A22     | Canonical payload persists source metadata, coverage, unknowns, and histories. New cache namespace avoids old synthetic payloads.                  |
| A23     | Supabase-only scheduled refresh, attempted-time queue rotation, bounded positive concurrency/time budget, and shared job lock.                     |
| A24     | Provider/database/Redis deadlines, bounded retries/concurrency, batch time budget, and bounded memory cache.                                       |
| A25     | Browser notes scoped to user and organization; edits persist immediately.                                                                          |
| A26     | AI errors display unavailable state, without invented grade/score; server validates output shape.                                                  |
| A27     | Production persistent JWT secret, HTTPS frontend URLs, and positive integer configuration validation.                                              |
| A28     | CSV formula prefixes and quote delimiters escaped.                                                                                                 |
| A29     | Dependency upgrades and updated lockfiles; npm audits run in CI.                                                                                   |
| A30     | Regression suites for HTTP, SQL, providers, jobs, and UI; isolated password tests; CI checks.                                                      |
| A31     | Transactional account/organization/membership registration.                                                                                        |
| A32     | Discovery labeled category bestsellers; explicit paid load action; no claims of measured trends/all-time popularity.                               |

Both READMEs explain environment variables, deployment, API behavior, and limitations. Before deployment, apply the migration, configure the backend credentials and distributed infrastructure, reconcile historical Stripe subscriptions with missing period ends, test real email/provider/billing flows, and verify multi-connection PostgreSQL quota contention in staging. The embedded SQL test runs actual PostgreSQL functions on one connection and does not substitute for that staging check. Neither repository has been merged or deployed by this remediation work.
