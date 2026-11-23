# UniStore: InterSwitch Web Checkout, backend first

UniStore is a deliberately small e-commerce backend built for the **InterSwitch Developer Community workshop at the University of Uyo**. It sells a single fictional product and shows how to accept a card payment with **InterSwitch Inline Checkout** in a way you could defend in a code review:

- The **server** owns the price and generates the transaction reference.
- The **browser** only opens the checkout and asks the server to verify.
- The **server** independently requeries InterSwitch, checks the response code, the amount and the reference, and only then marks the order `PAID`.

Stack: Node.js (ES modules), Express 5, PostgreSQL, Prisma 6, Zod, native `fetch`, Vitest + Supertest. No TypeScript, Docker, queues or frontend framework.

---

## Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Environment configuration](#environment-configuration)
5. [Database setup and migrations](#database-setup-and-migrations)
6. [Running the application](#running-the-application)
7. [API documentation](#api-documentation)
8. [The payment lifecycle](#the-payment-lifecycle)
9. [InterSwitch sandbox instructions](#interswitch-sandbox-instructions)
10. [Testing](#testing)
11. [Workshop branches](#workshop-branches)
12. [Troubleshooting](#troubleshooting)
13. [Known limitations](#known-limitations)

---

## Architecture

```
HTTP request
   │
   ▼
routes/        which URL maps to which controller, plus Zod validation middleware
   │
   ▼
controllers/   read the validated request, call a service, shape the HTTP response
   │
   ▼
services/      business rules: pricing, payability, state transitions, idempotency
   │        └──────────────► integrations/interswitch/   everything that talks to, or interprets, the gateway
   ▼
repositories/  Prisma queries, nothing else
   │
   ▼
PostgreSQL
```

```
src/
  app.js                         Express app factory (used by server and tests)
  server.js                      starts the HTTP server, graceful shutdown
  config/
    env.js                       loads .env, validates every variable with Zod, exports a frozen config
    database.js                  Prisma client
    products.js                  server-owned catalogue (the only source of prices)
  routes/                        index.js, order.routes.js, payment.routes.js
  controllers/                   order, payment, health
  services/
    order.service.js             createOrder, getOrder, getProducts
    payment.service.js           initializePayment, verifyPayment, getPayment
  integrations/interswitch/
    checkout-config.js           builds the safe Inline Checkout request for the browser
    requery-client.js            GET gettransaction.json with a timeout, raises GatewayUnavailableError
    transaction-interpreter.js   pure function: gateway response + expectations -> SUCCESSFUL | FAILED | PENDING
    errors.js
  repositories/                  order.repository.js, payment.repository.js
  middleware/                    validate.js, error-handler.js, request-context.js
  validators/                    Zod request schemas
  utils/                         errors, logger (with email masking), presenters, transaction-reference
prisma/
  schema.prisma
  migrations/                    includes a partial unique index and CHECK constraints
public/                          index.html, checkout.js, styles.css (no framework)
scripts/mock-interswitch.js      local requery test double for offline demos
tests/unit, tests/integration    Vitest suites; the gateway is always mocked
http/                            Postman collection and a VS Code REST Client file
```

### Design decisions worth discussing in the session

| Decision | Why |
| --- | --- |
| Amounts are `Int` in **kobo** (`amountMinor`) | No floating-point money. ₦100.00 is `10000`. |
| Prices come from `config/products.js` | The client sends a `productId`, never an amount. Request schemas are `.strict()`, so an `amountMinor` field is rejected with `400`. |
| Transaction reference generated server-side | `UNI-<base36 time>-<16 hex random>`, unique in the database. |
| One `PENDING` payment per order (partial unique index) | Concurrent "Pay" clicks cannot create duplicate attempts; initialization is idempotent. |
| Status updates are compare-and-set (`UPDATE … WHERE status = <the status we read>`) | Two concurrent verifications cannot both win, and a late response can never overwrite `SUCCESSFUL`. |
| Order is marked `PAID` in the same DB transaction as the payment | No paid payment with an unpaid order, or the reverse. |
| Timeouts, network errors, 5xx and non-JSON responses never fail a payment | They are *unknown*, not *declined*. The payment stays `PENDING` and can be requeried. |
| The interpreter is a pure function | It is the core business rule and the easiest thing to unit-test and teach. |

---

## Prerequisites

- **Node.js 20.12+** (22 LTS recommended). `process.loadEnvFile` and `node --watch` are built in, so there's no `dotenv` or `nodemon`.
- **PostgreSQL 14+** running locally (Homebrew, Postgres.app, the Windows installer or your Linux package manager).
- Internet access to `*.interswitchng.com` for real sandbox checkout and requery. Offline demos can use the mock gateway.

---

## Installation

```bash
git clone <this repo> unistore
cd unistore
npm install          # also runs `prisma generate`
cp .env.example .env
```

---

## Environment configuration

Every variable is validated at startup by [src/config/env.js](src/config/env.js). The server refuses to boot with a clear message if one is missing or malformed.

| Variable | Example | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3000` | HTTP port |
| `APP_BASE_URL` | `http://localhost:3000` | Sent to Inline Checkout as `site_redirect_url` |
| `DATABASE_URL` | `postgresql://unistore:unistore@localhost:5432/unistore?schema=public` | Prisma connection string |
| `INTERSWITCH_MODE` | `TEST` | `TEST` or `LIVE`, passed to `webpayCheckout` |
| `INTERSWITCH_MERCHANT_CODE` | `MX6072` | Shared sandbox merchant code |
| `INTERSWITCH_PAY_ITEM_ID` | `9405967` | Shared sandbox pay item ID |
| `INTERSWITCH_CHECKOUT_SCRIPT_URL` | `https://newwebpay-sandbox.interswitchng.com/inline-checkout.js` | Inline Checkout script; the browser loads whatever the server returns |
| `INTERSWITCH_REQUERY_URL` | `https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json` | Server-side requery endpoint |
| `INTERSWITCH_TIMEOUT_MS` | `10000` | Requery timeout |
| `PAYMENT_PENDING_WINDOW_MINUTES` | `30` | How long an attempt may stay unresolved (InterSwitch documents a 30-minute transaction lifetime) |

The sandbox values above are **shared public test details**, not secrets. The documented requery endpoint needs no API key, so the project holds no secrets at all. If you add a credentialed InterSwitch API later, keep it in `.env`, which is git-ignored.

In `production`, the server refuses to start if `INTERSWITCH_REQUERY_URL` points at `localhost`, so the mock gateway cannot leak into a real deployment.

---

## Database setup and migrations

Create a role and two databases (one for development, one for automated tests). On macOS/Linux:

```bash
psql -d postgres -c "CREATE ROLE unistore WITH LOGIN PASSWORD 'unistore' CREATEDB;"
psql -d postgres -c "CREATE DATABASE unistore OWNER unistore;"
psql -d postgres -c "CREATE DATABASE unistore_test OWNER unistore;"
```

`CREATEDB` is needed because `prisma migrate dev` creates a temporary shadow database.

Apply migrations:

```bash
npm run db:migrate     # development: applies migrations, regenerates the client
npm run db:deploy      # CI / production: applies existing migrations only
npm run db:studio      # browse the data
```

The test suite migrates `unistore_test` automatically before running. Override its URL with `TEST_DATABASE_URL` if your credentials differ.

### Schema

- `orders`: `id (uuid)`, `customer_email`, `product_id`, `amount_minor (int > 0)`, `currency ('566')`, `status (PENDING | PAID | CANCELLED)`, timestamps.
- `payments`: `id (uuid)`, `order_id (FK)`, `transaction_reference (unique)`, `amount_minor (int > 0)`, `currency`, `status (PENDING | SUCCESSFUL | FAILED)`, `gateway_payment_reference`, `gateway_response_code`, `gateway_response_description`, `verified_at`, timestamps.
- Partial unique index `payments_one_pending_per_order` on `order_id WHERE status = 'PENDING'`.
- CHECK `payments_verified_when_final`: `verified_at` is set if and only if the status is final.

No card numbers, CVVs, PINs or OTPs are ever received or stored. They go straight from the browser into InterSwitch's checkout.

---

## Running the application

```bash
npm run dev        # node --watch: restarts on changes to any imported source file
npm start          # without watch mode
```

Open <http://localhost:3000>, enter an email and click **Pay with InterSwitch**.

`node --watch` does not watch `.env`. Restart after changing environment variables.

### Offline demo (no InterSwitch network access)

```bash
npm run mock:gateway                # starts a requery test double on :4010
```

Then set this in `.env` and restart the server:

```
INTERSWITCH_REQUERY_URL=http://localhost:4010/collections/api/v1/gettransaction.json
```

Switch scenarios while presenting:

```bash
curl -X POST "localhost:4010/__scenario?name=declined"
# approved | declined | pending | not-found | amount-mismatch | timeout | server-error
```

The mock replaces only the **requery**. Use it with Postman or the `.http` file. The Inline Checkout popup still needs the real sandbox.

---

## API documentation

All responses are JSON. Success responses look like `{ "data": … }`. Errors look like `{ "error": { "code", "message", "details?" } }`.

Ready-made requests: [http/UniStore.postman_collection.json](http/UniStore.postman_collection.json) (Postman) and [http/unistore.http](http/unistore.http) (VS Code REST Client / JetBrains HTTP client).

### `GET /api/health`

```json
{ "data": { "status": "ok", "database": "up", "uptimeSeconds": 12, "checkedAt": "2026-11-23T18:18:37.836Z" } }
```

Returns `503` with `"database": "down"` if PostgreSQL is unreachable.

### `GET /api/products`

```json
{ "data": [ { "id": "unistore-hoodie", "name": "UniStore Campus Hoodie", "description": "…", "priceMinor": 10000, "currency": "566" } ] }
```

### `POST /api/orders`

```json
{ "customerEmail": "ada@uniuyo.edu.ng", "productId": "unistore-hoodie" }
```

`201`:

```json
{
  "data": {
    "id": "1e8646fb-73da-4a4f-8e1a-06967f9ca508",
    "customerEmail": "ada@uniuyo.edu.ng",
    "productId": "unistore-hoodie",
    "amountMinor": 10000,
    "currency": "566",
    "status": "PENDING",
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

Errors: `400 VALIDATION_ERROR` (bad email, or unknown fields such as `amountMinor`), `400 INVALID_JSON`, `404 PRODUCT_NOT_FOUND`.

### `GET /api/orders/:orderId`

Returns the order. Errors: `400` (not a UUID), `404 ORDER_NOT_FOUND`.

### `POST /api/payments/initialize`

```json
{ "orderId": "1e8646fb-73da-4a4f-8e1a-06967f9ca508" }
```

`201`:

```json
{
  "data": {
    "payment": {
      "transactionReference": "UNI-MWTLACGU-4DF2D9ECAA3C0544",
      "status": "PENDING",
      "isFinal": false,
      "amountMinor": 10000,
      "currency": "566",
      "gatewayResponseCode": null,
      "gatewayResponseDescription": null,
      "gatewayPaymentReference": null,
      "verifiedAt": null,
      "createdAt": "…",
      "order": { "id": "…", "status": "PENDING", "customerEmail": "a***@uniuyo.edu.ng", "amountMinor": 10000, "currency": "566" }
    },
    "checkout": {
      "scriptUrl": "https://newwebpay-sandbox.interswitchng.com/inline-checkout.js",
      "request": {
        "merchant_code": "MX6072",
        "pay_item_id": "9405967",
        "pay_item_name": "UniStore Campus Hoodie",
        "txn_ref": "UNI-MWTLACGU-4DF2D9ECAA3C0544",
        "amount": 10000,
        "currency": 566,
        "cust_email": "ada@uniuyo.edu.ng",
        "site_redirect_url": "http://localhost:3000",
        "mode": "TEST"
      }
    }
  }
}
```

Behaviour:

- Calling it again while an attempt is pending returns **the same** reference (idempotent, safe under concurrency).
- If the pending attempt is older than `PAYMENT_PENDING_WINDOW_MINUTES`, it is requeried first. If the gateway confirms it failed, a new attempt is created. If the gateway cannot answer, the call fails with `409 PAYMENT_UNRESOLVED` instead of blindly starting a second charge.

Errors: `400` (bad UUID or extra fields), `404 ORDER_NOT_FOUND`, `409 ORDER_ALREADY_PAID`, `409 ORDER_NOT_PAYABLE`, `409 PAYMENT_UNRESOLVED`.

### `POST /api/payments/verify`

```json
{ "transactionReference": "UNI-MWTLACGU-4DF2D9ECAA3C0544" }
```

`200` (always, for any known reference). Read `status`, `isFinal` and `verification.reason`:

```json
{
  "data": {
    "transactionReference": "UNI-MWTLACGU-4DF2D9ECAA3C0544",
    "status": "SUCCESSFUL",
    "isFinal": true,
    "amountMinor": 10000,
    "currency": "566",
    "gatewayResponseCode": "00",
    "gatewayResponseDescription": "Approved by Financial Institution",
    "gatewayPaymentReference": "UBA|API|MX6072|25-07-2024|249510|719456",
    "verifiedAt": "…",
    "createdAt": "…",
    "order": { "id": "…", "status": "PAID", "customerEmail": "a***@uniuyo.edu.ng", "amountMinor": 10000, "currency": "566" },
    "verification": { "reason": "APPROVED" }
  }
}
```

| `verification.reason` | `status` | Meaning |
| --- | --- | --- |
| `APPROVED` | SUCCESSFUL | `ResponseCode` `00`, amount and reference match |
| `AMOUNT_MISMATCH` | FAILED | `00` but the gateway amount differs from the stored amount. Never fulfilled; logged as a warning for reconciliation |
| `DECLINED` | FAILED | Any other non-pending code (e.g. `51`, `Z1`) |
| `EXPIRED_NOT_COMPLETED` | FAILED | `Z0`/`Z25` after the pending window |
| `NOT_COMPLETED` | PENDING | `Z0` / `Z25` (not found) inside the window: the customer may still be paying |
| `IN_PROGRESS` | PENDING | `09` or `S0`: InterSwitch says requery later |
| `REFERENCE_MISMATCH` | PENDING | The gateway answered about a different `MerchantReference`. Inconclusive, not a failure |
| `MISSING_RESPONSE_CODE` | PENDING | Unusable body |
| `GATEWAY_UNAVAILABLE` | PENDING | Timeout, network error, non-2xx or non-JSON. Nothing is written |
| `ALREADY_FINAL` | (stored) | Nothing changed: the stored final state was returned |

Verification rules:

- `SUCCESSFUL` is terminal. It is never requeried and never overwritten.
- `FAILED` is re-checked only inside the pending window, and can only move to `SUCCESSFUL`. This covers a customer pressing **Retry payment** inside the InterSwitch popup, which reuses the same `txn_ref`. After the window, `FAILED` is terminal.
- Errors: `400` (missing reference), `404 PAYMENT_NOT_FOUND` (no gateway call is made).

### `GET /api/payments/:reference`

Returns the **persisted** payment and order status without contacting InterSwitch. Errors: `404 PAYMENT_NOT_FOUND`.

---

## The payment lifecycle

```
Browser                         UniStore API                         InterSwitch
───────                         ────────────                         ───────────
POST /api/orders  ───────────►  price from catalogue, order PENDING
POST /payments/initialize ───►  txn_ref generated, payment PENDING
                 ◄────────────  { checkout.scriptUrl, checkout.request }
load inline-checkout.js
webpayCheckout(request) ─────────────────────────────────────────►  customer pays in popup
onComplete(response)  ◄──────────────────────────────────────────  (NOT proof of payment)
POST /payments/verify ───────►  GET gettransaction.json?merchantcode&transactionreference&amount ──►
                                 ◄── { ResponseCode, Amount, MerchantReference, PaymentReference, … }
                                interpretRequeryResponse()
                                BEGIN
                                  UPDATE payments … WHERE id = ? AND status = <read status>
                                  UPDATE orders SET status = PAID WHERE id = ? AND status = PENDING
                                COMMIT
                 ◄────────────  { status, isFinal, order.status, verification.reason }
```

State machines:

```
Payment:  PENDING ──► SUCCESSFUL           (terminal)
          PENDING ──► FAILED ──► SUCCESSFUL (only inside the pending window, only on a verified approval)
          PENDING ──► PENDING               (inconclusive: keep requerying)

Order:    PENDING ──► PAID                  (only together with a SUCCESSFUL payment)
          PENDING ──► CANCELLED             (modelled; no endpoint in this demo)
```

---

## InterSwitch sandbox instructions

Sources: [Web Checkout](https://docs.interswitchgroup.com/docs/web-checkout), [Quickstart](https://docs.interswitchgroup.com/docs/quickstart-accept-your-first-payment-in-5-minutes), [Payment response codes](https://docs.interswitchgroup.com/docs/payment-response-codes).

**Inline Checkout**: the browser loads `https://newwebpay-sandbox.interswitchng.com/inline-checkout.js` (live: `https://newwebpay.interswitchng.com/inline-checkout.js`) and calls `window.webpayCheckout(request)` with an `onComplete` callback. The backend builds `request`. The browser adds only `onComplete`.

**Transaction requery**:

```
GET https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json
    ?merchantcode=MX6072&transactionreference=<txn_ref>&amount=<kobo>
Content-Type: application/json
```

The docs show only `Content-Type`, with no authentication header, and this project sends nothing else. A successful response contains `ResponseCode: "00"`, `Amount` (kobo), `MerchantReference` (your `txn_ref`) and `PaymentReference`. Requery works for transactions from the last 3 months.

Observed while building this project (sandbox, November 2026):

- An unknown reference returns **HTTP 200** with `{"ResponseCode":"Z25","ResponseDescription":"Transaction not Found","Amount":0,…}`. That's why `Z25` is "not completed yet", not "declined".
- A sandbox card failure returned `ResponseCode: "Z1"` / `"Transaction Error"`.
- `sandbox.interswitchng.com` resets connections from `curl`'s default user agent. Node's `fetch` and browsers work. Use Postman or the app instead of bare `curl` for the requery URL.

**Test cards** (from the Quickstart, PIN `1111`, OTP `123456` where asked):

| Card | Number | Expiry | CVV |
| --- | --- | --- | --- |
| Verve | 5060990580000217499 | 03/50 | 111 |
| Visa | 4000000000002503 | 03/50 | 11 |
| Mastercard | 5123450000000008 | 01/39 | 100 |
| Insufficient funds (failure) | 5060990580000000390 | 03/50 | 111 |

Go-live checklist: your own merchant code and pay item ID, `INTERSWITCH_MODE=LIVE`, the live script URL, the live requery host, HTTPS `APP_BASE_URL`.

---

## Testing

```bash
npm test                  # unit + integration (needs PostgreSQL and the unistore_test DB)
npm run test:unit         # no database required
npm run test:integration
npm run test:watch
```

`fetch` is mocked in every test. A test that accidentally reaches the network fails with `Unexpected outbound request in test`.

Covered:

| Area | Tests |
| --- | --- |
| Orders | server pricing, email normalisation, rejected client amount, invalid email, unknown product, malformed JSON |
| Initialization | checkout config contract, idempotent re-initialization, 8 concurrent initializations → 1 payment, unique references, paid/cancelled/unknown orders, stale attempt requery (declined, never-seen, gateway down) |
| References | format, length, 20,000 generations without collision |
| Requery client | exact URL and query parameters, timeout, network error, HTTP 5xx, non-JSON |
| Interpreter | approved, string amount, missing `MerchantReference`, amount mismatch, fractional amount, reference mismatch, declined, `09`/`S0`, `Z25` inside/after window, missing code |
| Verification | success → PAID, declined, amount mismatch, reference mismatch, unknown reference, timeout, 503, not-yet-completed then approved, duplicate verification (single gateway call), late decline cannot overwrite success, concurrent slow-decline vs fast-approval race, declined → approved retry, no upgrade on amount mismatch, failed is final after the window |

---

## Workshop branches

| Branch | Contents |
| --- | --- |
| `main` | Complete, tested implementation. Your recovery point if live coding goes wrong: `git checkout main -- <file>` |
| `workshop-starter` | Infrastructure, orders, routes, controllers, repositories, frontend and the full test suite. The payment functions to live-code throw a `501 NOT_IMPLEMENTED` error naming the exercise. See [WORKSHOP.md](WORKSHOP.md). |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration: DATABASE_URL: Required` | `cp .env.example .env` |
| `P1001: Can't reach database server` | Start PostgreSQL. Check host and port in `DATABASE_URL` |
| `P1010: User was denied access` / `permission denied to create database` | Run the `CREATE ROLE … CREATEDB` command above |
| `database "unistore_test" does not exist` when testing | Create it, or set `TEST_DATABASE_URL` |
| Homebrew: `database files are incompatible with server` | Your `pg_ctl` is a different major version from the data directory. Use the matching binary, e.g. `$(brew --prefix postgresql@16)/bin/pg_ctl` |
| macOS Postgres: `postmaster became multithreaded during startup` | `export LC_ALL=en_US.UTF-8` before starting it |
| Checkout popup never opens | The browser could not load `inline-checkout.js`. Check the network tab, ad blockers and connectivity to `newwebpay-sandbox.interswitchng.com` |
| Verify always returns `GATEWAY_UNAVAILABLE` | Network or firewall to `sandbox.interswitchng.com`. Raise `INTERSWITCH_TIMEOUT_MS`, or use the mock gateway |
| Verify returns `PENDING` with `Z25` | The customer has not completed payment, or the sandbox has not recorded it yet. Requery again |
| `409 PAYMENT_UNRESOLVED` | An old attempt could not be confirmed. Call `/api/payments/verify` for the reference in `error.details` |
| `curl` to the requery URL gets `Connection reset by peer` | Known sandbox behaviour for curl's user agent. Use Postman, the app or `curl -A "Mozilla/5.0"` |
| `Prisma Migrate detected that it was invoked by …` | Prisma blocks destructive commands from AI agents. Run `npm run db:reset` yourself |

---

## Known limitations

- **A successful sandbox card payment has not been confirmed end to end by automated tooling.** Checkout launch, the `onComplete` → verify flow, and real-gateway `Z25` and `Z1` handling were all exercised against the live sandbox. The documented Verve test card was declined (`Z1`) on the day of testing. Run one manual payment before the workshop.
- `onComplete`'s response object is not documented in detail. The frontend ignores its contents by design.
- The Web Checkout docs disagree on whether `amount`/`currency` are strings or integers. This project sends integers, matching the Quickstart sample, and the sandbox accepted them.
- No webhook endpoint. InterSwitch documents webhooks (`X-Interswitch-Signature`, HMAC-SHA512, configured in the Quickteller Business dashboard), but they cannot be demonstrated with the shared sandbox merchant. It's a natural extension: the handler would call the same `verifyPayment` service.
- No background reconciliation job. Pending payments are resolved when someone calls verify or re-initializes. A production system would requery stale `PENDING` rows on a schedule.
- No authentication. `GET /api/payments/:reference` masks the customer email for that reason.
- A payment that is approved for an order that was already paid (or cancelled) is logged as `payment.successful_for_unpayable_order` for a manual refund. Refunds are out of scope.
