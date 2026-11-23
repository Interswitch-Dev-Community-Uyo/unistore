import { z } from 'zod';

const transactionReference = z.string().trim().min(1).max(64);

export const initializePaymentSchema = z
  .object({
    orderId: z.string().uuid(),
  })
  .strict();

export const verifyPaymentSchema = z
  .object({
    transactionReference,
  })
  .strict();

export const paymentReferenceParamsSchema = z.object({
  reference: transactionReference,
});
