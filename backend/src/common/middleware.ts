import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ZodSchema } from 'zod';
import { ValidationError } from './errors';

// Attach unique request ID to every request
export function requestId() {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).id = uuidv4();
    next();
  };
}

// Zod schema validation factory
export function validate(
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return next(new ValidationError('Validation failed', details));
    }
    req[source] = result.data;
    next();
  };
}

// Response time header
export function responseTime() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    // `finish` fires after headers are sent, so we cannot safely call `setHeader`.
    // The platform already exposes latency via Prometheus metrics, so we just
    // compute the value for potential logging/debugging.
    res.on('finish', () => {
      const duration = Number(process.hrtime.bigint() - start) / 1_000_000;
      res.locals.responseTimeMs = duration;
    });
    next();
  };
}

// Sanitize response - remove internal fields
export function sanitizeResponse() {
  return (_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (body && typeof body === 'object') {
        // Remove sensitive fields from responses
        const sanitize = (obj: any): any => {
          if (Array.isArray(obj)) return obj.map(sanitize);
          // `Date` objects lose their serialization when we spread/copy them.
          // Preserve them as ISO strings so the frontend can parse timestamps.
          if (obj instanceof Date) return obj.toISOString();
          if (obj && typeof obj === 'object') {
            const clean = { ...obj };
            delete clean.password_hash;
            delete clean.email_verification_token;
            for (const key of Object.keys(clean)) {
              clean[key] = sanitize(clean[key]);
            }
            return clean;
          }
          return obj;
        };
        body = sanitize(body);
      }
      return originalJson(body);
    };
    next();
  };
}
