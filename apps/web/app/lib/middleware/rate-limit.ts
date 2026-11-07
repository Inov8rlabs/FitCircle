import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { type NextRequest, NextResponse } from 'next/server';

import { getClientIp } from '../http/client-ip';

/**
 * Rate limiter shared by every serverless instance.
 *
 * Backed by Upstash Redis (`@upstash/ratelimit`, sliding window) when
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (or the Vercel
 * Marketplace names KV_REST_API_URL + KV_REST_API_TOKEN). Without them it falls
 * back to a per-instance in-memory window and logs that once, so local
 * development and tests work with no setup.
 *
 * A Redis failure or timeout never blocks a request: that one check is answered
 * by the in-memory window instead.
 *
 * Usage:
 * ```typescript
 * const limiter = createRateLimiter({ name: 'login-ip', interval: 15 * 60_000, maxRequests: 10 });
 * const limited = await applyRateLimit(request, limiter, getIdentifier(request));
 * if (limited) return limited;
 * ```
 */

export interface RateLimiterConfig {
  /** Time window in milliseconds. */
  interval: number;
  /** Max requests per window. */
  maxRequests: number;
  /** In-memory fallback only: max tracked identifiers. */
  uniqueTokenPerInterval?: number;
  /**
   * Redis key namespace. Two limiters with the same name share counters, so
   * every call site should pass its own.
   */
  name?: string;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the window resets. */
  reset: number;
}

const REDIS_TIMEOUT_MS = 1500;
const KEY_PREFIX = 'fc:rl';

export interface RedisEnv {
  url: string;
  token: string;
}

/** Upstash REST credentials from the environment, or null when not configured. */
export function redisEnv(env: NodeJS.ProcessEnv = process.env): RedisEnv | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}

let redisClient: Redis | null | undefined;
let loggedFallback = false;

/** The shared Upstash client, or null when not configured (logged once). */
export function getSharedRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const env = redisEnv();
  if (!env) {
    if (!loggedFallback) {
      loggedFallback = true;
      console.warn('[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set: using the in-memory limiter (per instance)');
    }
    redisClient = null;
    return null;
  }
  redisClient = new Redis({ url: env.url, token: env.token, enableTelemetry: false });
  return redisClient;
}

/** Test hook: forget the cached client so env changes take effect. */
export function resetRateLimitBackend(): void {
  redisClient = undefined;
  loggedFallback = false;
}

class InMemoryWindow {
  private requests = new Map<string, { count: number; resetTime: number }>();
  private lastCleanup = Date.now();

  constructor(
    private readonly interval: number,
    private readonly maxRequests: number,
    private readonly maxTokens: number
  ) {}

  check(identifier: string, now = Date.now()): RateLimitResult {
    if (now - this.lastCleanup > this.interval) this.cleanup(now);
    const entry = this.requests.get(identifier);
    if (!entry || now >= entry.resetTime) {
      const resetTime = now + this.interval;
      this.requests.set(identifier, { count: 1, resetTime });
      return { success: true, limit: this.maxRequests, remaining: this.maxRequests - 1, reset: resetTime };
    }
    if (entry.count >= this.maxRequests) {
      return { success: false, limit: this.maxRequests, remaining: 0, reset: entry.resetTime };
    }
    entry.count++;
    return { success: true, limit: this.maxRequests, remaining: this.maxRequests - entry.count, reset: entry.resetTime };
  }

  private cleanup(now: number) {
    this.lastCleanup = now;
    for (const [key, entry] of this.requests.entries()) {
      if (now >= entry.resetTime) this.requests.delete(key);
    }
    if (this.requests.size > this.maxTokens) {
      const drop = Array.from(this.requests.keys()).slice(0, this.requests.size - this.maxTokens);
      drop.forEach((key) => this.requests.delete(key));
    }
  }
}

let loggedRedisError = 0;

export class SharedRateLimiter {
  readonly name: string;
  private readonly memory: InMemoryWindow;
  private upstash: Ratelimit | null | undefined;

  constructor(private readonly config: RateLimiterConfig) {
    this.name = config.name?.trim() || `default-${config.maxRequests}-${config.interval}`;
    this.memory = new InMemoryWindow(config.interval, config.maxRequests, config.uniqueTokenPerInterval ?? 5000);
  }

  /** Which store answers checks right now. */
  get backend(): 'redis' | 'memory' {
    return this.remote() ? 'redis' : 'memory';
  }

  private remote(): Ratelimit | null {
    if (this.upstash !== undefined) return this.upstash;
    const redis = getSharedRedis();
    this.upstash = redis
      ? new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(this.config.maxRequests, `${this.config.interval} ms`),
          prefix: `${KEY_PREFIX}:${this.name}`,
          analytics: false,
          timeout: REDIS_TIMEOUT_MS,
        })
      : null;
    return this.upstash;
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const remote = this.remote();
    if (remote) {
      try {
        const r = await remote.limit(identifier);
        return { success: r.success, limit: r.limit, remaining: Math.max(0, r.remaining), reset: r.reset };
      } catch (err: any) {
        const now = Date.now();
        if (now - loggedRedisError > 60_000) {
          loggedRedisError = now;
          console.error('[rate-limit] Redis check failed; using the in-memory window:', err?.message ?? err);
        }
      }
    }
    return this.memory.check(identifier);
  }
}

/** Create a rate limiter instance. */
export function createRateLimiter(config: RateLimiterConfig): SharedRateLimiter {
  return new SharedRateLimiter(config);
}

/** Pre-configured limiters kept for existing call sites. */
export const authRateLimiter = createRateLimiter({
  name: 'auth-ip',
  interval: 15 * 60 * 1000,
  maxRequests: 10,
});

export const registerRateLimiter = createRateLimiter({
  name: 'register-ip-1h',
  interval: 60 * 60 * 1000,
  maxRequests: 3,
});

export const circleCreationRateLimiter = createRateLimiter({
  name: 'circle-create-user',
  interval: 24 * 60 * 60 * 1000,
  maxRequests: 5,
});

export { getClientIp };

/** Get identifier from request (user id when given, else IP address). */
export function getIdentifier(request: NextRequest, userId?: string): string {
  if (userId) return `user:${userId}`;
  return getClientIp(request) ?? 'anonymous';
}

/** The 429 body every limiter returns (stable code RATE_LIMIT_EXCEEDED). */
export function rateLimitedResponse(result: RateLimitResult): NextResponse {
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
        'Retry-After': Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)).toString(),
      },
    }
  );
}

/**
 * Apply rate limiting to a request.
 * Returns the 429 response when the limit is exceeded, else null.
 */
export async function applyRateLimit(
  _request: NextRequest,
  limiter: SharedRateLimiter,
  identifier: string
): Promise<NextResponse | null> {
  const result = await limiter.check(identifier);
  return result.success ? null : rateLimitedResponse(result);
}
