import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ checks: [] as Array<{ name: string; id: string }>, limitName: null as string | null, events: [] as any[] }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  createRateLimiter: (cfg: any) => ({ cfg }),
  applyRateLimit: async (_r: unknown, limiter: any, id: string) => {
    h.checks.push({ name: limiter.cfg.name, id });
    return limiter.cfg.name === h.limitName ? new Response('{}', { status: 429 }) : null;
  },
}));
vi.mock('@/lib/security/security-events', () => ({ recordSecurityEvent: async (_r: unknown, e: any) => void h.events.push(e) }));

import { ABUSE_LIMITS, enforceAbuseLimits } from '../abuse-limits';

const req = (headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/mobile/auth/login', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9', ...headers } });

beforeEach(() => {
  h.checks = [];
  h.limitName = null;
  h.events = [];
});

describe('abuse limits', () => {
  it('pins the spec limits', () => {
    const pick = (a: keyof typeof ABUSE_LIMITS) => ABUSE_LIMITS[a].map((l) => `${l.dimension}:${l.maxRequests}/${l.interval / 60_000}m`);
    expect(pick('register')).toEqual(['ip:3/60m', 'ip:10/1440m', 'device:3/1440m']);
    expect(pick('login')).toEqual(['ip:10/15m', 'account:5/15m']);
    expect(pick('forgot_password')).toEqual(['account:3/60m', 'ip:10/60m']);
    expect(pick('resend_confirmation')).toEqual(['account:3/60m', 'ip:10/60m']);
    expect(pick('food_ai').map((s) => s.split(':')[0])).toEqual(['user', 'device']);
    expect(pick('fitzy').map((s) => s.split(':')[0])).toEqual(['user', 'device']);
  });

  it('keys accounts by canonical mailbox and IPs by the edge header', async () => {
    await enforceAbuseLimits(req(), 'login', { email: 'Jane.Doe+x@gmail.com' });
    expect(h.checks).toEqual([
      { name: 'login-ip-15m', id: 'ip:203.0.113.9' },
      { name: 'login-account-15m', id: 'acct:janedoe@gmail.com' },
    ]);
  });

  it('device limits use X-Device-Id and are skipped without one', async () => {
    await enforceAbuseLimits(req(), 'register');
    expect(h.checks.map((c) => c.name)).toEqual(['register-ip-1h', 'register-ip-1d']);
    h.checks = [];
    await enforceAbuseLimits(req({ 'x-device-id': 'dev-12345' }), 'register');
    expect(h.checks.at(-1)).toEqual({ name: 'register-device-1d', id: 'dev:dev-12345' });
  });

  it('returns the first 429 and records one deduplicated rate_limit event', async () => {
    h.limitName = 'login-ip-15m';
    const res = await enforceAbuseLimits(req(), 'login', { email: 'a@b.co' });
    expect(res!.status).toBe(429);
    expect(h.checks).toHaveLength(1);
    expect(h.events).toEqual([expect.objectContaining({ kind: 'rate_limit', result: 'limited', action: 'login-ip-15m', dedupe: true })]);
    expect(JSON.stringify(h.events)).not.toContain('a@b.co');
  });
});
