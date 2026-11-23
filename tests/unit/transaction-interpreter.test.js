import { describe, expect, it } from 'vitest';
import { interpretRequeryResponse } from '../../src/integrations/interswitch/transaction-interpreter.js';
import { approvedRequery, declinedRequery, notFoundRequery } from '../helpers/gateway.js';

const reference = 'UNI-TEST-0000000000000001';
const initiatedAt = new Date('2026-01-01T10:00:00Z');
const expected = { transactionReference: reference, amountMinor: 10000, initiatedAt, pendingWindowMinutes: 30 };
const withinWindow = new Date('2026-01-01T10:05:00Z');
const afterWindow = new Date('2026-01-01T10:31:00Z');

describe('interpretRequeryResponse', () => {
  it('treats ResponseCode 00 with matching amount and reference as successful', () => {
    const outcome = interpretRequeryResponse(approvedRequery({ reference, amount: 10000 }), expected, withinWindow);
    expect(outcome).toMatchObject({
      status: 'SUCCESSFUL',
      reason: 'APPROVED',
      responseCode: '00',
      paymentReference: 'UBA|API|MX6072|25-07-2024|249510|719456',
    });
  });

  it('accepts a numeric string amount when it matches exactly', () => {
    const outcome = interpretRequeryResponse(approvedRequery({ reference, amount: '10000' }), expected, withinWindow);
    expect(outcome.status).toBe('SUCCESSFUL');
  });

  it('accepts an approved response that omits MerchantReference', () => {
    const response = approvedRequery({ reference, amount: 10000, MerchantReference: undefined });
    expect(interpretRequeryResponse(response, expected, withinWindow).status).toBe('SUCCESSFUL');
  });

  it('fails an approved response whose amount differs from the stored amount', () => {
    const outcome = interpretRequeryResponse(approvedRequery({ reference, amount: 100 }), expected, withinWindow);
    expect(outcome).toMatchObject({ status: 'FAILED', reason: 'AMOUNT_MISMATCH', gatewayAmountMinor: 100 });
  });

  it('fails an approved response with a fractional amount', () => {
    const outcome = interpretRequeryResponse(approvedRequery({ reference, amount: 10000.5 }), expected, withinWindow);
    expect(outcome.reason).toBe('AMOUNT_MISMATCH');
  });

  it('keeps the payment pending when the gateway returns a different reference', () => {
    const response = approvedRequery({ reference: 'SOMEONE-ELSE', amount: 10000 });
    expect(interpretRequeryResponse(response, expected, withinWindow)).toMatchObject({
      status: 'PENDING',
      reason: 'REFERENCE_MISMATCH',
    });
  });

  it('marks a declined response as failed', () => {
    const outcome = interpretRequeryResponse(declinedRequery({ reference, amount: 10000 }), expected, withinWindow);
    expect(outcome).toMatchObject({ status: 'FAILED', reason: 'DECLINED', responseCode: '51' });
  });

  it.each(['09', 'S0'])('keeps in-progress code %s pending even after the window', (code) => {
    const response = approvedRequery({ reference, amount: 10000, ResponseCode: code });
    expect(interpretRequeryResponse(response, expected, afterWindow).status).toBe('PENDING');
  });

  it('keeps a not-found transaction pending inside the window', () => {
    expect(interpretRequeryResponse(notFoundRequery, expected, withinWindow)).toMatchObject({
      status: 'PENDING',
      reason: 'NOT_COMPLETED',
    });
  });

  it('fails a not-found transaction once the window has passed', () => {
    expect(interpretRequeryResponse(notFoundRequery, expected, afterWindow)).toMatchObject({
      status: 'FAILED',
      reason: 'EXPIRED_NOT_COMPLETED',
    });
  });

  it.each([{}, null, { ResponseCode: '' }, { ResponseCode: 0 }])(
    'treats a response without a usable code as inconclusive: %j',
    (response) => {
      expect(interpretRequeryResponse(response, expected, withinWindow)).toMatchObject({
        status: 'PENDING',
        reason: 'MISSING_RESPONSE_CODE',
      });
    },
  );
});
