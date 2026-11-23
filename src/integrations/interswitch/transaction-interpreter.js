export const APPROVED_CODE = '00';
export const IN_PROGRESS_CODES = new Set(['09', 'S0']);
export const NOT_COMPLETED_CODES = new Set(['Z0', 'Z25']);

function readText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readAmount(value) {
  const amount = typeof value === 'string' ? Number(value) : value;
  return Number.isSafeInteger(amount) ? amount : null;
}

function hasExpired(initiatedAt, pendingWindowMinutes, now) {
  return now.getTime() - new Date(initiatedAt).getTime() > pendingWindowMinutes * 60_000;
}

function interpretApproved(response, expected, gateway) {
  const amount = readAmount(response.Amount);
  if (amount !== expected.amountMinor) {
    return { ...gateway, status: 'FAILED', reason: 'AMOUNT_MISMATCH', gatewayAmountMinor: amount };
  }

  const merchantReference = readText(response.MerchantReference);
  if (merchantReference !== null && merchantReference !== expected.transactionReference) {
    return { ...gateway, status: 'PENDING', reason: 'REFERENCE_MISMATCH' };
  }

  return { ...gateway, status: 'SUCCESSFUL', reason: 'APPROVED' };
}

export function interpretRequeryResponse(response, expected, now = new Date()) {
  const gateway = {
    responseCode: readText(response?.ResponseCode),
    responseDescription: readText(response?.ResponseDescription),
    paymentReference: readText(response?.PaymentReference),
  };
  const code = gateway.responseCode;

  if (code === null) return { ...gateway, status: 'PENDING', reason: 'MISSING_RESPONSE_CODE' };
  if (code === APPROVED_CODE) return interpretApproved(response, expected, gateway);
  if (IN_PROGRESS_CODES.has(code)) return { ...gateway, status: 'PENDING', reason: 'IN_PROGRESS' };

  if (NOT_COMPLETED_CODES.has(code)) {
    return hasExpired(expected.initiatedAt, expected.pendingWindowMinutes, now)
      ? { ...gateway, status: 'FAILED', reason: 'EXPIRED_NOT_COMPLETED' }
      : { ...gateway, status: 'PENDING', reason: 'NOT_COMPLETED' };
  }

  return { ...gateway, status: 'FAILED', reason: 'DECLINED' };
}
