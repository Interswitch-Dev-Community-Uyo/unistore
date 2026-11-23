import { logger } from '../utils/logger.js';

export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
}

export function requestLogger(req, res, next) {
  const path = req.originalUrl.split('?')[0];
  if (!path.startsWith('/api')) return next();
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('http.request', {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });
  return next();
}
