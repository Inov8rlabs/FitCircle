/**
 * Food Log Error Classes
 * Custom error types for food log operations
 */

export class FoodLogError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'FoodLogError';
  }
}

export class FeatureFlagError extends FoodLogError {
  constructor(message: string = 'Feature not available') {
    super(message, 'FEATURE_DISABLED', 403);
  }
}

export class PermissionError extends FoodLogError {
  constructor(message: string = 'Not authorized') {
    super(message, 'PERMISSION_DENIED', 403);
  }
}

export class ValidationError extends FoodLogError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class NotFoundError extends FoodLogError {
  constructor(message: string = 'Resource not found') {
    super(message, 'NOT_FOUND', 404);
  }
}

export class RateLimitError extends FoodLogError {
  constructor(message: string = 'Rate limit exceeded', public retryAfter: number) {
    super(message, 'RATE_LIMIT', 429);
  }
}

export class ImageProcessingError extends FoodLogError {
  constructor(message: string = 'Failed to process image') {
    super(message, 'IMAGE_PROCESSING_ERROR', 500);
  }
}

export class StorageError extends FoodLogError {
  constructor(message: string = 'Storage operation failed') {
    super(message, 'STORAGE_ERROR', 500);
  }
}
