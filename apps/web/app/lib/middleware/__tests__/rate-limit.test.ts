import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upstash = vi.hoisted(() => ({ limit: vi.fn(), constructed: 0 }));
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { upstash.constructed++; } } }));
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = (max: number, window: string) => ({ max, window });
    constructor(public opts: any) {}
    limit = (id: string) => upstash.limit(id, this.opts);
  }
  return { Ratelimit };
});

import { applyRateLimit, createRateLimiter, getClientIp, redisEnv, resetRateLimitBackend } from '../rate-limit';

const ENV_KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetRateLimitBackend();
  upstash.limit.mockReset();
  upstash.constructed = 0;
});
afterEach(() => {
  for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
  resetRateLimitBackend();
});

describe('shared rate limiter', () => {
  it('without Upstash env: in-memory window, logged once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = createRateLimiter({ name: 't-a', interval: 60_000, maxRequests: 2 });
    const b = createRateLimiter({ name: 't-b', interval: 60_000, maxRequests: 2 });
    expect(a.backend).toBe('memory');
    expect(b.backend).toBe('memory');
    expect((await a.check('x')).success).toBe(true);
    expect((await a.check('x')).success).toBe(true);
    expect(await a.check('x')).toMatchObject({ success: false, remaining: 0, limit: 2 });
    expect((await a.check('y')).success).toBe(true);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('in-memory limiter'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('with Upstash env: Redis sliding window, namespaced by limiter name', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    upstash.limit.mockResolvedValue({ success: false, limit: 3, remaining: 0, reset: Date.now() + 1000 });
    const l = createRateLimiter({ name: 'register-ip-1h', interval: 3_600_000, maxRequests: 3 });
    expect(l.backend).toBe('redis');
    const res = await applyRateLimit({} as any, l, 'ip:1.2.3.4');
    expect(res!.status).toBe(429);
    expect((await res!.json()).error.code).toBe('RATE_LIMIT_EXCEEDED');
    const [id, opts] = upstash.limit.mock.calls[0];
    expect(id).toBe('ip:1.2.3.4');
    expect(opts).toMatchObject({ prefix: 'fc:rl:register-ip-1h', limiter: { max: 3, window: '3600000 ms' } });
  });

  it('a Redis failure never blocks: that check uses the in-memory window', async () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 't';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    upstash.limit.mockRejectedValue(new Error('ECONNRESET'));
    const l = createRateLimiter({ name: 't-c', interval: 60_000, maxRequests: 1 });
    expect((await l.check('z')).success).toBe(true);
    expect((await l.check('z')).success).toBe(false);
    err.mockRestore();
  });

  it('reads both env spellings', () => {
    expect(redisEnv({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' } as any)).toEqual({ url: 'u', token: 't' });
    expect(redisEnv({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' } as any)).toEqual({ url: 'u', token: 't' });
    expect(redisEnv({ UPSTASH_REDIS_REST_URL: 'u' } as any)).toBeNull();
  });

  it('client IP from the Vercel edge headers', () => {
    expect(getClientIp(new NextRequest('http://x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }))).toBe('203.0.113.9');
    expect(getClientIp(new NextRequest('http://x', { headers: { 'x-real-ip': '198.51.100.2' } }))).toBe('198.51.100.2');
    expect(getClientIp(new NextRequest('http://x'))).toBeNull();
  });
});
