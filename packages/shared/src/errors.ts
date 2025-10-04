/**
 * Custom error classes for FitCircle
 */

import { ERROR_CODES } from './constants';

/**
 * Base error class for all FitCircle errors
 */
export class FitCircleError extends Error {
  public code: string;
  public statusCode: number;
  public details?: Record<string, any>;
  public timestamp: Date;

  constructor(
    message: string,
    code: string = ERROR_CODES.INTERNAL_ERROR,
    statusCode = 500,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends FitCircleError {
  constructor(message = 'Authentication failed', details?: Record<string, any>) {
    super(message, ERROR_CODES.UNAUTHORIZED, 401, details);
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends FitCircleError {
  constructor(message = 'Access denied', details?: Record<string, any>) {
    super(message, ERROR_CODES.FORBIDDEN, 403, details);
  }
}

/**
 * Validation error
 */
export class ValidationError extends FitCircleError {
  public errors: Record<string, string[]>;

  constructor(
    message = 'Validation failed',
    errors: Record<string, string[]> = {},
    details?: Record<string, any>
  ) {
    super(message, ERROR_CODES.VALIDATION_FAILED, 400, details);
    this.errors = errors;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      errors: this.errors,
    };
  }
}

/**
 * Not found error
 */
export class NotFoundError extends FitCircleError {
  constructor(resource = 'Resource', details?: Record<string, any>) {
    super(`${resource} not found`, ERROR_CODES.NOT_FOUND, 404, details);
  }
}

/**
 * Conflict error (resource already exists)
 */
export class ConflictError extends FitCircleError {
  constructor(message = 'Resource already exists', details?: Record<string, any>) {
    super(message, ERROR_CODES.ALREADY_EXISTS, 409, details);
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends FitCircleError {
  public retryAfter?: number;

  constructor(retryAfter?: number, details?: Record<string, any>) {
    const message = retryAfter
      ? `Rate limit exceeded. Try again in ${retryAfter} seconds`
      : 'Rate limit exceeded';
    super(message, ERROR_CODES.RATE_LIMIT_EXCEEDED, 429, details);
    this.retryAfter = retryAfter;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      retryAfter: this.retryAfter,
    };
  }
}

/**
 * Payment error
 */
export class PaymentError extends FitCircleError {
  constructor(message = 'Payment failed', details?: Record<string, any>) {
    super(message, ERROR_CODES.PAYMENT_FAILED, 402, details);
  }
}

/**
 * Subscription error
 */
export class SubscriptionError extends FitCircleError {
  constructor(message = 'Subscription required', details?: Record<string, any>) {
    super(message, ERROR_CODES.SUBSCRIPTION_REQUIRED, 402, details);
  }
}

/**
 * Database error
 */
export class DatabaseError extends FitCircleError {
  constructor(message = 'Database operation failed', details?: Record<string, any>) {
    super(message, ERROR_CODES.DATABASE_ERROR, 500, details);
  }
}

/**
 * External service error
 */
export class ExternalServiceError extends FitCircleError {
  public service: string;

  constructor(service: string, message?: string, details?: Record<string, any>) {
    super(
      message || `External service error: ${service}`,
      ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      503,
      details
    );
    this.service = service;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      service: this.service,
    };
  }
}

/**
 * Token error
 */
export class TokenError extends FitCircleError {
  constructor(message = 'Invalid or expired token', details?: Record<string, any>) {
    super(message, ERROR_CODES.TOKEN_INVALID, 401, details);
  }
}

/**
 * Feature not available error
 */
export class FeatureNotAvailableError extends FitCircleError {
  constructor(feature: string, tier?: string, details?: Record<string, any>) {
    const message = tier
      ? `${feature} is not available in ${tier} tier`
      : `${feature} is not available`;
    super(message, ERROR_CODES.FEATURE_NOT_AVAILABLE, 403, details);
  }
}

/**
 * Maintenance mode error
 */
export class MaintenanceModeError extends FitCircleError {
  public estimatedEndTime?: Date;

  constructor(estimatedEndTime?: Date, details?: Record<string, any>) {
    const message = estimatedEndTime
      ? `Service is under maintenance. Expected to be back at ${estimatedEndTime.toISOString()}`
      : 'Service is under maintenance';
    super(message, ERROR_CODES.MAINTENANCE_MODE, 503, details);
    this.estimatedEndTime = estimatedEndTime;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      estimatedEndTime: this.estimatedEndTime,
    };
  }
}

/**
 * Input validation error for specific fields
 */
export class InputValidationError extends ValidationError {
  constructor(field: string, message: string, details?: Record<string, any>) {
    super('Input validation failed', { [field]: [message] }, details);
  }
}

/**
 * Business logic error
 */
export class BusinessLogicError extends FitCircleError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, ERROR_CODES.VALIDATION_FAILED, 400, details);
  }
}

/**
 * Error handler utility
 */
export class ErrorHandler {
  /**
   * Determine if error is operational (expected) or programming error
   */
  static isOperationalError(error: Error): boolean {
    return error instanceof FitCircleError;
  }

  /**
   * Format error for API response
   */
  static formatErrorResponse(error: Error) {
    if (error instanceof FitCircleError) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          ...(error instanceof ValidationError && { errors: error.errors }),
          ...(error instanceof RateLimitError && { retryAfter: error.retryAfter }),
          timestamp: error.timestamp,
        },
      };
    }

    // Generic error response for non-operational errors
    return {
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : error.message,
        timestamp: new Date(),
      },
    };
  }

  /**
   * Log error based on severity
   */
  static logError(error: Error, context?: Record<string, any>): void {
    const isOperational = this.isOperationalError(error);
    const logData = {
      error: error instanceof FitCircleError ? error.toJSON() : {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      context,
      timestamp: new Date().toISOString(),
      isOperational,
    };

    if (!isOperational || (error instanceof FitCircleError && error.statusCode >= 500)) {
      console.error('ERROR:', JSON.stringify(logData, null, 2));
    } else {
      console.warn('WARNING:', JSON.stringify(logData, null, 2));
    }
  }

  /**
   * Handle async errors in Express routes
   */
  static asyncHandler(fn: Function) {
    return (req: any, res: any, next: any) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
}

/**
 * Type guards
 */
export const isAuthenticationError = (error: any): error is AuthenticationError => {
  return error instanceof AuthenticationError;
};

export const isAuthorizationError = (error: any): error is AuthorizationError => {
  return error instanceof AuthorizationError;
};

export const isValidationError = (error: any): error is ValidationError => {
  return error instanceof ValidationError;
};

export const isNotFoundError = (error: any): error is NotFoundError => {
  return error instanceof NotFoundError;
};

export const isRateLimitError = (error: any): error is RateLimitError => {
  return error instanceof RateLimitError;
};

export const isPaymentError = (error: any): error is PaymentError => {
  return error instanceof PaymentError;
};

export const isFitCircleError = (error: any): error is FitCircleError => {
  return error instanceof FitCircleError;
};