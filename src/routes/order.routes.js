import { Router } from 'express';
import * as orderController from '../controllers/order.controller.js';
import { validate } from '../middleware/validate.js';
import { createOrderSchema, orderIdParamsSchema } from '../validators/order.schemas.js';

export const orderRoutes = Router();

orderRoutes.get('/products', orderController.listProducts);
orderRoutes.post('/orders', validate(createOrderSchema), orderController.createOrder);
orderRoutes.get('/orders/:orderId', validate(orderIdParamsSchema, 'params'), orderController.getOrder);
