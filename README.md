# AmzPulse Server

Express and TypeScript API for [AmzPulse](https://github.com/Viral-Ad-Media/amzpulse). The backend owns authentication, organization membership, metered product and AI requests, watchlists, sourcing notes, password recovery, and Stripe subscriptions. Neon Postgres stores application data and Better Auth manages credentials and revocable sessions; Redis supplies distributed rate limits and background-job locks.

## Setup

Use Node.js 22 or newer and a Neon Postgres project.

```sh
npm ci
cp .env.example .env
```

Set `DATABASE_URL` to the pooled Neon connection string and `DATABASE_URL_UNPOOLED` to the direct URL from the same branch. Set a persistent `BETTER_AUTH_SECRET` (generate with `openssl rand -hex 32`), `BETTER_AUTH_URL` to the backend origin, and `FRONTEND_URL` to the frontend base URL. Production origins require HTTPS. The first frontend URL supplies recovery and billing links; comma-separated URLs permit additional frontend origins.

Run `npm run migrate` using the direct connection. It applies `migrations/*.sql` in order under an advisory lock, records checksums, and refuses changed applied migrations. Test on a development branch before production. Application tables are private and accessed only by the backend database owner. No Supabase project, service key, SDK, Data API or JWT secret is required. The old `supabase/migrations/` directory is historical reference only and must not be applied to Neon.

Configure at least one product provider below, then run:

```sh
npm run dev
```

Production:

```sh
npm run build
npm start
```

The build copies ESM providers into `dist/product-api/` and the Better Auth runtime into `dist/auth-runtime/`. Deploy the complete `dist/` directory with runtime dependencies. `GET /health` returns the API status; it is a liveness check, not a live probe of Neon, Stripe, or provider credentials.

## Environment

The complete template is [.env.example](.env.example). Production requires `REDIS_URL`, explicit HTTPS frontend URLs, and a persistent random Better Auth secret of at least 32 characters. Redis must connect before the server starts; distributed rate-limit failures fail closed. In local development without Redis, limits and the bounded product cache use process memory.

| Settings                                                                  | Purpose                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `NODE_ENV`                                                        | HTTP listener and runtime mode.                                                                                                       |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Pooled Neon application connection and direct migration connection, from the same branch. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Persistent secret of at least 32 random characters and backend HTTPS origin. Sessions last seven days and are checked in the database on every request. |
| `FRONTEND_URL`                                                            | Comma-separated frontend base URLs. Origins determine CORS; first URL supplies redirects and recovery links.                          |
| `REDIS_URL`, `RATE_LIMIT_*`                                               | Shared IP rate limits and product caching. Global, auth, and batch stores have separate prefixes.                                     |
| `TRUST_PROXY_HOPS`                                                        | Exact number of trusted reverse-proxy hops, default `0`. Set only when every request uses the same controlled proxy path.             |
| `CACHE_TTL_SECONDS`, `DB_FRESH_MS`                                        | Redis/memory TTL and canonical database freshness.                                                                                    |
| `RESEND_API_KEY`, `PASSWORD_RESET_FROM`, `PASSWORD_RESET_TTL_MINUTES`     | Reset email delivery and token lifetime. Verify the sender domain before use.                                                         |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`          | Optional subscription billing.                                                                                                        |
| `GEMINI_API_KEY`                                                          | Optional server-only AI analysis.                                                                                                     |
| `FEATURED_ASINS`                                                          | Public dashboard seed list, served only from existing canonical database records. It never triggers paid provider calls.              |
| `ENABLE_METRICS_SYNC`, `SYNC_CRON`, `SYNC_BATCH_SIZE`, `SYNC_CONCURRENCY` | Optional scheduled product refresh. Requires Redis and valid positive numeric settings.                                               |

Provider HTTP requests have request deadlines and bounded retries, with an overall per-product provider deadline. Batch processing stops starting new work after its time budget, marks remaining rows as errors, and refunds failures. Configure proxy and hosting timeouts to support multi-minute batches. Do not trust arbitrary incoming `X-Forwarded-For` headers; test the actual hosting proxy path before choosing `TRUST_PROXY_HOPS`.

## Product providers

Provider code lives in `product-api/providers/`. The default fallback order is `spapi,keepa,rainforest`. Set `PRODUCT_DATA_PROVIDERS` to restrict or reorder it. Only providers with credentials run; a missing ASIN may fall through to the next provider. No mock product fallback is enabled.

| Provider              | Credentials                                                     | Coverage                                                                                                                          |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Amazon SP-API         | `SPAPI_CLIENT_ID`, `SPAPI_CLIENT_SECRET`, `SPAPI_REFRESH_TOKEN` | Authorized seller catalog and offer data. Requires an app and seller authorization with the necessary API roles.                  |
| Keepa                 | `KEEPA_API_KEY`                                                 | Product data and historical price/rank series. Latest unavailable price markers remain unavailable.                               |
| Rainforest            | `RAINFOREST_API_KEY`                                            | Product data and category bestseller discovery.                                                                                   |
| Operator HTTP adapter | `PROVIDER_BASE_URL`, optional `PROVIDER_API_KEY`                | Overrides the fallback chain and requests `GET {base}/products/{asin}`. Returns canonical product fields; missing fees stay null. |

The built-in adapters support the US marketplace: `SPAPI_MARKETPLACE_ID=ATVPDKIKX0DER`, `KEEPA_DOMAIN=1`, and `RAINFOREST_AMAZON_DOMAIN=amazon.com`. Non-US settings are rejected to avoid interpreting another currency as dollars. The old PA-API and unconfirmed Jungle Scout adapters have been removed; their former credential variables no longer enable product lookup. No Creators API integration is included.

Source coverage is preserved in `Product.canonicalData` and cache responses. Fees, sales, risk flags, and histories are never synthesized to fill missing provider data. Older rows without canonical payloads need a fresh lookup; legacy saved items still render basic catalog details with unavailable metrics.

Discovery uses Rainforest category pages. `TRENDING_CATEGORY_URL` defaults to electronics bestsellers and `BESTSELLERS_CATEGORY_URL` to toys/games bestsellers. Both are ordinary category rankings, not an all-time ranking or measured trend. They require US Amazon HTTPS category URLs. Each request returns at most 12 products, reserves 12 ASIN credits, and settles the returned count. Provider integrations are tested with controlled fixtures; validate account permissions, response coverage, quotas, and cost with your own credentials before production release.

## Authentication and usage

Send `Authorization: Bearer <token>` or `X-API-Key: <key>` on protected routes. API keys are returned once when created; the database stores only their hashes. Keys require a current membership. Password resets consume one unexpired Better Auth verification, change the password, revoke all sessions and that user's API keys, and remove legacy reset tokens. Reset endpoints never return a reset URL or token, in any runtime mode.

Browser authentication uses opaque Better Auth session tokens through the existing `/api/auth/register`, `/login`, `/me`, `/forgot-password`, `/reset-password` endpoints. `POST /api/auth/logout` revokes the current session. The frontend retains bearer transport for separate Render frontend/backend origins; tokens remain sensitive browser credentials. Auth cookies and OAuth are not enabled by this integration. Account linking is disabled. Email/password registration requires 12–256 characters; existing valid legacy passwords can still sign in. Every protected request rechecks the session and live membership; API keys retain their existing tenant checks. Clients never receive database credentials.

Registration provisions the account and owner workspace through a database trigger. Password recovery uses Better Auth's single-use verification records; password changes revoke all sessions and API keys in the same transaction via a credential trigger. Old custom JWTs and reset links are not accepted after cutover.

| Plan | Monthly ASIN credits | Monthly AI calls | Maximum batch |
| ---- | -------------------: | ---------------: | ------------: |
| Free |                  300 |               50 |            20 |
| Pro  |                5,000 |            1,000 |           100 |

Usage is organization-wide in UTC calendar months. Validated requests reserve credits under a database organization-row lock; successful cached lookups also count. Settlement refunds failures and is idempotent. Abandoned reservations expire after five minutes and are recovered on the next reservation. AI calls have a separate counter; a failed analysis is refunded. Batch requests require owner/admin membership, deduplicate ASINs, and return one success/error record per unique ASIN.

## API

All paths below use `/api` unless otherwise noted.

| Method and path                                                          | Access / behavior                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                                            | Public liveness, outside `/api`.                                                                                                                                                                |
| `POST /auth/register`, `/auth/login`                                     | Public, separately rate-limited. Registration is transactional.                                                                                                                                 |
| `POST /auth/forgot-password`, `/auth/reset-password`                     | Public recovery; configured email delivery is required.                                                                                                                                         |
| `GET /auth/me`                                                           | Current account and live membership/plan.                                                                                                                                                       |
| `GET /auth/api-keys`, `POST /auth/api-keys`, `DELETE /auth/api-keys/:id` | List/create/revoke the current user's organization-scoped keys.                                                                                                                                 |
| `GET /products/featured`                                                 | Public cached seeds, no provider work.                                                                                                                                                          |
| `GET /products/:asin`, `GET /products/:asin/history`                     | Authenticated, one ASIN credit. History returns `priceHistory` and `bsrHistory`.                                                                                                                |
| `GET /products/trending`, `/products/bestsellers`                        | Authenticated category discovery, up to 12 credits each.                                                                                                                                        |
| `POST /batch/analyze`                                                    | Owner/admin; body `{ "asins": ["B08N5WRWNW"] }`.                                                                                                                                                |
| `POST /analysis/product`                                                 | Authenticated AI; body `{ "product": { "asin": "B08N5WRWNW" }, "userStats": { "buyCost": 10, "profit": 5, "roi": 50 } }`. Caller market/risk fields are ignored; canonical server data is used. |
| `GET /watchlist`, `POST /watchlist`, `DELETE /watchlist/:idOrAsin`       | Organization-scoped watchlists. POST needs `asin`; optional targets and notes are validated. Look up a product before saving it.                                                                |
| `GET /sourcing`, `POST /sourcing`, `DELETE /sourcing/:id`                | Organization-scoped notes; POST needs `asin` and nonnegative `costPrice`.                                                                                                                       |
| `GET /billing/plans`                                                     | Public plan metadata.                                                                                                                                                                           |
| `GET /billing/usage`                                                     | Current organization's usage and effective plan.                                                                                                                                                |
| `POST /billing/checkout`                                                 | Owner/admin; creates/reuses checkout or returns a portal session for an existing subscription.                                                                                                  |
| `POST /billing/webhook`                                                  | Direct Stripe endpoint, raw-body signature verification.                                                                                                                                        |

Batch records are `{ "ok": true, "asin": "...", "product": {...} }` or `{ "ok": false, "asin": "...", "error": "..." }`. Invalid input is rejected before reserving credits. Quota/batch-plan rejection returns HTTP 402; unauthorized access returns 401, insufficient role returns 403, and unexpected service failures return a generic 500 without leaking provider credentials.

## Stripe and production rollout

Create the Pro recurring price and configure the billing portal. Point Stripe at `https://api.example.com/api/billing/webhook`; subscribe to checkout completion/async success, subscription created/updated/deleted, invoice paid, and invoice payment failed events. Paid access requires an active/trialing subscription with the configured price and a future period end. Checkout completion alone does not grant Pro. Webhooks re-fetch current Stripe subscriptions, check customer identity, and reject older/duplicate events. Expired or missing period ends use Free limits.

Before releasing these paired changes:

1. Back up/export the old database, apply the Neon migrations, and import existing records into the empty target.
2. Configure Neon database URLs, BETTER_AUTH_SECRET, BETTER_AUTH_URL, Redis, HTTPS frontend URLs, provider credentials, reset sender, and Stripe webhook/price/portal.
3. Deploy the backend and verify registration, membership, reset email, representative provider fields, quota refunds, and signed billing events in staging.
4. Deploy the matching frontend with its backend origin. Existing sessions must sign in again because authentication now uses Better Auth sessions.

The migration disables direct client table access by design. Do not roll the API back independently after migration without reviewing schema compatibility. Historical Pro rows with no valid period end need Stripe state reconciliation; they receive Free limits until reconciled. This repository change does not apply production migrations, rotate deployed secrets, deploy services, or send test emails.

## Background refresh and checks

Enable metrics sync only when periodic paid refresh is intended. A Redis owner-token lock and local running guard prevent overlapping jobs. Products rotate through the refresh queue; failed attempts also advance. Price/rank snapshots are written only when values are available. The job deletes snapshots older than 180 days and settled usage reservations older than seven days. Its provider work is limited by configured concurrency and the job time budget.

```sh
npm test
npm audit
```

`npm test` builds the API and tests passwords/config, Better Auth signup/session/recovery and imported credentials, the parameterized SQL adapter, HTTP auth and tenant filters, quota settlement/refunds, missing AI configuration, provider deadlines/mapping, and the actual SQL migrations/functions using PGlite's embedded PostgreSQL. Embedded database queries run on one connection; the row-lock design still requires a multi-connection staging check for production concurrency. Tests do not contact a live Neon, Stripe, email, or product-provider account. GitHub Actions runs these checks and a dependency audit.

## Render deployment and database cutover

Backend Web Service: build `npm ci --include=dev && npm run build`, start `npm start`. Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`, `REDIS_URL`, and existing provider/billing/email variables. Run `npm run migrate` as a pre-deploy step or controlled migration job before starting the new API. Database migrations are deliberately not run during builds. The frontend is a Static Site with build `npm ci --include=dev && npm run build`, publish directory `dist`, and build-time `VITE_API_BASE` pointing at the backend origin.

For existing data, follow [docs/neon-cutover.md](docs/neon-cutover.md). Do not switch production to an empty Neon branch if existing accounts or billing records must be retained. Never commit exported account data, connection strings, or auth secrets. This branch prepares the migration; it does not itself update Render, publish code, or copy source data.
