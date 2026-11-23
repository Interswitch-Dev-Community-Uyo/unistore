import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma, resetDatabase } from '../helpers/database.js';

const app = createApp();

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('GET /api/health', () => {
  it('reports the application and database as healthy', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });
});

describe('GET /api/products', () => {
  it('lists the server-owned catalogue', async () => {
    const response = await request(app).get('/api/products').expect(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ id: 'unistore-hoodie', priceMinor: 10000, currency: '566' }),
    ]);
  });
});

describe('POST /api/orders', () => {
  it('creates a pending order priced by the server', async () => {
    const response = await request(app)
      .post('/api/orders')
      .send({ customerEmail: 'Ada@UniUyo.edu.ng', productId: 'unistore-hoodie' })
      .expect(201);

    expect(response.body.data).toMatchObject({
      customerEmail: 'ada@uniuyo.edu.ng',
      productId: 'unistore-hoodie',
      amountMinor: 10000,
      currency: '566',
      status: 'PENDING',
    });

    const stored = await prisma.order.findUnique({ where: { id: response.body.data.id } });
    expect(stored.amountMinor).toBe(10000);
  });

  it('rejects an attempt to set the price from the client', async () => {
    const response = await request(app)
      .post('/api/orders')
      .send({ customerEmail: 'ada@uniuyo.edu.ng', productId: 'unistore-hoodie', amountMinor: 1 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.order.count()).toBe(0);
  });

  it('rejects an invalid email', async () => {
    const response = await request(app)
      .post('/api/orders')
      .send({ customerEmail: 'not-an-email', productId: 'unistore-hoodie' })
      .expect(400);
    expect(response.body.error.details[0].field).toBe('customerEmail');
  });

  it('rejects an unknown product', async () => {
    const response = await request(app)
      .post('/api/orders')
      .send({ customerEmail: 'ada@uniuyo.edu.ng', productId: 'free-laptop' })
      .expect(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects malformed JSON', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Content-Type', 'application/json')
      .send('{"customerEmail":')
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });
});

describe('GET /api/orders/:orderId', () => {
  it('returns an existing order', async () => {
    const created = await request(app)
      .post('/api/orders')
      .send({ customerEmail: 'ada@uniuyo.edu.ng', productId: 'unistore-hoodie' });
    const response = await request(app).get(`/api/orders/${created.body.data.id}`).expect(200);
    expect(response.body.data.id).toBe(created.body.data.id);
  });

  it('returns 404 for a missing order', async () => {
    await request(app).get('/api/orders/6f1c1f5e-4a9a-4a51-9b39-3f0e6c6d1a10').expect(404);
  });
});
