import { describe, expect, it } from 'vitest';
import { generateTransactionReference, TRANSACTION_REFERENCE_PATTERN } from '../../src/utils/transaction-reference.js';

describe('generateTransactionReference', () => {
  it('produces references in the UniStore format', () => {
    expect(generateTransactionReference()).toMatch(TRANSACTION_REFERENCE_PATTERN);
  });

  it('fits within the persisted column length', () => {
    expect(generateTransactionReference().length).toBeLessThanOrEqual(64);
  });

  it('never repeats across many generations', () => {
    const references = new Set(Array.from({ length: 20000 }, generateTransactionReference));
    expect(references.size).toBe(20000);
  });
});
