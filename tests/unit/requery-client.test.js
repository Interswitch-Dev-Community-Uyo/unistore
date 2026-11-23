import { describe, expect, it } from 'vitest';
import { GatewayUnavailableError } from '../../src/integrations/interswitch/errors.js';
import { requeryTransaction } from '../../src/integrations/interswitch/requery-client.js';
import { approvedRequery, hangingRequest, jsonResponse, mockGateway } from '../helpers/gateway.js';

const params = { transactionReference: 'UNI-ABC-0123456789ABCDEF', amountMinor: 10000 };

describe('requeryTransaction', () => {
  it('sends the documented GET request with merchantcode, transactionreference and amount', async () => {
    const fetchSpy = mockGateway(approvedRequery({ reference: params.transactionReference, amount: 10000 }));

    const body = await requeryTransaction(params);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url.origin + url.pathname).toBe('https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      merchantcode: 'MX6072',
      transactionreference: params.transactionReference,
      amount: '10000',
    });
    expect(options.method).toBe('GET');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(body.ResponseCode).toBe('00');
  });

  it('raises a TIMEOUT error when the gateway does not answer in time', async () => {
    mockGateway(hangingRequest);
    await expect(requeryTransaction(params)).rejects.toMatchObject({
      name: 'GatewayUnavailableError',
      reason: 'TIMEOUT',
    });
  });

  it('raises a NETWORK error when the request cannot be sent', async () => {
    mockGateway(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(requeryTransaction(params)).rejects.toMatchObject({ reason: 'NETWORK' });
  });

  it('raises an HTTP_STATUS error for non-2xx responses', async () => {
    mockGateway(async () => jsonResponse({ message: 'down' }, 502));
    await expect(requeryTransaction(params)).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it('raises an INVALID_RESPONSE error for non-JSON bodies', async () => {
    mockGateway(async () => new Response('<html>maintenance</html>', { status: 200 }));
    await expect(requeryTransaction(params)).rejects.toMatchObject({ reason: 'INVALID_RESPONSE' });
  });
});
