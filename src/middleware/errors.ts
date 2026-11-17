import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { AppError } from '../utils/errors';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { message: 'Route not found', code: 'NOT_FOUND' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
    return;
  }
  const e = err as { type?: string; code?: number; name?: string; message?: string; keyValue?: Record<string, unknown>; status?: number };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'Invalid JSON body', code: 'BAD_JSON' } });
    return;
  }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { message: 'Request is too large', code: 'TOO_LARGE' } });
    return;
  }
  if (e?.code === 11000) {
    const field = Object.keys(e.keyValue || {})[0] || 'value';
    res.status(409).json({ error: { message: `That ${field} is already in use`, code: 'DUPLICATE', details: { field } } });
    return;
  }
  if (e?.name === 'CastError') {
    res.status(400).json({ error: { message: 'Invalid id', code: 'BAD_ID' } });
    return;
  }
  if (e?.name === 'ValidationError') {
    res.status(400).json({ error: { message: e.message || 'Invalid data', code: 'VALIDATION' } });
    return;
  }
  if (!config.isTest) console.error(err);
  res.status(500).json({ error: { message: 'Something went wrong. Please try again.', code: 'INTERNAL' } });
}
