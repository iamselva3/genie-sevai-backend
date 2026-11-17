import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { AppError } from './errors';

/** Parses input with a zod schema, throwing a 400 with a readable message on failure. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.');
    const message = first ? (field ? `${field}: ${first.message}` : first.message) : 'Invalid input';
    throw new AppError(400, message, 'VALIDATION', result.error.flatten());
  }
  return result.data;
}

export const objectId = z.string().refine((v) => isValidObjectId(v), { message: 'Invalid id' });
export const phone = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes');

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function assertId(id: string, what = 'Resource') {
  if (!isValidObjectId(id)) throw new AppError(404, `${what} not found`, 'NOT_FOUND');
}

export function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
