import type { ErrorCode } from '@pickle/shared';

export class AppError extends Error {
  constructor(public code: ErrorCode, public status: number, message: string, public details?: unknown, public extra?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
  }
}

export const E = {
  unauthenticated: () => new AppError('UNAUTHENTICATED', 401, 'Please sign in'),
  forbidden: (msg = "You don't have access to this") => new AppError('FORBIDDEN', 403, msg),
  notFound: (what = 'Not found', code: ErrorCode = 'NOT_FOUND') => new AppError(code, 404, what),
  validation: (msg: string, details?: unknown) => new AppError('VALIDATION_ERROR', 422, msg, details),
  conflict: (code: ErrorCode, msg: string, details?: unknown, extra?: Record<string, unknown>) => new AppError(code, 409, msg, details, extra),
};
