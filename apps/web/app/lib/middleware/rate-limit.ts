import { NextRequest, NextResponse } from 'next/server';

/**
 * Simple in-memory rate limiter
 *
 * IMPORTANT: This is a basic implementation for single-server deployments.
 * For production multi-server deployments, use Redis-based rate limiting (Upstash).
 *
 * TODO: Upgrade to @upstash/ratelimit for production
 * See: https://github.com/upstash/ratelimit
 *
 * Usage:
 * ```typescript
 * import { createRateLimiter } from '@/lib/middleware/rate-limit';
 *
 * const limiter = createRateLimiter({
 *   interval: 15 * 60 * 1000, // 15 minutes
 *   uniqueTokenPerInterval: 500,
 *   maxRequests: 5,
 * });
 *
 * export async function POST(request: NextRequest) {
 *   const identifier = request.ip || 'anonymous';
 *   const result = await limiter.check(identifier);
 *
 *   if (!result.success) {
 *     return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
 *   }
 *   // ... handle request
 * }
 * ```
 */

interface RateLimiterConfig {
  interval: number; // Time window in milliseconds
  uniqueTokenPerInterval: number; // Max unique tokens to track
  maxRequests: number; // Max requests per interval
}

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Timestamp when limit resets
}

class InMemoryRateLimiter {
  private config: RateLimiterConfig;
  private requests: Map<string, { count: number; resetTime: number }>;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.requests = new Map();

    // Cleanup old entries periodically
    setInterval(() => this.cleanup(), this.config.interval);
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry || now >= entry.resetTime) {
      // New window or expired window
      const resetTime = now + this.config.interval;
      this.requests.set(identifier, { count: 1, resetTime });

      return {
        success: true,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests - 1,
        reset: resetTime,
      };
    }

    // Within existing window
    if (entry.count >= this.config.maxRequests) {
      // Rate limit exceeded
      return {
        success: false,
        limit: this.config.maxRequests,
        remaining: 0,
        reset: entry.resetTime,
      };
    }

    // Increment count
    entry.count++;
    this.requests.set(identifier, entry);

    return {
      success: true,
      limit: this.config.maxRequests,
      remaining: this.config.maxRequests - entry.count,
      reset: entry.resetTime,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now >= entry.resetTime) {
        this.requests.delete(key);
      }
    }

    // Limit map size to prevent memory issues
    if (this.requests.size > this.config.uniqueTokenPerInterval) {
      const keysToDelete = Array.from(this.requests.keys()).slice(
        0,
        this.requests.size - this.config.uniqueTokenPerInterval
      );
      keysToDelete.forEach((key) => this.requests.delete(key));
    }
  }
}

/**
 * Create a rate limiter instance
 */
export function createRateLimiter(config: RateLimiterConfig): InMemoryRateLimiter {
  return new InMemoryRateLimiter(config);
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const authRateLimiter = createRateLimiter({
  interval: 15 * 60 * 1000, // 15 minutes
  uniqueTokenPerInterval: 500,
  maxRequests: 5, // 5 login attempts per 15 min per IP
});

export const registerRateLimiter = createRateLimiter({
  interval: 24 * 60 * 60 * 1000, // 24 hours
  uniqueTokenPerInterval: 500,
  maxRequests: 3, // 3 registrations per day per IP
});

export const circleCreationRateLimiter = createRateLimiter({
  interval: 24 * 60 * 60 * 1000, // 24 hours
  uniqueTokenPerInterval: 1000,
  maxRequests: 5, // 5 circles per day per user
});

/**
 * Get identifier from request (IP address or user ID)
 */
export function getIdentifier(request: NextRequest, userId?: string): string {
  if (userId) return `user:${userId}`;

  // Try to get IP from headers
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  return 'anonymous';
}

/**
 * Apply rate limiting to a request
 * Returns error response if rate limit exceeded
 */
export async function applyRateLimit(
  request: NextRequest,
  limiter: InMemoryRateLimiter,
  identifier: string
): Promise<NextResponse | null> {
  const result = await limiter.check(identifier);

  if (!result.success) {
    const resetDate = new Date(result.reset).toISOString();

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          details: {
            limit: result.limit,
            remaining: result.remaining,
            reset: resetDate,
          },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': result.reset.toString(),
          'Retry-After': Math.ceil((result.reset - Date.now()) / 1000).toString(),
        },
      }
    );
  }

  return null; // No rate limit exceeded, continue
}
