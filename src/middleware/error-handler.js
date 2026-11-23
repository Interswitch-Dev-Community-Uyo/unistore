import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

function toAppError(error) {
  if (error instanceof AppError) return error;
  if (error?.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (error?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  return null;
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const appError = toAppError(error);
  if (appError) {
    return res.status(appError.statusCode).json({
      error: { code: appError.code, message: appError.message, details: appError.details },
    });
  }

  logger.error('request.unhandled_error', {
    method: req.method,
    path: req.path,
    errorName: error?.name,
    errorMessage: error?.message,
  });
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
}
