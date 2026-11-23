# Live-coding guide

This guide is for the presenter. Each exercise is a small, self-contained step with a failing test suite that turns green when the step is done.

## Before the session

```bash
git checkout workshop-starter
npm install
npm run db:migrate
npm test                    # order tests pass, payment tests fail: that's the starting point
npm run dev
```

Keep a second terminal on `main` (`git worktree add ../unistore-main main`) so you can open the finished code at any time.

Recovery if a step goes wrong: `git checkout main -- <file>`.

## What is already in place on `workshop-starter`

- Express app, routing, Zod validation, centralized error handling, request logging
- Prisma schema and migrations (including the one-pending-payment-per-order index)
- Orders: catalogue, `POST /api/orders`, `GET /api/orders/:id`
- Repositories for orders and payments (including the compare-and-set `updatePaymentIfStatus`)
- `buildInlineCheckoutConfig` and `GatewayUnavailableError`
- `generateTransactionReference`
- The frontend and the full test suite

## Exercises

Each stub throws `AppError(501, 'NOT_IMPLEMENTED', 'Workshop exercise N: …')`, so a missed step shows up clearly in the browser and in Postman.

### Exercise 1: Initialize a payment

File: [src/services/payment.service.js](src/services/payment.service.js), function `initializePayment(orderId)`

1. Load the order. Throw `404 ORDER_NOT_FOUND` if it is missing.
2. `assertOrderPayable(order)`: `409 ORDER_ALREADY_PAID` / `409 ORDER_NOT_PAYABLE`.
3. Reuse an existing `PENDING` payment (`findPendingPaymentForOrder`) so repeated clicks are idempotent.
4. Otherwise `createPayment` with a server-generated reference and the **order's** amount.
5. Handle `P2002` (unique violation) from a concurrent request by re-reading the pending payment.
6. Return `{ payment: presentPayment(...), checkout: buildInlineCheckoutConfig(...) }`.

Talking points: never trust the client's amount; why the reference comes from the server; the partial unique index.

Tests: `npx vitest run tests/integration/payment-initialization.test.js -t "creates|same pending|concurrent|unique|paid|cancelled|unknown|malformed|ignores"`

### Exercise 2: Call the requery API

File: [src/integrations/interswitch/requery-client.js](src/integrations/interswitch/requery-client.js), functions `buildRequeryUrl`, `requeryTransaction`

1. Build `INTERSWITCH_REQUERY_URL?merchantcode=…&transactionreference=…&amount=…`.
2. `fetch` with `AbortSignal.timeout(config.interswitch.timeoutMs)`.
3. Translate timeouts, network errors, non-2xx and non-JSON bodies into `GatewayUnavailableError` with reasons `TIMEOUT`, `NETWORK`, `HTTP_STATUS` and `INVALID_RESPONSE`.

Talking points: a timeout is "we don't know", not "it failed".

Tests: `npx vitest run tests/unit/requery-client.test.js`

### Exercise 3: Interpret the gateway's answer

File: [src/integrations/interswitch/transaction-interpreter.js](src/integrations/interswitch/transaction-interpreter.js), function `interpretRequeryResponse(response, expected, now)`

Return `{ status, reason, responseCode, responseDescription, paymentReference }`:

| Gateway says | Result |
| --- | --- |
| no usable `ResponseCode` | `PENDING`, `MISSING_RESPONSE_CODE` |
| `00` and `Amount` ≠ expected | `FAILED`, `AMOUNT_MISMATCH` |
| `00` and `MerchantReference` present but different | `PENDING`, `REFERENCE_MISMATCH` |
| `00`, amount and reference match | `SUCCESSFUL`, `APPROVED` |
| `09`, `S0` | `PENDING`, `IN_PROGRESS` |
| `Z0`, `Z25` inside the window | `PENDING`, `NOT_COMPLETED` |
| `Z0`, `Z25` after the window | `FAILED`, `EXPIRED_NOT_COMPLETED` |
| anything else | `FAILED`, `DECLINED` |

Talking points: a pure function is the easiest thing to test; the callback's `resp === "00"` is not proof.

Tests: `npx vitest run tests/unit/transaction-interpreter.test.js`

### Exercise 4: Verify and settle

File: [src/services/payment.service.js](src/services/payment.service.js), function `verifyPayment(transactionReference)`

1. Load the payment with its order. Throw `404 PAYMENT_NOT_FOUND` if it is missing.
2. If it can no longer change (`SUCCESSFUL`, or `FAILED` past the window), return it with reason `ALREADY_FINAL`, without calling the gateway.
3. Requery. On `GatewayUnavailableError`, return the stored state with `GATEWAY_UNAVAILABLE`.
4. Interpret, using the **stored** amount and reference.
5. Allowed transitions only: `PENDING → anything`, `FAILED → SUCCESSFUL`.
6. In one `runInTransaction`: `updatePaymentIfStatus(id, <status you read>, …)`. If it updated a row and the outcome is `SUCCESSFUL`, `markOrderPaidIfPending`.
7. Return the fresh state with the outcome's reason, or `ALREADY_FINAL` if another request won the race.

Talking points: compare-and-set instead of locks; why a late "declined" must never overwrite "approved"; why the overlay's **Retry payment** button forces `FAILED → SUCCESSFUL`.

Tests: `npx vitest run tests/integration/payment-verification.test.js`, then `npm test`

### Finale

Run a real sandbox payment from <http://localhost:3000> with the Verve test card in the README, then show the row in `npm run db:studio`.
