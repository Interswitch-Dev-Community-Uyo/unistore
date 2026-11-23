import express from 'express';
import { fileURLToPath } from 'node:url';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestLogger, securityHeaders } from './middleware/request-context.js';
import { apiRoutes } from './routes/index.js';

const publicDirectory = fileURLToPath(new URL('../public', import.meta.url));

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(requestLogger);
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(publicDirectory));
  app.use('/api', apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
