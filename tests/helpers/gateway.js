import { vi } from 'vitest';

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function approvedRequery({ reference, amount, ...overrides }) {
  return {
    Amount: amount,
    CardNumber: '',
    MerchantReference: reference,
    PaymentReference: 'UBA|API|MX6072|25-07-2024|249510|719456',
    RetrievalReferenceNumber: '000647661227',
    SplitAccounts: [],
    TransactionDate: '2024-07-25T06:57:24',
    ResponseCode: '00',
    ResponseDescription: 'Approved by Financial Institution',
    AccountNumber: '9999999999',
    ...overrides,
  };
}

export function declinedRequery({ reference, amount }) {
  return approvedRequery({
    reference,
    amount,
    ResponseCode: '51',
    ResponseDescription: 'Insufficient Funds',
  });
}

export const notFoundRequery = {
  ResponseCode: 'Z25',
  ResponseDescription: 'Transaction not Found',
  Amount: 0,
  SplitAccounts: [],
  TransactionDate: '0001-01-01T00:00:00',
  RemittanceAmount: 0,
  PaymentCancelled: false,
};

export function mockGateway(...responses) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    throw new Error(`Unexpected outbound request in test: ${url}`);
  });
  spy.mockClear();
  for (const response of responses) {
    spy.mockImplementationOnce(typeof response === 'function' ? response : async () => jsonResponse(response));
  }
  return spy;
}

export function hangingRequest(url, { signal }) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
}
