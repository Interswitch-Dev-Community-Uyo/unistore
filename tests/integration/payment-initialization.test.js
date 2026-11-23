import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { TRANSACTION_REFERENCE_PATTERN } from '../../src/utils/transaction-reference.js';
import { prisma, resetDatabase } from '../helpers/database.js';
import { declinedRequery, mockGateway, notFoundRequery } from '../helpers/gateway.js';

const app = createApp();

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function createOrder() {
  const response = await request(app)
    .post('/api/orders')
    .send({ customerEmail: 'ada@uniuyo.edu.ng', productId: 'unistore-hoodie' })
    .expect(201);
  return response.body.data;
}

function initialize(orderId) {
  return request(app).post('/api/payments/initialize').send({ orderId });
}

async function ageAllPayments(minutes) {
  await prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - minutes * 60_000) } });
}

describe('POST /api/payments/initialize', () => {
  it('creates a pending payment and returns the inline checkout configuration', async () => {
    const order = await createOrder();
    const response = await initialize(order.id).expect(201);
    const { payment, checkout } = response.body.data;

    expect(payment.transactionReference).toMatch(TRANSACTION_REFERENCE_PATTERN);
    expect(payment).toMatchObject({ status: 'PENDING', amountMinor: 10000, currency: '566', isFinal: false });
    expect(checkout).toEqual({
      scriptUrl: 'https://newwebpay-sandbox.interswitchng.com/inline-checkout.js',
      request: {
        merchant_code: 'MX6072',
        pay_item_id: '9405967',
        pay_item_name: 'UniStore Campus Hoodie',
        txn_ref: payment.transactionReference,
        amount: 10000,
        currency: 566,
        cust_email: 'ada@uniuyo.edu.ng',
        site_redirect_url: 'http://localhost:3000',
        mode: 'TEST',
      },
    });

    const stored = await prisma.payment.findUnique({ where: { transactionReference: payment.transactionReference } });
    expect(stored).toMatchObject({ orderId: order.id, status: 'PENDING', amountMinor: 10000, verifiedAt: null });
  });

  it('returns the same pending payment when initialization is repeated', async () => {
    const order = await createOrder();
    const first = await initialize(order.id).expect(201);
    const second = await initialize(order.id).expect(201);

    expect(second.body.data.payment.transactionReference).toBe(first.body.data.payment.transactionReference);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('creates only one pending payment under concurrent initialization', async () => {
    const order = await createOrder();
    const responses = await Promise.all(Array.from({ length: 8 }, () => initialize(order.id)));

    const references = new Set(responses.map((response) => response.body.data.payment.transactionReference));
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(references.size).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('generates unique references across different orders', async () => {
    const orders = await Promise.all(Array.from({ length: 5 }, createOrder));
    const responses = await Promise.all(orders.map((order) => initialize(order.id)));
    const references = new Set(responses.map((response) => response.body.data.payment.transactionReference));
    expect(references.size).toBe(5);
  });

  it('rejects initialization for a paid order', async () => {
    const order = await createOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
    const response = await initialize(order.id).expect(409);
    expect(response.body.error.code).toBe('ORDER_ALREADY_PAID');
  });

  it('rejects initialization for a cancelled order', async () => {
    const order = await createOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    const response = await initialize(order.id).expect(409);
    expect(response.body.error.code).toBe('ORDER_NOT_PAYABLE');
  });

  it('returns 404 for an unknown order', async () => {
    const response = await initialize('6f1c1f5e-4a9a-4a51-9b39-3f0e6c6d1a10').expect(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('rejects a malformed order id', async () => {
    await initialize('not-a-uuid').expect(400);
  });

  it('ignores any amount supplied by the client', async () => {
    const order = await createOrder();
    await request(app).post('/api/payments/initialize').send({ orderId: order.id, amount: 1 }).expect(400);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('requeries a stale pending attempt and starts a new one once it is confirmed failed', async () => {
    const order = await createOrder();
    const first = await initialize(order.id).expect(201);
    const firstReference = first.body.data.payment.transactionReference;
    await ageAllPayments(31);
    const fetchSpy = mockGateway(declinedRequery({ reference: firstReference, amount: 10000 }));

    const second = await initialize(order.id).expect(201);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second.body.data.payment.transactionReference).not.toBe(firstReference);
    const old = await prisma.payment.findUnique({ where: { transactionReference: firstReference } });
    expect(old.status).toBe('FAILED');
  });

  it('expires a stale attempt the gateway never saw and starts a new one', async () => {
    const order = await createOrder();
    await initialize(order.id).expect(201);
    await ageAllPayments(31);
    mockGateway(notFoundRequery);

    await initialize(order.id).expect(201);

    expect(await prisma.payment.count({ where: { status: 'FAILED' } })).toBe(1);
    expect(await prisma.payment.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('refuses to start a new attempt while a stale attempt cannot be resolved', async () => {
    const order = await createOrder();
    await initialize(order.id).expect(201);
    await ageAllPayments(31);
    mockGateway(async () => {
      throw new TypeError('fetch failed');
    });

    const response = await initialize(order.id).expect(409);

    expect(response.body.error.code).toBe('PAYMENT_UNRESOLVED');
    expect(await prisma.payment.count()).toBe(1);
  });
});
