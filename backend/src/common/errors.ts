import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';
import { config } from '../config';

// ─────────────────────────────────────────────────────────────────
// DOMAIN ERRORS
// ─────────────────────────────────────────────────────────────────

export enum ErrorCode {
  // Generic
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',

  // Auth
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',

  // Market
  MARKET_NOT_FOUND = 'MARKET_NOT_FOUND',
  MARKET_INACTIVE = 'MARKET_INACTIVE',
  MARKET_CLOSED = 'MARKET_CLOSED',
  MARKET_ALREADY_RESOLVED = 'MARKET_ALREADY_RESOLVED',
  INVALID_MARKET_STATUS = 'INVALID_MARKET_STATUS',

  // Trading
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_SHARES = 'INSUFFICIENT_SHARES',
  INVALID_TRADE_AMOUNT = 'INVALID_TRADE_AMOUNT',
  INVALID_PRICE = 'INVALID_PRICE',
  PRICE_MOVED = 'PRICE_MOVED',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_ALREADY_CANCELLED = 'ORDER_ALREADY_CANCELLED',
  ORDER_ALREADY_FILLED = 'ORDER_ALREADY_FILLED',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  MIN_TRADE_AMOUNT = 'MIN_TRADE_AMOUNT',
  MAX_TRADE_AMOUNT = 'MAX_TRADE_AMOUNT',

  // Position
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(ErrorCode.VALIDATION_ERROR, message, 422, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(ErrorCode.NOT_FOUND, msg, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(ErrorCode.UNAUTHORIZED, message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(ErrorCode.FORBIDDEN, message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(ErrorCode.CONFLICT, message, 409);
    this.name = 'ConflictError';
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(available: number, required: number) {
    super(
      ErrorCode.INSUFFICIENT_BALANCE,
      `Insufficient balance: available ${available}, required ${required}`,
      400,
      { available, required }
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class SlippageExceededError extends AppError {
  constructor(expected: number, actual: number, maxSlippage: number) {
    super(
      ErrorCode.SLIPPAGE_EXCEEDED,
      `Price slippage exceeded: expected ${expected}, got ${actual}, max slippage ${maxSlippage}%`,
      400,
      { expected, actual, maxSlippage }
    );
    this.name = 'SlippageExceededError';
  }
}

// ─────────────────────────────────────────────────────────────────
// ERROR HANDLER MIDDLEWARE
// ─────────────────────────────────────────────────────────────────

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    requestId?: string;
  };
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const timestamp = new Date().toISOString();
  const requestId = (req as any).id;

  // Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    res.status(422).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details,
        timestamp,
        requestId,
      },
    } satisfies ErrorResponse);
    return;
  }

  // Known app errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('Application error', {
        code: err.code,
        message: err.message,
        stack: err.stack,
        requestId,
        url: req.url,
        method: req.method,
      });
    }

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        timestamp,
        requestId,
      },
    } satisfies ErrorResponse);
    return;
  }

  // PostgreSQL errors
  if ((err as any).code) {
    const pgCode = (err as any).code;

    if (pgCode === '23505') {
      res.status(409).json({
        success: false,
        error: {
          code: ErrorCode.CONFLICT,
          message: 'Resource already exists',
          timestamp,
          requestId,
        },
      });
      return;
    }

    if (pgCode === '23503') {
      res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Referenced resource does not exist',
          timestamp,
          requestId,
        },
      });
      return;
    }
  }

  // Unknown errors
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    requestId,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      timestamp,
      requestId,
    },
  } satisfies ErrorResponse);
}
