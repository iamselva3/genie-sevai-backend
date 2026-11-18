import rateLimit from 'express-rate-limit';
import { config } from '../config';

const message = (text: string) => ({ error: { message: text, code: 'RATE_LIMITED' } });

export const signInLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.rateLimit.signInPerWindow,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many sign-in attempts. Try again in a few minutes.'),
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.rateLimit.loginPerWindow,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many sign-in attempts. Try again in a few minutes.'),
});
