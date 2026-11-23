import { randomBytes } from 'node:crypto';

export const TRANSACTION_REFERENCE_PATTERN = /^UNI-[0-9A-Z]+-[0-9A-F]{16}$/;

export function generateTransactionReference() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = randomBytes(8).toString('hex').toUpperCase();
  return `UNI-${timestamp}-${random}`;
}
