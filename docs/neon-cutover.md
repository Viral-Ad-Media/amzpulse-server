# Neon and Better Auth cutover

The target is Neon Postgres with self-managed Better Auth 1.7.16 on the existing Express backend. This supports the custom legacy-password verification and application-owned organization provisioning that this migration needs. The frontend continues to use authenticated backend APIs. Redis, product providers, Stripe and Resend remain separate services.

## Provisioned target

- Account connection: Direct gmail, Luqman organization.
- Project: `amzpulse` (`orange-tree-69821826`), AWS US East 1.
- New production branch: `production` (`br-blue-pond-bb4il8kg`).
- Development validation branch: `dev-neon-auth` (`br-sweet-bar-bbl4v2ho`).
- Database: `amzpulse`; backend role: `amzpulse_owner`.

No credentials are recorded here. Obtain pooled and direct connection URLs for the intended branch from Neon. Direct workspace TCP access is restricted; the Neon connector can apply/inspect schema. The source database has not been exported or imported by this work.

## Preserve existing records

1. Freeze writes to the old backend and take a source backup. Point `SOURCE_DATABASE_URL` at its direct Postgres connection. Export a consistent read-only snapshot with `node scripts/export-legacy.cjs /private/path/legacy-export.json`. The file contains account data and password/API-key hashes; retain it privately.
2. Set `DATABASE_URL_UNPOOLED` for an empty development branch, run `npm run migrate`, then `node scripts/import-legacy.cjs /private/path/legacy-export.json`. The importer refuses a nonempty target and rolls back failures. Its import-mode setting suppresses automatic workspace creation while memberships are restored. It does not match users by email or rewrite IDs.
3. Verify per-table counts, memberships, watchlists, sourcing notes, usage, product history and Stripe customer/subscription IDs. Valid legacy scrypt hashes are copied into Better Auth credential accounts with unchanged IDs. Unsupported hashes require password recovery. Emails are not automatically marked verified.
4. Test login, logout, recovery delivery, quota contention from multiple connections and Stripe replay on staging. No live Stripe/email/provider credentials are used in automated tests.
5. Repeat the validated migration/import on the production branch while source writes remain frozen. Configure Render with that branch's pooled `DATABASE_URL`, direct `DATABASE_URL_UNPOOLED`, a generated stable `BETTER_AUTH_SECRET`, backend `BETTER_AUTH_URL`, frontend `FRONTEND_URL`, Redis and existing integration keys.
6. Deploy backend and frontend together. Existing sessions and old reset links must be renewed. Verify `/health`, sign-in, authenticated reads/writes, reset delivery, billing and CORS before restoring traffic.

Keep the old database and its backup available for rollback until validation completes. This implementation does not delete or pause it. A rollback after new writes needs reconciliation; blindly restoring an old snapshot would lose those writes.

## Boundaries

Better Auth replaces the custom JWT credential/session implementation. Email/password and recovery are implemented; OAuth, MFA and passkeys are not configured or claimed as working. Session tokens use the existing bearer transport and browser persistence; they are not HttpOnly cookies. Every API request checks the database session and current membership. The first membership by creation time remains the selected workspace, matching existing application behavior.

Application query values are parameterized; SQL identifiers and callable functions are validated. Mutations cannot run without filters. Quota settlement and webhook ordering retain their database transactions and organization locks. Table access remains server-owned; no browser database access or Neon Data API is used.

## Validation completed

All five schema migrations were applied through the Neon connector on `dev-neon-auth`. Inspection confirmed three Better Auth tables, 14 private application/auth tables and both identity triggers. No source account records have been copied.

Local verification passed: 33 backend checks (including real Express HTTP + Better Auth + embedded PostgreSQL), 17 frontend tests, frontend type checking, both builds, and zero vulnerabilities in both dependency audits. Fixtures cover imports, rollback, existing IDs/passwords/billing, revoked sessions, tenant membership and password-reset invalidation. Live production email delivery and multi-connection Neon contention remain rollout checks.
