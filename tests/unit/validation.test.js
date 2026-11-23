import { describe, expect, it } from 'vitest';
import { createOrderSchema } from '../../src/validators/order.schemas.js';
import { initializePaymentSchema, verifyPaymentSchema } from '../../src/validators/payment.schemas.js';

describe('request schemas', () => {
  it('normalises the customer email', () => {
    const result = createOrderSchema.parse({ customerEmail: '  Ada@UniUyo.edu.ng ', productId: 'unistore-hoodie' });
    expect(result.customerEmail).toBe('ada@uniuyo.edu.ng');
  });

  it('rejects client-supplied amounts on order creation', () => {
    const result = createOrderSchema.safeParse({
      customerEmail: 'ada@uniuyo.edu.ng',
      productId: 'unistore-hoodie',
      amountMinor: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects client-supplied amounts on payment initialization', () => {
    const result = initializePaymentSchema.safeParse({
      orderId: '6f1c1f5e-4a9a-4a51-9b39-3f0e6c6d1a10',
      amount: 1,
    });
    expect(result.success).toBe(false);
  });

  it('requires a transaction reference for verification', () => {
    expect(verifyPaymentSchema.safeParse({}).success).toBe(false);
    expect(verifyPaymentSchema.safeParse({ transactionReference: '   ' }).success).toBe(false);
  });
});
