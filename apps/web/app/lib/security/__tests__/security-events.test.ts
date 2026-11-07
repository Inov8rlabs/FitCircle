/**
 * security_events: privacy (no raw IP / email / token leaves the process), dedupe, and the
 * Sentry + Amplitude fan-out.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as any[],
  updates: [] as any[],
  logs: [] as any[],
  metrics: [] as any[],
  amplitude: [] as any[],
}));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      insert: async (row: any) => {
        if (row.dedupe_key && h.rows.some((r) => r.dedupe_key === row.dedupe_key)) return { error: { code: '23505', message: 'dup' } };
        h.rows.push({ id: `id-${h.rows.length}`, ...row });
        return { error: null };
      },
      select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: async () => ({ data: h.rows.find((r) => r.dedupe_key === v) ?? null, error: null }) }) }),
      update: (patch: any) => ({
        eq: async (_c: string, id: string) => {
          const r = h.rows.find((x) => x.id === id);
          Object.assign(r, patch);
          h.updates.push(patch);
          return { error: null };
        },
      }),
    }),
  }),
}));
vi.mock('@sentry/nextjs', () => ({
  logger: { warn: (m: string, a: any) => void h.logs.push({ level: 'warn', m, a }), info: (m: string, a: any) => void h.logs.push({ level: 'info', m, a }) },
  metrics: { count: (name: string, v: number, o: any) => void h.metrics.push({ name, v, o }) },
}));
vi.mock('@/lib/analytics/amplitude-server', () => ({ trackServerEventInBackground: (e: any) => void h.amplitude.push(e) }));

import { accountHash, amplitudeEventsFor, emitToSentry, ipPrefix, recordSecurityEvent, securityEventRow } from '../security-events';

const IP = '203.0.113.77';
const EMAIL = 'Victim.User+x@gmail.com';
const req = (extra: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/mobile/auth/login?secret=1', {
    method: 'POST',
    headers: {
      'x-forwarded-for': IP,
      'x-vercel-ip-country': 'ro',
      'x-vercel-ip-as-number': '212238',
      'x-app-platform': 'android',
      'x-app-version': '1.1.3',
      'x-integrity-token': 'SECRET-TOKEN',
      'x-integrity-error': 'token_-6',
      ...extra,
    },
  });

beforeEach(() => {
  h.rows = [];
  h.updates = [];
  h.logs = [];
  h.metrics = [];
  h.amplitude = [];
});

describe('privacy', () => {
  it('IP prefixes: IPv4 /24, IPv6 /48', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(ipPrefix(null)).toBeNull();
  });

  it('accounts are sha256 of the canonical mailbox', () => {
    expect(accountHash(EMAIL)).toBe(accountHash('victimuser@gmail.com'));
    expect(accountHash(EMAIL)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no raw IP, email or token in the DB row, the Sentry log/metric or Amplitude', async () => {
    await recordSecurityEvent(req(), { kind: 'login_failure', result: 'rejected', action: 'login', reason: 'invalid_credentials', email: EMAIL, deviceId: 'dev-1234' });
    await recordSecurityEvent(req(), { kind: 'integrity', result: 'block', action: 'register', reason: 'device_integrity', deviceId: 'dev-1234' });
    await recordSecurityEvent(req(), { kind: 'signup_block', result: 'block', action: 'register', reason: 'disposable_email' });
    const everything = JSON.stringify({ rows: h.rows, logs: h.logs, metrics: h.metrics, amplitude: h.amplitude });
    expect(everything).not.toContain(IP);
    expect(everything.toLowerCase()).not.toContain('victim');
    expect(everything).not.toContain('SECRET-TOKEN');
    expect(everything).not.toContain('secret=1');
    expect(h.rows[0]).toMatchObject({ ip_prefix: '203.0.113.0/24', asn: '212238', country: 'RO', platform: 'android', app_version: '1.1.3', integrity_error: 'token_-6', route: '/api/mobile/auth/login', account_hash: accountHash(EMAIL) });
  });
});

describe('dedupe', () => {
  it('rate-limit floods: one row per (kind, ip prefix, route, limiter, minute) with a count', async () => {
    for (let i = 0; i < 5; i++) await recordSecurityEvent(req(), { kind: 'rate_limit', result: 'limited', action: 'login-ip-15m', reason: 'ip', dedupe: true });
    await recordSecurityEvent(req({ 'x-forwarded-for': '198.51.100.1' }), { kind: 'rate_limit', result: 'limited', action: 'login-ip-15m', reason: 'ip', dedupe: true });
    expect(h.rows).toHaveLength(2);
    expect(h.rows[0].count).toBe(5);
    expect(h.rows[1].count).toBe(1);
  });

  it('the dedupe key changes every minute', () => {
    const a = securityEventRow(req(), { kind: 'rate_limit', result: 'limited', dedupe: true }, new Date('2026-11-07T10:00:05Z'));
    const b = securityEventRow(req(), { kind: 'rate_limit', result: 'limited', dedupe: true }, new Date('2026-11-07T10:00:59Z'));
    const c = securityEventRow(req(), { kind: 'rate_limit', result: 'limited', dedupe: true }, new Date('2026-11-07T10:01:00Z'));
    expect(a.dedupe_key).toBe(b.dedupe_key);
    expect(a.dedupe_key).not.toBe(c.dedupe_key);
    expect(securityEventRow(req(), { kind: 'integrity', result: 'pass' }).dedupe_key).toBeNull();
  });
});

describe('Sentry', () => {
  it('blocks log at warn as security.<kind> with the documented attributes; every event counts', () => {
    emitToSentry(securityEventRow(req(), { kind: 'integrity', result: 'block', action: 'login', reason: 'device_integrity' }));
    expect(h.logs).toEqual([
      {
        level: 'warn',
        m: 'security.integrity',
        a: { kind: 'integrity', route: '/api/mobile/auth/login', action: 'login', platform: 'android', app_version: '1.1.3', result: 'block', reason: 'device_integrity', asn: '212238', country: 'RO', ip_prefix: '203.0.113.0/24', integrity_error: 'token_-6' },
      },
    ]);
    expect(h.metrics).toEqual([{ name: 'security.event', v: 1, o: { attributes: { kind: 'integrity', result: 'block', reason: 'device_integrity', platform: 'android' } } }]);
  });

  it('passes are sampled at 10 % (info)', () => {
    const row = securityEventRow(req(), { kind: 'integrity', result: 'pass', action: 'login' });
    emitToSentry(row, () => 0.5);
    expect(h.logs).toHaveLength(0);
    emitToSentry(row, () => 0.05);
    expect(h.logs[0]).toMatchObject({ level: 'info', m: 'security.integrity' });
    expect(h.metrics).toHaveLength(2);
  });
});

describe('Amplitude (product-level kinds only)', () => {
  const ev = (input: any) => amplitudeEventsFor(securityEventRow(req(), input), input).map((e) => e.name);
  it('maps kinds to the tracking-plan events', () => {
    expect(ev({ kind: 'integrity', result: 'pass', action: 'login' })).toEqual(['Integrity Checked']);
    expect(ev({ kind: 'integrity', result: 'block', action: 'register', reason: 'x' })).toEqual(['Integrity Checked', 'Integrity Blocked']);
    expect(ev({ kind: 'integrity', result: 'block', action: 'fitzy', reason: 'x' })).toEqual(['Integrity Blocked']);
    expect(ev({ kind: 'signup_block', result: 'block', reason: 'disposable_email' })).toEqual(['Signup Blocked']);
    expect(ev({ kind: 'referral_rejection', result: 'rejected', reason: 'same_mailbox' })).toEqual(['Referral Rejected']);
    expect(ev({ kind: 'free_ai_device_limit', result: 'block', amplitude: { limit: 5, used: 5 } })).toEqual(['Free AI Device Limit Hit']);
    expect(ev({ kind: 'rate_limit', result: 'limited' })).toEqual([]);
    expect(ev({ kind: 'login_failure', result: 'rejected' })).toEqual([]);
  });
});
