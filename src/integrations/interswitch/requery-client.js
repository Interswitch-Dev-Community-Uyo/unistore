import { config } from '../../config/env.js';
import { GatewayUnavailableError } from './errors.js';

export function buildRequeryUrl({ transactionReference, amountMinor }) {
  const url = new URL(config.interswitch.requeryUrl);
  url.searchParams.set('merchantcode', config.interswitch.merchantCode);
  url.searchParams.set('transactionreference', transactionReference);
  url.searchParams.set('amount', String(amountMinor));
  return url;
}

async function sendRequest(url) {
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(config.interswitch.timeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new GatewayUnavailableError('TIMEOUT', 'InterSwitch requery timed out', { cause: error });
    }
    throw new GatewayUnavailableError('NETWORK', 'InterSwitch requery could not be sent', { cause: error });
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new GatewayUnavailableError('INVALID_RESPONSE', 'InterSwitch returned a non-JSON body', { cause: error });
  }
}

export async function requeryTransaction({ transactionReference, amountMinor }) {
  const url = buildRequeryUrl({ transactionReference, amountMinor });
  const response = await sendRequest(url);

  if (!response.ok) {
    throw new GatewayUnavailableError('HTTP_STATUS', `InterSwitch requery returned HTTP ${response.status}`);
  }

  const body = await readJson(response);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new GatewayUnavailableError('INVALID_RESPONSE', 'InterSwitch returned an unexpected body');
  }
  return body;
}
