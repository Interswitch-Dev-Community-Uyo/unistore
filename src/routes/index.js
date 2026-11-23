import { Router } from 'express';
import { getHealth } from '../controllers/health.controller.js';
import { orderRoutes } from './order.routes.js';
import { paymentRoutes } from './payment.routes.js';

export const apiRoutes = Router();

apiRoutes.get('/health', getHealth);
apiRoutes.use(orderRoutes);
apiRoutes.use('/payments', paymentRoutes);
