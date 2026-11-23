import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller.js';
import { validate } from '../middleware/validate.js';
import {
  initializePaymentSchema,
  paymentReferenceParamsSchema,
  verifyPaymentSchema,
} from '../validators/payment.schemas.js';

export const paymentRoutes = Router();

paymentRoutes.post('/initialize', validate(initializePaymentSchema), paymentController.initializePayment);
paymentRoutes.post('/verify', validate(verifyPaymentSchema), paymentController.verifyPayment);
paymentRoutes.get('/:reference', validate(paymentReferenceParamsSchema, 'params'), paymentController.getPayment);
