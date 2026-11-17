export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(400, message, code, details);
export const unauthorized = (message = 'Please sign in to continue') => new AppError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'You do not have access to this') => new AppError(403, message, 'FORBIDDEN');
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, message, code);
