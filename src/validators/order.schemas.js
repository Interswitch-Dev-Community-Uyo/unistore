import { z } from 'zod';

export const createOrderSchema = z
  .object({
    customerEmail: z.string().trim().toLowerCase().email().max(254),
    productId: z.string().trim().min(1).max(64),
  })
  .strict();

export const orderIdParamsSchema = z.object({
  orderId: z.string().uuid(),
});
