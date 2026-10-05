# AmzPulse Server

Express and TypeScript API for [AmzPulse](https://github.com/Viral-Ad-Media/amzpulse). The backend owns authentication, organization membership, metered product and AI requests, watchlists, sourcing notes, password recovery, and Stripe subscriptions. Supabase stores application data; Redis supplies distributed rate limits and background-job locks.

## Setup

Use Node.js 22 or newer and a Supabase project.

```sh
npm ci
cp .env.example .env
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a persistent random `JWT_SECRET`. Generate the secret with `openssl rand -hex 32`. Set `FRONTEND_URL` to the frontend's full base URL; comma-separated URLs allow multiple frontend origins. The first URL supplies reset links and billing redirects, including any deployment subpath.

Apply the SQL files in `supabase/migrations/` in filename order through the Supabase migration workflow or SQL editor. On an existing installation, apply only unapplied migrations. The latest migration is `20261005190000_audit_security.sql`. It is required before starting this code: it enables RLS, removes `anon` and `authenticated` table/function access, and adds transactional registration, password reset, quotas, subscription updates, session versions, and canonical product storage. Use the backend service-role key; a publishable key cannot operate this API.

Configure at least one product provider below, then run:

```sh
npm run dev
```

Production:

```sh
npm run build
npm start
```

The build copies the ESM provider modules into `dist/product-api/`. Deploy that directory with the compiled API. `GET /health` returns the API status; it is a liveness check, not a live probe of Supabase, Stripe, or provider credentials.

## Environment

The complete template is [.env.example](.env.example). Production requires `REDIS_URL`, explicit HTTPS frontend URLs, and a persistent random JWT secret of at least 32 characters. Redis must connect before the server starts; distributed rate-limit failures fail closed. In local development without Redis, limits and the bounded product cache use process memory.

| Settings                                                                  | Purpose                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `NODE_ENV`                                                        | HTTP listener and runtime mode.                                                                                                       |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                               | Required server-owned database access.                                                                                                |
| `JWT_SECRET`                                                              | Persistent JWT signing secret. Sessions last one hour; live membership and token-version checks apply on every authenticated request. |
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

Send `Authorization: Bearer <token>` or `X-API-Key: <key>` on protected routes. API keys are returned once when created; the database stores only their hashes. Keys require a current membership. Password resets atomically consume one unexpired token, change the password, increment the user's session version, invalidate existing JWTs, revoke that user's API keys, and remove their other reset tokens. Reset endpoints never return a reset URL or token, in any runtime mode.

Application JWTs are distinct from Supabase Auth tokens. Browser clients cannot access application tables directly. Tenant access is enforced in the backend with the live organization membership and organization filters.

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

1. Back up the database and apply the security migration with deployment access.
2. Configure the service-role key, random JWT secret, Redis, HTTPS frontend URLs, provider credentials, reset sender, and Stripe webhook/price/portal.
3. Deploy the backend and verify registration, membership, reset email, representative provider fields, quota refunds, and signed billing events in staging.
4. Deploy the matching frontend with its backend origin. Existing JWT sessions must sign in again because old tokens lack a session version.

The migration disables direct client table access by design. Do not roll the API back independently after migration without reviewing schema compatibility. Historical Pro rows with no valid period end need Stripe state reconciliation; they receive Free limits until reconciled. This repository change does not apply production migrations, rotate deployed secrets, deploy services, or send test emails.

## Background refresh and checks

Enable metrics sync only when periodic paid refresh is intended. A Redis owner-token lock and local running guard prevent overlapping jobs. Products rotate through the refresh queue; failed attempts also advance. Price/rank snapshots are written only when values are available. The job deletes snapshots older than 180 days and settled usage reservations older than seven days. Its provider work is limited by configured concurrency and the job time budget.

```sh
npm test
npm audit
```

`npm test` builds the API and tests passwords/JWT/config, HTTP auth and tenant filters, quota settlement/refunds, missing AI configuration, provider deadlines/mapping, and the actual SQL migrations/functions using PGlite's embedded PostgreSQL. Embedded database queries run on one connection; the row-lock design still requires a multi-connection staging check for production concurrency. Tests do not contact a live Supabase, Stripe, email, or product-provider account. GitHub Actions runs these checks and a dependency audit.
