import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma, resetDatabase } from '../helpers/database.js';
import {
  approvedRequery,
  declinedRequery,
  hangingRequest,
  jsonResponse,
  mockGateway,
  notFoundRequery,
} from '../helpers/gateway.js';

const app = createApp();

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function createPendingPayment() {
  const order = await request(app)
    .post('/api/orders')
    .send({ customerEmail: 'ada@uniuyo.edu.ng', productId: 'unistore-hoodie' })
    .expect(201);
  const initialized = await request(app)
    .post('/api/payments/initialize')
    .send({ orderId: order.body.data.id })
    .expect(201);
  return { orderId: order.body.data.id, reference: initialized.body.data.payment.transactionReference };
}

function verify(reference) {
  return request(app).post('/api/payments/verify').send({ transactionReference: reference });
}

async function loadState(reference) {
  const payment = await prisma.payment.findUnique({ where: { transactionReference: reference }, include: { order: true } });
  return { payment, order: payment.order };
}

describe('POST /api/payments/verify', () => {
  it('marks the payment SUCCESSFUL and the order PAID after a matching approved requery', async () => {
    const { reference } = await createPendingPayment();
    const fetchSpy = mockGateway(approvedRequery({ reference, amount: 10000 }));

    const response = await verify(reference).expect(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.body.data).toMatchObject({
      transactionReference: reference,
      status: 'SUCCESSFUL',
      isFinal: true,
      gatewayResponseCode: '00',
      order: { status: 'PAID' },
      verification: { reason: 'APPROVED' },
    });
    const { payment, order } = await loadState(reference);
    expect(payment.status).toBe('SUCCESSFUL');
    expect(payment.verifiedAt).toBeInstanceOf(Date);
    expect(payment.gatewayPaymentReference).toBe('UBA|API|MX6072|25-07-2024|249510|719456');
    expect(order.status).toBe('PAID');
  });

  it('marks a declined payment FAILED and leaves the order unpaid', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(declinedRequery({ reference, amount: 10000 }));

    const response = await verify(reference).expect(200);

    expect(response.body.data).toMatchObject({ status: 'FAILED', verification: { reason: 'DECLINED' } });
    const { payment, order } = await loadState(reference);
    expect(payment).toMatchObject({ status: 'FAILED', gatewayResponseCode: '51' });
    expect(order.status).toBe('PENDING');
  });

  it('never pays an order when the approved amount differs from the stored amount', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(approvedRequery({ reference, amount: 100 }));

    const response = await verify(reference).expect(200);

    expect(response.body.data).toMatchObject({ status: 'FAILED', verification: { reason: 'AMOUNT_MISMATCH' } });
    const { order } = await loadState(reference);
    expect(order.status).toBe('PENDING');
  });

  it('keeps the payment pending when the gateway describes another transaction', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(approvedRequery({ reference: 'UNI-OTHER-REFERENCE', amount: 10000 }));

    const response = await verify(reference).expect(200);

    expect(response.body.data).toMatchObject({ status: 'PENDING', verification: { reason: 'REFERENCE_MISMATCH' } });
    expect((await loadState(reference)).order.status).toBe('PENDING');
  });

  it('returns 404 for an unknown transaction reference without calling the gateway', async () => {
    const fetchSpy = mockGateway();
    const response = await verify('UNI-DOES-NOT-EXIST').expect(404);
    expect(response.body.error.code).toBe('PAYMENT_NOT_FOUND');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the payment pending when the gateway times out', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(hangingRequest);

    const response = await verify(reference).expect(200);

    expect(response.body.data).toMatchObject({
      status: 'PENDING',
      isFinal: false,
      verification: { reason: 'GATEWAY_UNAVAILABLE' },
    });
    const { payment } = await loadState(reference);
    expect(payment).toMatchObject({ status: 'PENDING', verifiedAt: null, gatewayResponseCode: null });
  });

  it('keeps the payment pending when the gateway returns a server error', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(async () => jsonResponse({ message: 'down' }, 503));

    const response = await verify(reference).expect(200);
    expect(response.body.data.status).toBe('PENDING');
  });

  it('keeps a not-yet-completed transaction pending so it can be requeried', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(notFoundRequery, approvedRequery({ reference, amount: 10000 }));

    const first = await verify(reference).expect(200);
    expect(first.body.data).toMatchObject({ status: 'PENDING', gatewayResponseCode: 'Z25' });

    const second = await verify(reference).expect(200);
    expect(second.body.data).toMatchObject({ status: 'SUCCESSFUL', order: { status: 'PAID' } });
  });

  it('is idempotent: repeated verification returns the stored result without requerying', async () => {
    const { reference } = await createPendingPayment();
    const fetchSpy = mockGateway(approvedRequery({ reference, amount: 10000 }));

    await verify(reference).expect(200);
    const repeat = await verify(reference).expect(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(repeat.body.data).toMatchObject({ status: 'SUCCESSFUL', verification: { reason: 'ALREADY_FINAL' } });
  });

  it('does not let a later declined response overwrite a successful payment', async () => {
    const { reference } = await createPendingPayment();
    const fetchSpy = mockGateway(
      approvedRequery({ reference, amount: 10000 }),
      declinedRequery({ reference, amount: 10000 }),
    );

    await verify(reference).expect(200);
    const late = await verify(reference).expect(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(late.body.data.status).toBe('SUCCESSFUL');
    expect((await loadState(reference)).order.status).toBe('PAID');
  });

  it('resolves concurrent verifications safely when a slow failure arrives after a success', async () => {
    const { reference } = await createPendingPayment();
    const slowDecline = () =>
      new Promise((resolve) => setTimeout(() => resolve(jsonResponse(declinedRequery({ reference, amount: 10000 }))), 120));
    const fastApproval = async () => jsonResponse(approvedRequery({ reference, amount: 10000 }));
    mockGateway(slowDecline, fastApproval);

    const responses = await Promise.all([verify(reference), verify(reference)]);

    expect(responses.map((response) => response.body.data.status)).toEqual(['SUCCESSFUL', 'SUCCESSFUL']);
    expect(responses.map((response) => response.body.data.verification.reason).sort()).toEqual([
      'ALREADY_FINAL',
      'APPROVED',
    ]);
    const { payment, order } = await loadState(reference);
    expect(payment).toMatchObject({ status: 'SUCCESSFUL', gatewayResponseCode: '00' });
    expect(order.status).toBe('PAID');
  });

  it('keeps a declined payment failed when a repeated requery is still declined', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(declinedRequery({ reference, amount: 10000 }), declinedRequery({ reference, amount: 10000 }));

    await verify(reference).expect(200);
    const repeat = await verify(reference).expect(200);

    expect(repeat.body.data).toMatchObject({ status: 'FAILED', verification: { reason: 'ALREADY_FINAL' } });
  });

  it('upgrades a recently declined payment when the customer retries the same reference and it is approved', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(declinedRequery({ reference, amount: 10000 }), approvedRequery({ reference, amount: 10000 }));

    await verify(reference).expect(200);
    const retried = await verify(reference).expect(200);

    expect(retried.body.data).toMatchObject({
      status: 'SUCCESSFUL',
      order: { status: 'PAID' },
      verification: { reason: 'APPROVED' },
    });
  });

  it('never upgrades a declined payment on an amount mismatch', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(declinedRequery({ reference, amount: 10000 }), approvedRequery({ reference, amount: 100 }));

    await verify(reference).expect(200);
    const repeat = await verify(reference).expect(200);

    expect(repeat.body.data.status).toBe('FAILED');
    expect((await loadState(reference)).order.status).toBe('PENDING');
  });

  it('treats a failed payment as final once the pending window has passed', async () => {
    const { reference } = await createPendingPayment();
    mockGateway(declinedRequery({ reference, amount: 10000 }));
    await verify(reference).expect(200);
    await prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    const fetchSpy = mockGateway(approvedRequery({ reference, amount: 10000 }));

    const repeat = await verify(reference).expect(200);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(repeat.body.data).toMatchObject({ status: 'FAILED', verification: { reason: 'ALREADY_FINAL' } });
  });

  it('rejects a request without a transaction reference', async () => {
    await request(app).post('/api/payments/verify').send({}).expect(400);
  });
});

describe('GET /api/payments/:reference', () => {
  it('returns the persisted payment status with masked order details', async () => {
    const { reference, orderId } = await createPendingPayment();
    const response = await request(app).get(`/api/payments/${reference}`).expect(200);

    expect(response.body.data).toMatchObject({
      transactionReference: reference,
      status: 'PENDING',
      amountMinor: 10000,
      order: { id: orderId, status: 'PENDING', customerEmail: 'a***@uniuyo.edu.ng' },
    });
  });

  it('does not contact the gateway', async () => {
    const { reference } = await createPendingPayment();
    const fetchSpy = mockGateway();
    await request(app).get(`/api/payments/${reference}`).expect(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown reference', async () => {
    await request(app).get('/api/payments/UNI-NOPE').expect(404);
  });
});
